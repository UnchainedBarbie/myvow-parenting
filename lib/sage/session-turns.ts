import type { getServiceRoleClient } from "@/lib/supabase/server";
import { SHADOW_CONTEXT_TURNS, shadowTurnsFromJournal } from "@/lib/sage/shadow-context";

type Admin = ReturnType<typeof getServiceRoleClient>;

/**
 * Recent turns of one parent's own Sage session, oldest first, each with its speaker.
 * Rows are limited to the session and to the signed-in parent. Another parent's session is never read.
 */
export async function loadSessionTurns(
  admin: Admin,
  sessionId: string,
  userId: string,
  currentMessage: string,
  opts?: { limit?: number; maxChars?: number }
) {
  const limit = opts?.limit ?? SHADOW_CONTEXT_TURNS;
  const maxChars = opts?.maxChars ?? 240;
  const { data, error } = await admin
    .from("sage_journal_messages")
    .select("role, content")
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit + 1);
  if (error || !data) return [];
  const rows = [...(data as { role?: string | null; content?: string | null }[])].reverse();
  if (opts == null) return shadowTurnsFromJournal(rows, currentMessage);
  const turns: { role: "parent" | "sage"; text: string }[] = [];
  for (const row of rows as { role?: string | null; content?: string | null }[]) {
    const role = row.role === "sage" ? "sage" : row.role === "user" || row.role === "parent" ? "parent" : null;
    if (!role) continue;
    const text = (row.content ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    turns.push({ role, text: text.slice(0, maxChars) });
  }
  const current = currentMessage.replace(/\s+/g, " ").trim();
  const last = turns[turns.length - 1];
  if (last?.role === "parent" && current && last.text.toLowerCase() === current.toLowerCase()) {
    turns.pop();
  }
  return turns.slice(-limit);
}
