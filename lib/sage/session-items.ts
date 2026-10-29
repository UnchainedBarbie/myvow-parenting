import type { getServiceRoleClient } from "@/lib/supabase/server";

type Admin = ReturnType<typeof getServiceRoleClient>;

/**
 * The saved Sage items that belong to one parent's chat session.
 *
 * A session is the unit of conversation. sage_items carries no session column, so the link is
 * the journal row: sage_journal_messages(session_id, user_id).sage_item_id. Reading through that
 * link keeps one session's work out of another session, and keeps every read inside the signed-in
 * parent's own rows (user_id on the journal, visible_to on the item).
 *
 * A chat without a session id reads the parent's sessionless journal rows, the same bucket it writes to.
 */
export async function loadSessionItemIds(
  admin: Admin,
  sessionId: string | null,
  userId: string
): Promise<string[]> {
  let query = admin
    .from("sage_journal_messages")
    .select("sage_item_id")
    .eq("user_id", userId)
    .not("sage_item_id", "is", null);
  query = sessionId ? query.eq("session_id", sessionId) : query.is("session_id", null);
  const { data, error } = await query;
  if (error || !data) return [];
  return [
    ...new Set(
      (data as { sage_item_id?: string | null }[])
        .map((row) => row.sage_item_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    ),
  ];
}

export type SessionItemRow = {
  id: string;
  summary: string | null;
  source_type: string | null;
  item_type: string | null;
  created_at: string | null;
  plan: Record<string, unknown> | null;
};

/** The parent's own items in this session, newest first. */
export async function loadSessionItems(
  admin: Admin,
  sessionId: string | null,
  userId: string
): Promise<SessionItemRow[]> {
  const ids = await loadSessionItemIds(admin, sessionId, userId);
  if (ids.length === 0) return [];
  const { data, error } = await admin
    .from("sage_items")
    .select("id, summary, plan, created_at, source_type, item_type")
    .in("id", ids)
    .eq("visible_to", userId)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return (data as Partial<SessionItemRow>[]).filter(
    (row): row is SessionItemRow => typeof row.id === "string" && row.id.length > 0
  );
}
