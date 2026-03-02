import type { ClassifyPayload } from "@/lib/ai-classify";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Given AI extraction payload with child_names / children, ensure all those children exist for the case.
 * Matches existing children by first_name (case-insensitive). Inserts any missing children
 * and maps date_of_birth when provided (YYYY-MM-DD) on the payload.
 */
export async function syncChildrenFromExtraction(
  admin: SupabaseClient,
  case_id: string,
  payload: Pick<ClassifyPayload, "child_names" | "children">
): Promise<void> {
  // Prefer structured children with DOBs when present.
  const structured = Array.isArray(payload.children)
    ? (payload.children as { first_name?: string; date_of_birth?: string | null }[])
    : [];

  const childrenToSync: { first_name: string; date_of_birth: string | null }[] =
    structured.length > 0
      ? structured
          .map((c) => {
            const first = typeof c.first_name === "string" ? c.first_name.trim() : "";
            if (!first) return null;
            let dob: string | null = null;
            if (c.date_of_birth != null) {
              const raw = String(c.date_of_birth).slice(0, 10);
              dob = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
            }
            return { first_name: first, date_of_birth: dob };
          })
          .filter((c): c is { first_name: string; date_of_birth: string | null } => !!c)
      : (Array.isArray(payload.child_names) ? payload.child_names : []).map((name) => ({
          first_name: String(name).trim(),
          date_of_birth: null,
        }));

  const filtered = childrenToSync.filter((c) => !!c.first_name);
  if (filtered.length === 0) return;

  const { data: existing } = await admin
    .from("children")
    .select("id, first_name")
    .eq("case_id", case_id)
    .is("deleted_at", null);

  const existingNames = new Set(
    ((existing ?? []) as { id: string; first_name: string }[]).map((c) =>
      c.first_name.trim().toLowerCase()
    )
  );

  for (const child of filtered) {
    const trimmed = child.first_name.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (existingNames.has(key)) continue;

    const { error } = await admin
      .from("children")
      .insert({
        case_id,
        first_name: trimmed,
        date_of_birth: child.date_of_birth,
      })
      .select("id");

    if (error) {
      console.warn("[sync-children-from-extraction] Insert failed for", trimmed, error);
      continue;
    }
    existingNames.add(key);
  }
}
