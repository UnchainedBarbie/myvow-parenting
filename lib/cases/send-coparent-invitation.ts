import { ServerClient, Message } from "postmark";
import type { getServiceRoleClient } from "@/lib/supabase/server";
import { normalizeMemberEmail, registerCaseMemberEmail } from "@/lib/cases/register-member-email";
import {
  createInvitationToken,
  invitationBaseUrl,
  invitationDeliveryFields,
  invitationEmailText,
  inviteSlotAction,
  type MailResult,
} from "@/lib/cases/coparent-invitation";

type Admin = ReturnType<typeof getServiceRoleClient>;

export type InviteSaveResult =
  | { ok: true; memberId: string; emailSent: boolean; error: string | null }
  | { ok: false; status: number; error: string };

function missingInviteColumns(message: string | undefined): boolean {
  return /invitation_token_hash|invitation_expires_at|invitation_sent_at|invitation_last_error/i.test(
    message ?? ""
  );
}

export async function sendCoparentInvitationEmail(input: {
  from: string | null;
  to: string;
  subject: string;
  text: string;
}): Promise<MailResult> {
  const token = process.env.POSTMARK_SERVER_TOKEN?.trim();
  if (!token) return { accepted: false, message: "Email delivery is not configured." };
  if (!input.from) {
    return { accepted: false, message: "No sender address is configured for invitation email." };
  }
  try {
    const client = new ServerClient(token);
    await client.sendEmail(
      new Message(input.from, input.subject, undefined, input.text, input.to)
    );
    return { accepted: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The email provider did not accept the invitation.";
    return { accepted: false, message };
  }
}

async function senderAddress(admin: Admin, caseId: string): Promise<string | null> {
  const configured = process.env.POSTMARK_FROM_EMAIL?.trim();
  if (configured) return configured;
  const { data } = await admin.from("cases").select("ingest_email").eq("id", caseId).maybeSingle();
  const ingest = (data as { ingest_email?: string | null } | null)?.ingest_email?.trim();
  return ingest || null;
}

async function markReplyAddress(admin: Admin, memberId: string, email: string): Promise<void> {
  await admin.from("case_member_emails").update({ is_reply: false }).eq("case_member_id", memberId).neq("email", email);
  await admin.from("case_member_emails").update({ is_reply: true }).eq("case_member_id", memberId).eq("email", email);
}

export async function deliverCoparentInvitation(
  admin: Admin,
  input: {
    caseId: string;
    memberId: string;
    email: string;
    inviterName: string;
    origin: string | null;
    previousSentAt: string | null;
    now?: Date;
  }
): Promise<{ emailSent: boolean; error: string | null }> {
  const now = input.now ?? new Date();
  const created = createInvitationToken(now);
  const stored = await admin
    .from("case_members")
    .update({
      invitation_token_hash: created.tokenHash,
      invitation_expires_at: created.expiresAt,
    })
    .eq("id", input.memberId)
    .eq("case_id", input.caseId);
  if (stored.error) {
    if (missingInviteColumns(stored.error.message)) {
      return {
        emailSent: false,
        error:
          "The co-parent was saved, but invitation email cannot be sent until the invitation columns are added in the database.",
      };
    }
    return { emailSent: false, error: "The invitation could not be prepared." };
  }

  const link = `${invitationBaseUrl(input.origin)}/invite?token=${encodeURIComponent(created.token)}`;
  const message = invitationEmailText({ inviterName: input.inviterName, link });
  const mail = await sendCoparentInvitationEmail({
    from: await senderAddress(admin, input.caseId),
    to: input.email,
    subject: message.subject,
    text: message.text,
  });
  const delivery = invitationDeliveryFields({
    previousSentAt: input.previousSentAt,
    now,
    mail,
    tokenHash: created.tokenHash,
    expiresAt: created.expiresAt,
  });
  const written = await admin
    .from("case_members")
    .update(delivery.fields)
    .eq("id", input.memberId)
    .eq("case_id", input.caseId);
  if (written.error && !missingInviteColumns(written.error.message)) {
    return {
      emailSent: false,
      error: delivery.emailSent
        ? "The email provider accepted the invitation, but the sent time could not be saved."
        : delivery.error,
    };
  }
  return { emailSent: delivery.emailSent, error: delivery.error };
}

export async function saveAndInviteCoparent(
  admin: Admin,
  input: {
    caseId: string;
    userId: string;
    userEmail: string | null;
    email: string;
    name: string | null;
    inviterName: string;
    origin: string | null;
  }
): Promise<InviteSaveResult> {
  const email = normalizeMemberEmail(input.email);
  if (!email) return { ok: false, status: 400, error: "A valid email is required." };
  const own = normalizeMemberEmail(input.userEmail);
  if (own && own === email) {
    return { ok: false, status: 400, error: "Use a different email from the one on your account." };
  }

  const { data: memberRows, error: memberError } = await admin
    .from("case_members")
    .select("id, user_id, role")
    .eq("case_id", input.caseId);
  if (memberError) return { ok: false, status: 500, error: "The case members could not be loaded." };
  const slots = (memberRows ?? []) as { id: string; user_id: string | null; role: string | null }[];
  const slot = inviteSlotAction(
    slots.map((row) => ({
      id: row.id,
      userId: row.user_id,
      role: row.role,
    })),
    input.userId
  );
  if (slot.action === "reject") return { ok: false, status: 409, error: slot.error };

  const { data: addressOwner } = await admin
    .from("case_member_emails")
    .select("case_member_id")
    .eq("case_id", input.caseId)
    .eq("email", email)
    .maybeSingle();
  const addressMemberId = (addressOwner as { case_member_id?: string } | null)?.case_member_id ?? null;
  if (addressMemberId && (slot.action === "insert" || addressMemberId !== slot.memberId)) {
    return { ok: false, status: 409, error: "That email is already registered to someone on this case." };
  }

  let memberId: string;
  let previousSentAt: string | null = null;
  if (slot.action === "update") {
    const { data: previous } = await admin
      .from("case_members")
      .select("invitation_sent_at")
      .eq("id", slot.memberId)
      .maybeSingle();
    previousSentAt =
      (previous as { invitation_sent_at?: string | null } | null)?.invitation_sent_at ?? null;
    const { error: updateError } = await admin
      .from("case_members")
      .update({
        external_email: email,
        display_name: input.name,
        invitation_status: "invited",
        role: "parent",
      })
      .eq("id", slot.memberId)
      .eq("case_id", input.caseId)
      .is("user_id", null);
    if (updateError) return { ok: false, status: 500, error: "The co-parent could not be saved." };
    memberId = slot.memberId;
  } else {
    const { data: created, error: insertError } = await admin
      .from("case_members")
      .insert({
        case_id: input.caseId,
        user_id: null,
        role: "parent",
        is_primary: false,
        external_email: email,
        display_name: input.name,
        invitation_status: "invited",
      })
      .select("id")
      .single();
    if (insertError || !created) {
      return { ok: false, status: 500, error: "The co-parent could not be saved." };
    }
    memberId = (created as { id: string }).id;
  }

  const registered = await registerCaseMemberEmail(admin, {
    caseId: input.caseId,
    caseMemberId: memberId,
    email,
  });
  if (!registered.ok) {
    if (slot.action === "insert") await admin.from("case_members").delete().eq("id", memberId);
    return { ok: false, status: 500, error: registered.message };
  }
  await markReplyAddress(admin, memberId, email);

  const delivery = await deliverCoparentInvitation(admin, {
    caseId: input.caseId,
    memberId,
    email,
    inviterName: input.inviterName,
    origin: input.origin,
    previousSentAt,
  });
  return { ok: true, memberId, emailSent: delivery.emailSent, error: delivery.error };
}
