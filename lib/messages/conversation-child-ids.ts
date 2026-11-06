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
