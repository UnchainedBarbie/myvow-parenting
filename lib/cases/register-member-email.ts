import type { getServiceRoleClient } from "@/lib/supabase/server";

type Admin = ReturnType<typeof getServiceRoleClient>;

export function normalizeMemberEmail(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

/**
 * Insert this member's address. The first address for the member is the reply address.
 * A repeat of the same address is success. An address already owned by another member of the case is not.
 */
export async function registerCaseMemberEmail(
  admin: Admin,
  input: { caseId: string; caseMemberId: string; email: string }
): Promise<{ ok: true } | { ok: false; message: string }> {
  const email = normalizeMemberEmail(input.email);
  if (!email) return { ok: false, message: "Invalid email" };

  const { data: replyRows, error: replyErr } = await admin
    .from("case_member_emails")
    .select("id")
    .eq("case_member_id", input.caseMemberId)
    .eq("is_reply", true)
    .limit(1);
  if (replyErr) return { ok: false, message: replyErr.message };

  const isReply = (replyRows ?? []).length === 0;
  const inserted = await insertAddress(admin, input.caseId, input.caseMemberId, email, isReply);
  if (!inserted.ok && isReply && inserted.replyConflict) {
    const retried = await insertAddress(admin, input.caseId, input.caseMemberId, email, false);
    if (!retried.ok) return { ok: false, message: retried.message };
  } else if (!inserted.ok) {
    return { ok: false, message: inserted.message };
  }

  const { data: owner, error: ownerErr } = await admin
    .from("case_member_emails")
    .select("case_member_id")
    .eq("case_id", input.caseId)
    .eq("email", email)
    .maybeSingle();
  if (ownerErr) return { ok: false, message: ownerErr.message };
  if ((owner as { case_member_id?: string } | null)?.case_member_id === input.caseMemberId) {
    return { ok: true };
  }
  return {
    ok: false,
    message: "Email is already registered to another member of this case",
  };
}

async function insertAddress(
  admin: Admin,
  caseId: string,
  caseMemberId: string,
  email: string,
  isReply: boolean
): Promise<{ ok: true } | { ok: false; message: string; replyConflict: boolean }> {
  const { error } = await admin.from("case_member_emails").upsert(
    {
      case_id: caseId,
      case_member_id: caseMemberId,
      email,
      is_reply: isReply,
    },
    { onConflict: "case_id,email", ignoreDuplicates: true }
  );
  if (!error) return { ok: true };
  const replyConflict = error.code === "23505";
  return { ok: false, message: error.message, replyConflict };
}

export async function registerEmailsForUser(
  admin: Admin,
  userId: string,
  email: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data, error } = await admin
    .from("case_members")
    .select("id, case_id")
    .eq("user_id", userId);
  if (error) return { ok: false, message: error.message };

  for (const row of (data ?? []) as { id?: string; case_id?: string }[]) {
    if (!row.id || !row.case_id) continue;
    const registered = await registerCaseMemberEmail(admin, {
      caseId: row.case_id,
      caseMemberId: row.id,
      email,
    });
    if (!registered.ok) return registered;
  }
  return { ok: true };
}
