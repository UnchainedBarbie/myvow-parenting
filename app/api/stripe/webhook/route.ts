import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";
import type Stripe from "stripe";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const admin = getServiceRoleClient();
  const sig = request.headers.get("stripe-signature") ?? "";
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret || !sig) {
    // Missing config; do nothing but acknowledge to avoid retries.
    return NextResponse.json({ received: true }, { status: 200 });
  }

  let event: Stripe.Event;
  const payload = await request.text();

  try {
    event = stripe.webhooks.constructEvent(payload, sig, secret);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[stripe/webhook] signature verification failed:", err);
    return NextResponse.json({ received: true }, { status: 200 });
  }

  function mapTierFromPriceId(priceId: string | null | undefined): string {
    const plusId = process.env.STRIPE_PLUS_PRICE_ID;
    const proId = process.env.STRIPE_PRO_PRICE_ID;
    if (priceId && plusId && priceId === plusId) return "plus";
    if (priceId && proId && priceId === proId) return "pro";
    return "free";
  }

  async function updateCaseForCustomer(
    customerId: string | null | undefined,
    update: Record<string, unknown>
  ) {
    if (!customerId) return;
    const { data: caseRow } = await admin
      .from("cases")
      .select("id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();
    if (!caseRow?.id) return;
    await admin.from("cases").update(update).eq("id", caseRow.id);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const customerId =
          typeof session.customer === "string"
            ? session.customer
            : (session.customer as Stripe.Customer | null)?.id;

        let subscription: Stripe.Subscription | null = null;
        if (session.subscription) {
          const subId =
            typeof session.subscription === "string"
              ? session.subscription
              : (session.subscription as Stripe.Subscription).id;
          try {
            subscription = await stripe.subscriptions.retrieve(subId);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error(
              "[stripe/webhook] failed to retrieve subscription:",
              err
            );
          }
        }

        if (subscription && customerId) {
          const priceId =
            subscription.items.data[0]?.price?.id ??
            (subscription.items.data[0]?.plan as Stripe.Plan | undefined)
              ?.id ??
            null;
          const tier = mapTierFromPriceId(priceId);
          const periodEnd = (subscription as any).current_period_end
            ? new Date((subscription as any).current_period_end * 1000).toISOString()
            : null;
          const status = subscription.status ?? "active";
          await updateCaseForCustomer(customerId, {
            subscription_status: status,
            subscription_tier: tier,
            subscription_period_end: periodEnd,
          });
        }
        break;
      }
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId =
          typeof subscription.customer === "string"
            ? subscription.customer
            : (subscription.customer as Stripe.Customer).id;
        const priceId =
          subscription.items.data[0]?.price?.id ??
          (subscription.items.data[0]?.plan as Stripe.Plan | undefined)?.id ??
          null;
        const tier = mapTierFromPriceId(priceId);
        const periodEnd = (subscription as any).current_period_end
          ? new Date((subscription as any).current_period_end * 1000).toISOString()
          : null;
        const status = subscription.status ?? "active";
        await updateCaseForCustomer(customerId, {
          subscription_status: status,
          subscription_tier: tier,
          subscription_period_end: periodEnd,
        });
        break;
      }
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId =
          typeof subscription.customer === "string"
            ? subscription.customer
            : (subscription.customer as Stripe.Customer).id;
        await updateCaseForCustomer(customerId, {
          subscription_status: "canceled",
          subscription_tier: "free",
          subscription_period_end: null,
        });
        break;
      }
      default:
        break;
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[stripe/webhook] handler error:", err);
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
