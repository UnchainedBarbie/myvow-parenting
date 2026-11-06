import type { getServiceRoleClient } from "@/lib/supabase/server";
import { matchChildren } from "@/lib/sage/calendar-chat";

type Admin = ReturnType<typeof getServiceRoleClient>;

export function parseChildIds(childIdsRaw: unknown, childId?: string | null): string[] {
  if (Array.isArray(childIdsRaw)) {
    return [
      ...new Set(
        childIdsRaw
          .map((value) => (typeof value === "string" ? value.trim() : ""))
          .filter(Boolean)
      ),
    ];
  }
  if (typeof childId === "string" && childId.trim()) return [childId.trim()];
  return [];
}

/** Join rows win. An empty join falls back to the single child column, the same way expenses do. */
export function assignedChildIds(input: {
  childIds?: string[] | null;
  childId?: string | null;
}): string[] {
  const linked = parseChildIds(input.childIds);
  if (linked.length > 0) return linked;
  return parseChildIds(undefined, input.childId);
}

/**
 * Children named in this message. A name counts only as a whole word.
 * No name, or a phrase like "the children", assigns none.
 */
export function proposedChildIds(
  text: string,
  children: { id: string; first_name: string | null }[]
): string[] {
  const known = children
    .map((child) => ({ id: child.id, name: (child.first_name ?? "").trim() }))
    .filter((child) => child.name.length > 0);
  return matchChildren(text, known).map((child) => child.id);
}

export async function proposeConversationChildren(
  admin: Admin,
  caseId: string,
  text: string
): Promise<string[]> {
  const { data, error } = await admin
    .from("children")
    .select("id, first_name")
    .eq("case_id", caseId)
    .is("deleted_at", null);
  if (error || !data) return [];
  return proposedChildIds(text, data as { id: string; first_name: string | null }[]);
}

/** Delete this conversation's rows, then insert the new set. An empty set leaves it unassigned. */
export async function replaceConversationChildren(
  admin: Admin,
  conversationId: string,
  childIds: string[]
): Promise<{ error: string | null; missing?: boolean }> {
  const { error: deleteError } = await admin
    .from("conversation_children")
    .delete()
    .eq("conversation_id", conversationId);
  if (deleteError) {
    return { error: deleteError.message, missing: isMissingChildrenTable(deleteError.message) };
  }
  if (childIds.length === 0) return { error: null };
  const { error: insertError } = await admin.from("conversation_children").insert(
    childIds.map((child_id) => ({ conversation_id: conversationId, child_id }))
  );
  if (insertError) {
    return { error: insertError.message, missing: isMissingChildrenTable(insertError.message) };
  }
  return { error: null };
}

export function isMissingChildrenTable(message: string | null | undefined): boolean {
  const text = (message ?? "").toLowerCase();
  return text.includes("conversation_children") && (text.includes("does not exist") || text.includes("could not find"));
}
