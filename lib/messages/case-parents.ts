import type { getServiceRoleClient } from "@/lib/supabase/server";
import type { CaseParentAddress } from "@/lib/messages/parent-message-visibility";

type Admin = ReturnType<typeof getServiceRoleClient>;

export type ParentDirectory = {
  parents: (CaseParentAddress & { name: string })[];
  senderEmails: string[];
  senderName: string;
};

/** The parents on a case with every address each one uses. Service-role read; callers authorize. */
export async function parentDirectory(admin: Admin, caseId: string, senderId: string): Promise<ParentDirectory> {
  const { data: members } = await admin
    .from("case_members")
    .select("id, user_id, role, display_name, external_email, invited_email, invited_name")
    .eq("case_id", caseId)
    .eq("role", "parent");
  const rows = (members ?? []) as {
    id?: string | null;
    user_id?: string | null;
    display_name?: string | null;
    external_email?: string | null;
    invited_email?: string | null;
    invited_name?: string | null;
  }[];
  const memberIds = rows.map((row) => (row.id ?? "").trim()).filter(Boolean);
  const userIds = rows.map((row) => (row.user_id ?? "").trim()).filter(Boolean);
  const registered = memberIds.length
    ? (
        await admin
          .from("case_member_emails")
          .select("case_member_id, email")
          .eq("case_id", caseId)
          .in("case_member_id", memberIds)
      ).data
    : [];
  const users = userIds.length
    ? (await admin.from("users").select("id, email, full_name").in("id", userIds)).data
    : [];
  const emailByMember = new Map<string, string[]>();
  for (const row of (registered ?? []) as { case_member_id?: string | null; email?: string | null }[]) {
    const memberId = (row.case_member_id ?? "").trim();
    const email = (row.email ?? "").trim();
    if (!memberId || !email) continue;
    const list = emailByMember.get(memberId) ?? [];
    list.push(email);
    emailByMember.set(memberId, list);
  }
  const userById = new Map(
    ((users ?? []) as { id?: string; email?: string | null; full_name?: string | null }[]).map((user) => [
      (user.id ?? "").trim(),
      user,
    ])
  );
  const parents = rows
    .map((row) => {
      const userId = (row.user_id ?? "").trim();
      if (!userId) return null;
      const user = userById.get(userId);
      const emails = [
        ...(emailByMember.get((row.id ?? "").trim()) ?? []),
        row.external_email ?? "",
        row.invited_email ?? "",
        user?.email ?? "",
      ].filter((email) => email.trim());
      const name =
        (row.display_name ?? "").trim() ||
        (row.invited_name ?? "").trim() ||
        (user?.full_name ?? "").trim() ||
        "Your co-parent";
      return { userId, emails, name };
    })
    .filter((parent): parent is CaseParentAddress & { name: string } => Boolean(parent));
  const sender = parents.find((parent) => parent.userId === senderId);
  return {
    parents,
    senderEmails: sender?.emails ?? [],
    senderName: sender?.name ?? "Your co-parent",
  };
}
