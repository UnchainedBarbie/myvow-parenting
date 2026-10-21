import { ServerClient, Message, Header } from "postmark";
import type { getServiceRoleClient } from "@/lib/supabase/server";
import { estimateIntensity } from "@/lib/sage/intensity";

type Admin = ReturnType<typeof getServiceRoleClient>;

export type SendProposal = {
  executed?: boolean;
  result_message_id?: string | null;
  send_claim_at?: string | null;
  draft?: string | null;
  revised_text?: string | null;
  recipient_name?: string | null;
  recipient_email?: string | null;
  subject?: string | null;
};

export function messageSendDecision(
  proposal: SendProposal,
  now = Date.now()
): "send" | "already_sent" | "in_progress" {
  if (proposal.executed === true) return "already_sent";
  if ((proposal.result_message_id ?? "").trim()) return "already_sent";
  const claim = (proposal.send_claim_at ?? "").trim();
  if (claim) {
    const at = Date.parse(claim);
    if (Number.isFinite(at) && now - at < 60_000) return "in_progress";
  }
  return "send";
}

export function approvedMessageBody(proposal: SendProposal): string {
  const revised = (proposal.revised_text ?? "").trim();
  const draft = (proposal.draft ?? "").trim();
  return revised || draft;
}

/** Fields stored for a parent-to-parent send. Delivery is not marked confirmed here. */
export function parentMessageFields(input: {
  caseId: string;
  senderId: string;
  conversationId: string | null;
  body: string;
  recipientEmail: string;
  proposalId?: string | null;
}): Record<string, unknown> {
  const intensity = estimateIntensity(input.body);
  const proposalId = (input.proposalId ?? "").trim();
  return {
    case_id: input.caseId,
    conversation_id: input.conversationId,
    direction: "outgoing",
    sender_id: input.senderId,
    original_content: input.body,
    ai_rewritten_content: input.body,
    ai_rewritten: false,
    current_status: "sent",
    delivery_status: "sent",
    delivered_at: null,
    recipient_email: input.recipientEmail,
    intensity_score: intensity.score,
    intensity_flag: intensity.flag,
    is_emergency: false,
    ...(proposalId ? { sage_proposal_id: proposalId } : {}),
  };
}

export function confirmedDeliveryFields(emailMessageId: string, deliveredAt: string): Record<string, unknown> {
  return {
    delivery_status: "delivered",
    delivered_at: deliveredAt,
    email_message_id: emailMessageId,
  };
}

async function sendingPaused(admin: Admin, userId: string): Promise<string | null> {
  const { data } = await admin
    .from("cool_off")
    .select("id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .gt("ends_at", new Date().toISOString())
    .maybeSingle();
  if (data) {
    return "Sending is paused while you take a break. It will be available again when your break ends.";
  }
  return null;
}

async function conversationForRecipient(
  admin: Admin,
  caseId: string,
  recipientEmail: string
): Promise<{ id: string; subject: string; emailThreadId: string | null } | null> {
  const { data } = await admin
    .from("conversations")
    .select("id, subject, coparent_email, email_thread_id")
    .eq("case_id", caseId);
  const needle = recipientEmail.trim().toLowerCase();
  const rows = (data ?? []) as {
    id?: string;
    subject?: string | null;
    coparent_email?: string | null;
    email_thread_id?: string | null;
  }[];
  const match = rows.find(
    (row) => (row.coparent_email ?? "").trim().toLowerCase() === needle && row.id
  );
  if (!match?.id) return null;
  return {
    id: match.id,
    subject: (match.subject ?? "").trim(),
    emailThreadId: match.email_thread_id ?? null,
  };
}

export async function deliverParentMessage(
  admin: Admin,
  input: {
    caseId: string;
    senderId: string;
    body: string;
    recipientEmail: string;
    subject?: string | null;
    proposalId?: string | null;
  }
): Promise<
  | { ok: true; messageId: string; deliveryStatus: "sent" | "delivered"; recipientEmail: string }
  | { ok: false; status: number; message: string }
> {
  const body = input.body.trim();
  const recipientEmail = input.recipientEmail.trim();
  if (!body) return { ok: false, status: 400, message: "The message is empty." };
  if (!recipientEmail) {
    return { ok: false, status: 400, message: "Add a recipient email before sending." };
  }
  const paused = await sendingPaused(admin, input.senderId);
  if (paused) return { ok: false, status: 403, message: paused };

  const conversation = await conversationForRecipient(admin, input.caseId, recipientEmail);
  const fields = parentMessageFields({
    caseId: input.caseId,
    senderId: input.senderId,
    conversationId: conversation?.id ?? null,
    body,
    recipientEmail,
    proposalId: input.proposalId,
  });

  let inserted = await admin.from("messages").insert(fields).select("id").single();
  for (let attempt = 0; attempt < 2 && inserted.error; attempt += 1) {
    const message = inserted.error.message ?? "";
    if (/sage_proposal_id/.test(message) && "sage_proposal_id" in fields) {
      delete fields.sage_proposal_id;
    } else if (/recipient_email/.test(message) && "recipient_email" in fields) {
      delete fields.recipient_email;
    } else {
      break;
    }
    inserted = await admin.from("messages").insert(fields).select("id").single();
  }
  if (inserted.error || !inserted.data) {
    return {
      ok: false,
      status: 500,
      message: inserted.error?.message ?? "The message could not be saved.",
    };
  }
  const messageId = (inserted.data as { id: string }).id;
  let deliveryStatus: "sent" | "delivered" = "sent";

  const { data: caseRow } = await admin
    .from("cases")
    .select("ingest_email")
    .eq("id", input.caseId)
    .maybeSingle();
  const ingestEmail = ((caseRow as { ingest_email?: string | null } | null)?.ingest_email ?? "").trim();
  const token = process.env.POSTMARK_SERVER_TOKEN;
  if (token && ingestEmail && conversation) {
    const emailMessageId = `<msg-${messageId}@myvow.in>`;
    const subject =
      (input.subject ?? "").trim() ||
      (conversation.emailThreadId ? `Re: ${conversation.subject}` : conversation.subject) ||
      "Message";
    const headers: { Name: string; Value: string }[] = [
      { Name: "Message-ID", Value: emailMessageId },
    ];
    if (conversation.emailThreadId) {
      headers.push({ Name: "In-Reply-To", Value: conversation.emailThreadId });
      headers.push({ Name: "References", Value: conversation.emailThreadId });
    }
    try {
      const client = new ServerClient(token);
      const email = new Message(
        ingestEmail,
        subject,
        undefined,
        body,
        recipientEmail,
        undefined,
        undefined,
        ingestEmail,
        undefined,
        undefined,
        undefined,
        headers.map((header) => new Header(header.Name, header.Value)),
        undefined,
        undefined
      );
      await client.sendEmail(email);
      const deliveredAt = new Date().toISOString();
      await admin
        .from("messages")
        .update(confirmedDeliveryFields(emailMessageId, deliveredAt))
        .eq("id", messageId);
      if (!conversation.emailThreadId) {
        await admin
          .from("conversations")
          .update({ email_thread_id: emailMessageId })
          .eq("id", conversation.id);
      }
      deliveryStatus = "delivered";
    } catch (error) {
      console.error("[deliver-parent-message] Postmark send failed:", error);
    }
  }

  return { ok: true, messageId, deliveryStatus, recipientEmail };
}
