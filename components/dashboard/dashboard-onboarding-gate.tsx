"use client";

import { useState, useEffect, useCallback } from "react";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { OnboardingChecklistCard } from "@/components/dashboard/onboarding-checklist-card";

interface OnboardingState {
  onboarding_completed: boolean;
  onboarding_step: number | null;
  app_mode: string | null;
}

interface DashboardOnboardingGateProps {
  contentAboveChecklist: React.ReactNode;
  contentBelowChecklist: React.ReactNode;
}

export function DashboardOnboardingGate({
  contentAboveChecklist,
  contentBelowChecklist,
}: DashboardOnboardingGateProps) {
  const [onboarding, setOnboarding] = useState<OnboardingState | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchOnboarding = useCallback(async () => {
    try {
      const res = await fetch("/api/onboarding");
      if (res.ok) {
        const data = await res.json();
        setOnboarding({
          onboarding_completed: data.onboarding_completed ?? false,
          onboarding_step:
            data.onboarding_step != null ? Number(data.onboarding_step) : null,
          app_mode: data.app_mode ?? null,
        });
      } else {
        setOnboarding(null);
      }
    } catch {
      setOnboarding(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOnboarding();
  }, [fetchOnboarding]);

  const step = onboarding?.onboarding_step ?? null;
  const completed = onboarding?.onboarding_completed ?? false;
  const showWizard =
    !loading &&
    !completed &&
    (step === 0 || step === null);
  const showChecklist =
    !loading && !completed && step != null && Number(step) > 0;

  return (
    <>
      {showWizard && (
        <OnboardingWizard
          onComplete={() => {
            fetchOnboarding();
          }}
        />
      )}
      <div className="space-y-4">
        {contentAboveChecklist}
        {showChecklist && onboarding && (
          <OnboardingChecklistCard
            onboardingStep={Number(step)}
            appMode={onboarding.app_mode}
            onDismiss={fetchOnboarding}
          />
        )}
        {contentBelowChecklist}
      </div>
    </>
  );
}
