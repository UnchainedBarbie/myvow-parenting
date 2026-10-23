import type { SupabaseClient } from "@supabase/supabase-js";
import { mailboxAddress } from "@/lib/messages/mailbox";

export type OwnerMailboxSource = {
  userEmail?: string | null;
  loginEmail?: string | null;
  members?: { external_email?: string | null; invited_email?: string | null }[];
  registeredEmails?: (string | null | undefined)[];
};

/**
 * Every address saved for this parent.
 * Includes the login, the user record, addresses on their case-member row,
 * and addresses registered for that row. Other parents' addresses are not included.
 */
export function collectOwnerMailboxes(input: OwnerMailboxSource): string[] {
  const found = new Set<string>();
  const add = (value: string | null | undefined) => {
    const email = mailboxAddress(value);
    if (email) found.add(email);
  };
  add(input.userEmail);
  add(input.loginEmail);
  for (const member of input.members ?? []) {
    add(member.external_email);
    add(member.invited_email);
  }
  for (const email of input.registeredEmails ?? []) add(email);
  return [...found];
}

/** Addresses that belong to this parent: their login and their saved case emails. */
export async function loadOwnerMailboxes(
  admin: SupabaseClient,
  caseId: string,
  ownerId: string
): Promise<string[]> {
  const { data: userRow } = await admin.from("users").select("email").eq("id", ownerId).maybeSingle();
  const { data: members } = await admin
    .from("case_members")
    .select("id, external_email, invited_email")
    .eq("case_id", caseId)
    .eq("user_id", ownerId);
  const memberRows = (members ?? []) as {
    id?: string;
    external_email?: string | null;
    invited_email?: string | null;
  }[];
  const memberIds = memberRows
    .map((row) => row.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  let registered: string[] = [];
  if (memberIds.length > 0) {
    const { data: emails } = await admin
      .from("case_member_emails")
      .select("email")
      .eq("case_id", caseId)
      .in("case_member_id", memberIds);
    registered = (emails ?? [])
      .map((row) => (row as { email?: string | null }).email)
      .filter((email): email is string => typeof email === "string");
  }
  return collectOwnerMailboxes({
    userEmail: (userRow as { email?: string | null } | null)?.email,
    members: memberRows,
    registeredEmails: registered,
  });
}
