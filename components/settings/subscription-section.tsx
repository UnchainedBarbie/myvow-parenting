"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { showErrorToast, showSuccessToast } from "@/components/ui/toaster";

type SubscriptionResponse = {
  subscription_status: string | null;
  subscription_tier: string | null;
  subscription_period_end: string | null;
  pilot_user: boolean | null;
};

type Tier = "free" | "plus" | "pro";

const PLUS_PRICE_ID =
  process.env.NEXT_PUBLIC_STRIPE_PLUS_PRICE_ID ?? "";
const PRO_PRICE_ID =
  process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID ?? "";

export function SubscriptionSection() {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<SubscriptionResponse | null>(null);
  const [plusLoading, setPlusLoading] = useState(false);
  const [proLoading, setProLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    const upgraded = searchParams.get("upgraded");
    if (upgraded === "true") {
      showSuccessToast("You're all set!");
    }
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/stripe/subscription");
        if (!res.ok) {
          throw new Error("Failed to load subscription");
        }
        const data = (await res.json()) as SubscriptionResponse;
        if (!cancelled) setState(data);
      } catch (e) {
        if (!cancelled) {
          showErrorToast("Unable to load subscription status.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading && !state) {
    return (
      <Card className="shadow-card border-border rounded-card">
        <CardContent className="px-4 py-4 text-sm text-foreground-secondary">
          Loading subscription…
        </CardContent>
      </Card>
    );
  }

  const pilot = state?.pilot_user === true;

  if (pilot) {
    return (
      <Card className="shadow-card border-border rounded-card">
        <CardHeader className="pb-2 px-4 pt-4">
          <CardTitle className="font-heading text-lg text-foreground">
            Your subscription
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-2">
          <span className="inline-flex items-center rounded-full bg-[#EEF2E9] px-3 py-1 text-xs font-medium text-[#5B7A52]">
            Pilot Member — Free for Life 🌱
          </span>
          <p className="text-sm text-foreground-secondary">
            Thank you for being an early believer in MyVow.
          </p>
        </CardContent>
      </Card>
    );
  }

  const rawTier = (state?.subscription_tier ?? "free").toLowerCase();
  const tier: Tier =
    rawTier === "plus" || rawTier === "pro" ? (rawTier as Tier) : "free";

  async function handleUpgrade(priceId: string, setBusy: (v: boolean) => void) {
    if (!priceId) {
      showErrorToast("Subscription price is not configured.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/stripe/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ price_id: priceId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data?.pilot) {
          showSuccessToast("You're on our pilot plan and already free for life.");
          return;
        }
        throw new Error(data?.message ?? "Failed to start checkout");
      }
      if (data?.pilot) {
        showSuccessToast("You're on our pilot plan and already free for life.");
        return;
      }
      if (typeof data?.url === "string") {
        window.location.href = data.url;
      } else {
        throw new Error("No checkout URL returned");
      }
    } catch (e) {
      showErrorToast("Unable to start checkout. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleManagePortal() {
    setPortalLoading(true);
    try {
      const res = await fetch("/api/stripe/portal");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 403 && data?.error) {
          showErrorToast(data.error);
          return;
        }
        throw new Error(data?.message ?? "Failed to open billing portal");
      }
      if (typeof data?.url === "string") {
        window.location.href = data.url;
      } else {
        throw new Error("No portal URL returned");
      }
    } catch (e) {
      showErrorToast("Unable to open billing portal. Please try again.");
    } finally {
      setPortalLoading(false);
    }
  }

  if (tier === "free") {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="shadow-card border-border rounded-card">
          <CardHeader className="pb-2 px-4 pt-4">
            <CardTitle className="font-heading text-lg text-foreground">
              Plus — $12.99 / month
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 text-sm text-foreground-secondary space-y-2">
            <ul className="list-disc pl-5 space-y-1">
              <li>Unlimited message history</li>
              <li>Enhanced reports and exports</li>
              <li>Priority support</li>
            </ul>
            <Button
              type="button"
              className="mt-3 rounded-full"
              disabled={plusLoading}
              onClick={() => handleUpgrade(PLUS_PRICE_ID, setPlusLoading)}
            >
              {plusLoading ? "Starting checkout…" : "Upgrade to Plus"}
            </Button>
          </CardContent>
        </Card>
        <Card className="shadow-card border-border rounded-card">
          <CardHeader className="pb-2 px-4 pt-4">
            <CardTitle className="font-heading text-lg text-foreground">
              Pro — $24.99 / month
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 text-sm text-foreground-secondary space-y-2">
            <ul className="list-disc pl-5 space-y-1">
              <li>Everything in Plus</li>
              <li>Advanced AI insights and flags</li>
              <li>Priority court-ready export tools</li>
            </ul>
            <Button
              type="button"
              className="mt-3 rounded-full"
              disabled={proLoading}
              onClick={() => handleUpgrade(PRO_PRICE_ID, setProLoading)}
            >
              {proLoading ? "Starting checkout…" : "Upgrade to Pro"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const tierLabel = tier === "plus" ? "Plus" : "Pro";

  return (
    <Card className="shadow-card border-border rounded-card">
      <CardHeader className="pb-2 px-4 pt-4">
        <CardTitle className="font-heading text-lg text-foreground">
          Your subscription
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 flex flex-col gap-3 text-sm text-foreground-secondary">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-[#EEF2E9] px-3 py-1 text-xs font-medium text-[#5B7A52]">
            {tierLabel} member
          </span>
          {state?.subscription_period_end && (
            <span className="text-xs text-foreground-secondary">
              Renews on{" "}
              {new Date(state.subscription_period_end).toLocaleDateString(
                "en-US",
                { month: "short", day: "numeric", year: "numeric" }
              )}
            </span>
          )}
        </div>
        <div>
          <Button
            type="button"
            variant="outline"
            className="rounded-full"
            disabled={portalLoading}
            onClick={handleManagePortal}
          >
            {portalLoading ? "Opening portal…" : "Manage subscription"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

