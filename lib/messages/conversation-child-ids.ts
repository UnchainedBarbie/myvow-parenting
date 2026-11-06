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

export type ConversationRowChildLabel = {
  /** Short sidebar text. One name, or the first name plus a count. */
  label: string;
  /** Every assigned name, in case order. */
  full: string;
};

/**
 * Sidebar child indicator. Nothing assigned, or every child on the case,
 * distinguishes nothing, so the row stays blank. A partial assignment shows
 * the first name, and a count when more than one child is included.
 */
export function conversationRowChildLabel(
  assignedIds: readonly string[],
  caseChildren: readonly { id: string; first_name: string }[]
): ConversationRowChildLabel | null {
  if (assignedIds.length === 0 || caseChildren.length === 0) return null;
  const assigned = new Set(assignedIds);
  if (caseChildren.every((child) => assigned.has(child.id))) return null;
  const names = caseChildren
    .filter((child) => assigned.has(child.id))
    .map((child) => child.first_name.trim())
    .filter((name) => name.length > 0);
  if (names.length === 0) return null;
  const extra = names.length - 1;
  return {
    label: extra > 0 ? `${names[0]} +${extra}` : names[0],
    full: names.join(", "),
  };
}
