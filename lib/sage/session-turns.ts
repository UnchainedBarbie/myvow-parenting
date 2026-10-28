import type { getServiceRoleClient } from "@/lib/supabase/server";
import { SHADOW_CONTEXT_TURNS, shadowTurnsFromJournal } from "@/lib/sage/shadow-context";

type Admin = ReturnType<typeof getServiceRoleClient>;

/**
 * Recent turns of one parent's own Sage session, oldest first, each with its speaker.
 * Rows are limited to the session and to the signed-in parent. Another parent's session is never read.
 */
export async function loadSessionTurns(admin: Admin, sessionId: string, userId: string, currentMessage: string) {
  const { data, error } = await admin
    .from("sage_journal_messages")
    .select("role, content")
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(SHADOW_CONTEXT_TURNS + 1);
  if (error || !data) return [];
  const rows = [...(data as { role?: string | null; content?: string | null }[])].reverse();
  return shadowTurnsFromJournal(rows, currentMessage);
}
