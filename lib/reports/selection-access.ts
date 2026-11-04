/** Raised when a requested id is missing from the records this parent can access. */
export class SelectionAccessError extends Error {
  readonly unavailableCount: number;

  constructor(count: number) {
    super("Some selected records are not available.");
    this.name = "SelectionAccessError";
    this.unavailableCount = count;
  }
}

export function uniqueSelectedIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const raw of ids) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return unique;
}

/** Records whose ids were requested, in request order. Other records are left out. */
export function recordsForSelection<T extends { id: string }>(records: T[], ids: string[]): T[] {
  const byId = new Map(records.map((record) => [record.id, record]));
  return uniqueSelectedIds(ids).map((id) => byId.get(id)).filter((record): record is T => Boolean(record));
}

export function missingSelectedIds(records: { id: string }[], ids: string[]): string[] {
  const have = new Set(records.map((record) => record.id));
  return uniqueSelectedIds(ids).filter((id) => !have.has(id));
}
