import type { getServiceRoleClient } from "@/lib/supabase/server";
import {
  cancelPendingMessages,
  revisePendingCalendar,
  type ChatControl,
  type PendingRevision,
} from "@/lib/sage/chat-intent";

type Admin = ReturnType<typeof getServiceRoleClient>;

/**
 * Apply a cancel or a pending-calendar correction to proposals already stored
 * in this Sage session. Does not create a second proposal.
 */
export async function applySessionControl(
  admin: Admin,
  sessionId: string,
  userId: string,
  control: ChatControl,
  revision: PendingRevision | null
): Promise<{ id: string; plan: Record<string, unknown> } | null> {
  if (control !== "cancel_message" && control !== "revise_pending") return null;
  const { data: journals, error: journalErr } = await admin
    .from("sage_journal_messages")
    .select("sage_item_id")
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .not("sage_item_id", "is", null);
  if (journalErr || !journals) return null;

  const itemIds = [
    ...new Set(
      (journals as { sage_item_id?: string | null }[])
        .map((row) => row.sage_item_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    ),
  ];
  if (itemIds.length === 0) return null;

  const { data: items, error: itemErr } = await admin
    .from("sage_items")
    .select("id, plan, created_at")
    .in("id", itemIds)
    .eq("visible_to", userId)
    .order("created_at", { ascending: false });
  if (itemErr || !items) return null;

  let updated: { id: string; plan: Record<string, unknown> } | null = null;
  for (const row of items as { id?: string; plan?: { proposals?: unknown[] } | null }[]) {
    if (!row.id || !row.plan || !Array.isArray(row.plan.proposals)) continue;
    const applied =
      control === "cancel_message"
        ? cancelPendingMessages(row.plan.proposals, new Date().toISOString())
        : revision
          ? revisePendingCalendar(row.plan.proposals, revision)
          : { proposals: row.plan.proposals, changed: false, canceled: 0 };
    const changed = "canceled" in applied ? applied.canceled > 0 : applied.changed;
    if (!changed) continue;
    const plan = { ...row.plan, proposals: applied.proposals };
    const { error } = await admin
      .from("sage_items")
      .update({ plan })
      .eq("id", row.id)
      .eq("visible_to", userId);
    if (error) {
      console.error("[sage/chat-control] update failed:", error.message);
      continue;
    }
    updated = { id: row.id, plan };
    if (control === "revise_pending") break;
  }
  return updated;
}
