import { getServiceRoleClient } from "@/lib/supabase/server";

export type ResolvedInboundSender = {
  fromEmail: string | null;
  caseMemberId: string | null;
  userId: string | null;
  isKnownCaseMember: boolean;
};

const UNKNOWN: ResolvedInboundSender = {
  fromEmail: null,
  caseMemberId: null,
  userId: null,
  isKnownCaseMember: false,
};

/**
 * Extract the mailbox from a raw From header.
 * Keeps dots and + aliases. Returns null when the value is not an address.
 */
function parseFromAddress(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  const bracket = trimmed.match(/<([^>]+)>/);
  const email = (bracket ? bracket[1] : trimmed).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

/**
 * Look up a From address on this case only.
 * Does not decide whether the member is the recipient or the co-parent.
 */
export async function resolveInboundSender(
  caseId: string,
  fromAddress: string | null | undefined
): Promise<ResolvedInboundSender> {
  const fromEmail = parseFromAddress(fromAddress);
  if (!fromEmail) return UNKNOWN;

  const admin = getServiceRoleClient();
  const { data: emailRow, error: emailErr } = await admin
    .from("case_member_emails")
    .select("case_member_id")
    .eq("case_id", caseId)
    .eq("email", fromEmail)
    .maybeSingle();

  if (emailErr) {
    throw new Error(emailErr.message);
  }

  const caseMemberId = (emailRow as { case_member_id?: string } | null)?.case_member_id;
  if (!caseMemberId) {
    return { fromEmail, caseMemberId: null, userId: null, isKnownCaseMember: false };
  }

  const { data: memberRow, error: memberErr } = await admin
    .from("case_members")
    .select("id, case_id, user_id")
    .eq("id", caseMemberId)
    .eq("case_id", caseId)
    .maybeSingle();

  if (memberErr) {
    throw new Error(memberErr.message);
  }

  const member = memberRow as {
    id?: string;
    user_id?: string | null;
  } | null;

  if (!member?.id) {
    return { fromEmail, caseMemberId: null, userId: null, isKnownCaseMember: false };
  }

  return {
    fromEmail,
    caseMemberId: member.id,
    userId: member.user_id ?? null,
    isKnownCaseMember: true,
  };
}
