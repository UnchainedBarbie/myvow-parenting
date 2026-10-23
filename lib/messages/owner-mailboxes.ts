import type { SupabaseClient } from "@supabase/supabase-js";

function mailbox(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.includes("@") ? email : null;
}

/** Addresses that belong to this parent: their login and their saved case emails. */
export async function loadOwnerMailboxes(
  admin: SupabaseClient,
  caseId: string,
  ownerId: string
): Promise<string[]> {
  const found = new Set<string>();
  const { data: userRow } = await admin.from("users").select("email").eq("id", ownerId).maybeSingle();
  const login = mailbox((userRow as { email?: string | null } | null)?.email);
  if (login) found.add(login);

  const { data: members } = await admin
    .from("case_members")
    .select("id")
    .eq("case_id", caseId)
    .eq("user_id", ownerId);
  const memberIds = (members ?? [])
    .map((row) => (row as { id?: string }).id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  if (memberIds.length === 0) return [...found];

  const { data: emails } = await admin
    .from("case_member_emails")
    .select("email")
    .eq("case_id", caseId)
    .in("case_member_id", memberIds);
  for (const row of emails ?? []) {
    const email = mailbox((row as { email?: string | null }).email);
    if (email) found.add(email);
  }
  return [...found];
}
