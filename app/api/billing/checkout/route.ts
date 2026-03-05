import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Placeholder Stripe checkout session creator.
 *
 * In a full implementation, this would:
 * - validate the requested plan ("PLUS" | "PRO")
 * - create a Stripe Checkout Session with the correct priceId
 * - return { url } for the client to redirect to
 *
 * For now, if STRIPE_SECRET_KEY is not configured, this returns 400.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const plan = (body.plan as string | undefined) ?? "";

    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ error: "Billing not configured" }, { status: 400 });
    }

    if (plan !== "PLUS" && plan !== "PRO") {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }

    // TODO: Implement real Stripe Checkout session creation.
    return NextResponse.json({ error: "Checkout not yet implemented" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Checkout failed" },
      { status: 500 }
    );
  }
}

