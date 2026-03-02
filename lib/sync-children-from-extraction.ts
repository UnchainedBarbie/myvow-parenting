import type { ClassifyPayload } from "@/lib/ai-classify";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Given AI extraction payload with child_names, ensure all those children exist for the case.
 * Matches existing children by first_name (case-insensitive). Inserts any missing children
 * with date_of_birth null (DOB can be added to extraction later if needed).
 */
export async function syncChildrenFromExtraction(
  admin: SupabaseClient,
  case_id: string,
  payload: Pick<ClassifyPayload, "child_names">
): Promise<void> {
  const childNames = Array.isArray(payload.child_names) ? payload.child_names : [];
  if (childNames.length === 0) return;

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

  for (const name of childNames) {
    const trimmed = String(name).trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (existingNames.has(key)) continue;

    const { error } = await admin
      .from("children")
      .insert({
        case_id,
        first_name: trimmed,
        date_of_birth: null,
      })
      .select("id");

    if (error) {
      console.warn("[sync-children-from-extraction] Insert failed for", trimmed, error);
      continue;
    }
    existingNames.add(key);
  }
}
