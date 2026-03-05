import { NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

/**
 * Lightweight subscription status endpoint for settings UI.
 *
 * Returns:
 * - tier: "FREE" | "PLUS" | "PRO" (or backend enum mapped)
 * - status: "active" | "canceled" | "none" | "cancel_at_period_end" | "trialing"
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ tier: "FREE", status: "none" });
    }

    const admin = getServiceRoleClient();
    const { data: row } = await admin
      .from("users")
      .select("subscription_tier, stripe_subscription_id")
      .eq("id", user.id)
      .maybeSingle();

    const baseTier = (row?.subscription_tier as string | null) ?? "base";
    let tier: "FREE" | "PLUS" | "PRO" = "FREE";
    if (baseTier === "standard") tier = "PLUS";
    if (baseTier === "premium") tier = "PRO";

    const status: "active" | "canceled" | "none" | "cancel_at_period_end" | "trialing" =
      row?.stripe_subscription_id ? "active" : "none";

    return NextResponse.json({ tier, status });
  } catch (e) {
    return NextResponse.json(
      { tier: "FREE", status: "none", error: e instanceof Error ? e.message : "Failed" },
      { status: 200 }
    );
  }
}

