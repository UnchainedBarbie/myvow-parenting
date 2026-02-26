import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server";

/**
 * Handle Stripe subscription events. Update users.subscription_tier, stripe_customer_id, etc.
 * Verify webhook signature with STRIPE_WEBHOOK_SECRET.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const sig = request.headers.get("stripe-signature");
    if (!process.env.STRIPE_WEBHOOK_SECRET || !sig) {
      return NextResponse.json(
        { message: "Webhook not configured" },
        { status: 400 }
      );
    }
    // Stripe SDK would verify and parse here
    const admin = getServiceRoleClient();
    // Placeholder: in production parse event and update users table
    return NextResponse.json({ received: true });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Webhook failed" },
      { status: 500 }
    );
  }
}
