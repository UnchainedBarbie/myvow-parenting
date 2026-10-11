import { getServiceRoleClient } from "@/lib/supabase/server";

/**
 * Who owns this intake address.
 * Today the address belongs to the case (cases.ingest_email).
 * A later member-owned address replaces this function only.
 */
export async function resolveIntakeCase(
  toAddress: string
): Promise<{ caseId: string } | { error: string } | null> {
  const admin = getServiceRoleClient();
  const { data, error } = await admin
    .from("cases")
    .select("id")
    .eq("ingest_email", toAddress)
    .limit(1)
    .maybeSingle();
  if (error) return { error: error.message };
  const caseId = (data as { id?: string } | null)?.id;
  if (!caseId) return null;
  return { caseId };
}
