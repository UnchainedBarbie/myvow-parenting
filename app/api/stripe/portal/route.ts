import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
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

    if ((row as { pilot_user?: boolean | null }).pilot_user === true) {
      return NextResponse.json(
        { error: "Pilot users do not have a billing portal" },
        { status: 403 }
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

    const returnUrl = `${request.nextUrl.origin}/settings`;
    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: returnUrl,
    });

    return NextResponse.json({ url: session.url }, { status: 200 });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[stripe/portal] error:", e);
    return NextResponse.json(
      { message: "Failed to create billing portal session" },
      { status: 500 }
    );
  }
}

