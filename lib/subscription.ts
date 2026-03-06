import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

export type SubscriptionTier = "free" | "plus" | "pro";

export async function getUserTier(): Promise<SubscriptionTier> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return "free";
  }

  const admin = getServiceRoleClient();

  const { data: membership, error: membershipError } = await admin
    .from("case_members")
    .select("case_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (membershipError || !membership?.case_id) {
    return "free";
  }

  const { data: caseRow, error: caseError } = await admin
    .from("cases")
    .select("subscription_tier")
    .eq("id", membership.case_id)
    .maybeSingle();

  if (caseError || !caseRow) {
    return "free";
  }

  const raw =
    (caseRow as { subscription_tier?: string | null }).subscription_tier ??
    "free";
  const normalized = String(raw).toLowerCase();

  if (normalized === "plus") return "plus";
  if (normalized === "pro") return "pro";
  return "free";
}

