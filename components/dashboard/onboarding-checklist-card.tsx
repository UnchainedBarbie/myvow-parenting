"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { X } from "lucide-react";

const STEP_LINKS: Array<{
  step: number;
  label: string;
  href: string;
  showIfCoparenting?: boolean;
}> = [
  { step: 2, label: "Choose app mode", href: "/settings" },
  { step: 3, label: "Add your first child", href: "/profile" },
  { step: 4, label: "Upload parenting plan", href: "/documents", showIfCoparenting: true },
  { step: 5, label: "Invite co-parent", href: "/settings", showIfCoparenting: true },
];

interface OnboardingChecklistCardProps {
  onboardingStep: number;
  appMode: string | null;
  onDismiss: () => void;
}

export function OnboardingChecklistCard({
  onboardingStep,
  appMode,
  onDismiss,
}: OnboardingChecklistCardProps) {
  const [dismissing, setDismissing] = useState(false);
  const isCoparenting =
    appMode === "coparenting" || appMode === "solo_coparenting";

  const remainingSteps = STEP_LINKS.filter((s) => {
    if (s.step <= onboardingStep) return false;
    if (s.showIfCoparenting && !isCoparenting) return false;
    return true;
  });

  async function handleDismiss() {
    setDismissing(true);
    try {
      await fetch("/api/onboarding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onboarding_completed: true }),
      });
      onDismiss();
    } finally {
      setDismissing(false);
    }
  }

  return (
    <Card className="shadow-card border-border rounded-card relative">
      <CardHeader className="pb-2 px-4 pt-4 pr-10">
        <CardTitle className="font-heading text-lg text-foreground">
          Finish setting up MyVow
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <ul className="space-y-1.5 text-sm">
          {remainingSteps.map((s) => (
            <li key={s.step}>
              <Link
                href={s.href}
                className="text-[#7B9E87] hover:underline hover:text-[#6A8A78]"
              >
                {s.label}
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
      <button
        type="button"
        onClick={handleDismiss}
        disabled={dismissing}
        className="absolute top-3 right-3 p-1.5 rounded-full text-foreground-secondary hover:text-foreground hover:bg-muted disabled:opacity-50"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </Card>
  );
}
