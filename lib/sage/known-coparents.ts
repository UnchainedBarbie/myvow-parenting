import type { getServiceRoleClient } from "@/lib/supabase/server";
import type { KnownCoparent } from "@/lib/sage/chat-intent";

type Admin = ReturnType<typeof getServiceRoleClient>;

type MemberRow = {
  user_id?: string | null;
  display_name?: string | null;
  external_email?: string | null;
  invited_email?: string | null;
  invited_name?: string | null;
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Other parents on the case. A delivery email is used only when it is stored
 * for that parent, or when the case has one configured co-parent address.
 */
export async function loadKnownCoparents(
  admin: Admin,
  caseId: string,
  userId: string
): Promise<KnownCoparent[]> {
  const { data: members, error } = await admin
    .from("case_members")
    .select("user_id, display_name, external_email, invited_email, invited_name")
    .eq("case_id", caseId)
    .eq("role", "parent");
  if (error || !members) return [];

  const others = (members as MemberRow[]).filter(
    (member) => clean(member.user_id) && clean(member.user_id) !== userId
  );
  const ids = others.map((member) => clean(member.user_id)).filter(Boolean);
  const usersById = new Map<string, { full_name?: string | null; email?: string | null }>();
  if (ids.length > 0) {
    const { data: users } = await admin.from("users").select("id, full_name, email").in("id", ids);
    for (const row of users ?? []) {
      const id = clean((row as { id?: string }).id);
      if (id) usersById.set(id, row as { full_name?: string | null; email?: string | null });
    }
  }

  const { data: conversations } = await admin
    .from("conversations")
    .select("coparent_email")
    .eq("case_id", caseId);
  const channels = [
    ...new Set(
      (conversations ?? [])
        .map((row) => clean((row as { coparent_email?: string | null }).coparent_email))
        .filter(Boolean)
    ),
  ];
  const sharedChannel = others.length === 1 && channels.length === 1 ? channels[0] : null;

  return others.map((member) => {
    const user = usersById.get(clean(member.user_id));
    const name =
      clean(member.display_name) ||
      clean(member.invited_name) ||
      clean(user?.full_name) ||
      "Co-parent";
    const own =
      clean(member.external_email) || clean(member.invited_email) || clean(user?.email);
    const email = sharedChannel || own || null;
    return { name, email };
  });
}
