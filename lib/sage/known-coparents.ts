import type { getServiceRoleClient } from "@/lib/supabase/server";
import type { KnownCoparent } from "@/lib/sage/chat-intent";

type Admin = ReturnType<typeof getServiceRoleClient>;

export type CaseParentRow = {
  id?: string | null;
  user_id?: string | null;
  display_name?: string | null;
  external_email?: string | null;
  invited_email?: string | null;
  invited_name?: string | null;
  child_id?: string | null;
  /** invited means saved but not joined. connected means they have a login on the case. */
  invitation_status?: string | null;
};

export type UserNameRow = {
  id: string;
  full_name?: string | null;
  email?: string | null;
};

/** Address registered for a case member. This is the delivery contact, not an inbound sender. */
export type RegisteredMemberEmail = {
  case_member_id?: string | null;
  email?: string | null;
  is_reply?: boolean | null;
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function deliveryEmail(
  member: CaseParentRow,
  registered: RegisteredMemberEmail[],
  loginEmail: string
): string | null {
  const memberId = clean(member.id);
  const forMember = memberId
    ? registered.filter((row) => clean(row.email) && clean(row.case_member_id) === memberId)
    : [];
  const reply = forMember.find((row) => row.is_reply === true);
  if (reply) return clean(reply.email);
  if (forMember.length === 1) return clean(forMember[0].email);
  return clean(member.external_email) || clean(member.invited_email) || loginEmail || null;
}

/**
 * Parent rows other than the signed-in user. A pending co-parent has no user id
 * and does not need an account. The delivery address is the one saved on that
 * parent, not an address copied from an incoming message.
 */
export function knownCoparentsFromRows(
  members: CaseParentRow[],
  users: UserNameRow[],
  registeredEmails: RegisteredMemberEmail[],
  userId: string
): KnownCoparent[] {
  const usersById = new Map(users.map((user) => [user.id, user]));
  const recipients: KnownCoparent[] = [];
  for (const member of members) {
    if (clean(member.child_id)) continue;
    const id = clean(member.user_id);
    if (id && id === userId) continue;
    const login = usersById.get(id);
    const name =
      clean(member.display_name) || clean(member.invited_name) || clean(login?.full_name) || "";
    const email = deliveryEmail(member, registeredEmails, clean(login?.email)) || null;
    if (!id && !name && !email) continue;
    recipients.push({ name, email });
  }
  return recipients;
}

/**
 * Other parents on the case, including a pending invite with no login.
 * Delivery comes from the address saved for that parent.
 */
export async function loadKnownCoparents(
  admin: Admin,
  caseId: string,
  userId: string
): Promise<KnownCoparent[]> {
  const { data, error } = await admin
    .from("case_members")
    .select("id, user_id, display_name, external_email, invited_email, invited_name, invitation_status")
    .eq("case_id", caseId)
    .eq("role", "parent");
  if (error || !data) {
    console.error("[sage/known-coparents] case_members", error?.message ?? "no rows");
    return [];
  }
  const members = data as CaseParentRow[];

  const ids = members.map((member) => clean(member.user_id)).filter((id) => id && id !== userId);
  const users: UserNameRow[] = [];
  if (ids.length > 0) {
    const { data: userRows } = await admin.from("users").select("id, full_name, email").in("id", ids);
    for (const row of userRows ?? []) {
      const id = clean((row as { id?: string }).id);
      if (id) users.push(row as UserNameRow);
    }
  }

  const { data: addressRows, error: addressError } = await admin
    .from("case_member_emails")
    .select("case_member_id, email, is_reply")
    .eq("case_id", caseId);
  if (addressError) {
    console.error("[sage/known-coparents] case_member_emails", addressError.message);
  }
  const registered = (addressRows ?? []) as RegisteredMemberEmail[];
  return knownCoparentsFromRows(members, users, registered, userId);
}
