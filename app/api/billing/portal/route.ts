import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Placeholder Stripe billing portal session creator.
 *
 * In a full implementation, this would:
 * - ensure the user has a Stripe customer id
 * - create a Stripe Billing Portal session
 * - return { url } for the client to redirect to
 *
 * For now, if STRIPE_SECRET_KEY is not configured, this returns 400.
 */
export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ error: "Billing not configured" }, { status: 400 });
    }

    // TODO: Implement real Stripe Billing Portal session creation.
    return NextResponse.json({ error: "Billing portal not yet implemented" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Portal failed" },
      { status: 500 }
    );
  }
}

