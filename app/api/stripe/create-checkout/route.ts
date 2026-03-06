import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const admin = getServiceRoleClient();
    const { data: membership } = await admin
      .from("case_members")
      .select("case_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (!membership?.case_id) {
      return NextResponse.json(
        { message: "No case found for user" },
        { status: 404 }
      );
    }

    const { data: caseRow, error: caseError } = await admin
      .from("cases")
      .select("id, stripe_customer_id, pilot_user")
      .eq("id", membership.case_id)
      .maybeSingle();

    if (caseError || !caseRow) {
      return NextResponse.json(
        { message: "Case not found" },
        { status: 404 }
      );
    }

    const row = caseRow as {
      id: string;
      stripe_customer_id?: string | null;
      pilot_user?: boolean | null;
    };

    if (row.pilot_user === true) {
      return NextResponse.json({ pilot: true }, { status: 200 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      price_id?: string | null;
    };
    const priceId = body.price_id ?? null;
    if (!priceId) {
      return NextResponse.json(
        { message: "Missing price_id" },
        { status: 400 }
      );
    }

    let stripeCustomerId = row.stripe_customer_id ?? null;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: {
          case_id: row.id,
          user_id: user.id,
        },
      });
      stripeCustomerId = customer.id;
      await admin
        .from("cases")
        .update({ stripe_customer_id: stripeCustomerId })
        .eq("id", row.id);
    }

    const origin = request.nextUrl.origin;
    const successUrl = `${origin}/settings?upgraded=true`;
    const cancelUrl = `${origin}/settings`;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: row.id,
    });

    return NextResponse.json({ url: session.url }, { status: 200 });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[stripe/create-checkout] error:", e);
    return NextResponse.json(
      { message: "Failed to create checkout session" },
      { status: 500 }
    );
  }
}

