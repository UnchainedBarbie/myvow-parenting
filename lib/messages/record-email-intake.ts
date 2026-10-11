import type { getServiceRoleClient } from "@/lib/supabase/server";

type Admin = ReturnType<typeof getServiceRoleClient>;

export type EmailIntakeDraft = {
  caseId: string;
  caseMemberId: string;
  fromEmail: string;
  subject: string;
  messageId: string | null;
  inReplyTo: string | null;
  referencesHeader: string | null;
  branch: "self" | "coparent";
  submittedByUserId: string | null;
};

/**
 * Record who submitted this delivery.
 * original_sender_email stays empty. A parsed forwarded header is not a verified author.
 */
export async function recordEmailIntake(
  admin: Admin,
  draft: EmailIntakeDraft
): Promise<{ id: string } | { duplicate: true } | { error: string }> {
  const fromEmail = draft.fromEmail.trim().toLowerCase();
  const { data, error } = await admin
    .from("email_intake")
    .insert({
      case_id: draft.caseId,
      case_member_id: draft.caseMemberId,
      from_email: fromEmail,
      subject: draft.subject.trim() || null,
      message_id: draft.messageId,
      in_reply_to: draft.inReplyTo,
      references_header: draft.referencesHeader,
      branch: draft.branch,
      submitted_by_user_id: draft.submittedByUserId,
      original_sender_verified: false,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505" || /email_intake_case_message_uidx|duplicate key/i.test(error.message)) {
      return { duplicate: true };
    }
    return { error: error.message };
  }
  const id = (data as { id?: string } | null)?.id;
  if (!id) return { error: "email_intake insert returned no id" };
  return { id };
}
