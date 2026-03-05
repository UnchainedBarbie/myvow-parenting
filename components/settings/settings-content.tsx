"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, ChevronDown, Feather, Moon, Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { showErrorToast, showSuccessToast } from "@/components/ui/toaster";

type AppMode = "solo" | "partner" | "coparenting" | "solo_coparenting";
type AiModerationLevel = "off" | "standard" | "high";

type CaseSettings = {
  case_id: string | null;
  app_mode: AppMode;
  mode?: AppMode;
  message_delay_minutes: number;
  ai_moderation_level: AiModerationLevel;
  messaging_window_start: string | null;
  messaging_window_end: string | null;
  quiet_hours_enabled: boolean;
};

function CollapsibleCard({
  open,
  onToggle,
  title,
  subtitle,
  headerAction,
  children: content,
}: {
  open: boolean;
  onToggle: () => void;
  title: React.ReactNode;
  subtitle?: string;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="shadow-card border-border rounded-card">
      <CardHeader
        className="pb-2 px-4 pt-4 flex flex-row items-center gap-2 cursor-pointer hover:bg-muted/30 transition-colors rounded-t-card"
        onClick={onToggle}
      >
        {open ? (
          <ChevronDown className="h-5 w-5 text-foreground-secondary shrink-0" />
        ) : (
          <ChevronRight className="h-5 w-5 text-foreground-secondary shrink-0" />
        )}
        <div className="min-w-0">
          <CardTitle className="font-heading text-lg text-foreground">{title}</CardTitle>
          {subtitle && (
            <p className="text-xs text-foreground-secondary mt-0.5">{subtitle}</p>
          )}
        </div>
        {headerAction && (
          <div className="ml-auto shrink-0" onClick={(e) => e.stopPropagation()}>
            {headerAction}
          </div>
        )}
      </CardHeader>
      {open && (
        <CardContent className="px-4 pb-4 pt-0 overflow-hidden transition-all">
          {content}
        </CardContent>
      )}
    </Card>
  );
}

export type SettingsContentProps = {
  profile: { full_name?: string | null; email?: string | null } | null;
};

export function SettingsContent({ profile }: SettingsContentProps) {
  const router = useRouter();
  const [openCommunication, setOpenCommunication] = useState(false);
  const [openNotifications, setOpenNotifications] = useState(false);
  const [openSubscription, setOpenSubscription] = useState(false);
  const [openSage, setOpenSage] = useState(false);
  const [openCoolOff, setOpenCoolOff] = useState(false);
  const [openPrivacy, setOpenPrivacy] = useState(false);
  const [openAccount, setOpenAccount] = useState(false);

  const [currentPlan, setCurrentPlan] = useState<"FREE" | "PLUS" | "PRO">("FREE");
  const [subscriptionStatus, setSubscriptionStatus] = useState<"active" | "canceled" | "none">(
    "none"
  );

  const [caseSettings, setCaseSettings] = useState<CaseSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);

  const [appMode, setAppMode] = useState<AppMode>("partner");
  const [aiLevel, setAiLevel] = useState<AiModerationLevel>("standard");
  const [messageDelay, setMessageDelay] = useState(0);
  const [messagingWindowStart, setMessagingWindowStart] = useState("");
  const [messagingWindowEnd, setMessagingWindowEnd] = useState("");
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(false);
  const [timezone, setTimezone] = useState<string>(
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : "America/Denver"
  );

  const [emailNotifications, setEmailNotifications] = useState(true);
  const [pushNotifications, setPushNotifications] = useState(false);
  const [notificationFrequency, setNotificationFrequency] = useState<"immediate" | "daily">("immediate");

  const [userSettings, setUserSettings] = useState<{
    sage_message_review: boolean;
    proactive_sage_enabled: boolean;
    vow_references: boolean;
    default_pause_duration: string;
    send_read_receipts: boolean;
    delivery_window_enabled: boolean;
    delivery_start_time: string | null;
    delivery_end_time: string | null;
  } | null>(null);
  const [coolOffActive, setCoolOffActive] = useState<{ ends_at: string } | null>(null);
  const [showCoolOffSelector, setShowCoolOffSelector] = useState(false);
  const [startingCoolOff, setStartingCoolOff] = useState(false);
  const [coolOffHours, setCoolOffHours] = useState(4);
  const [endingCoolOff, setEndingCoolOff] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/cases/settings");
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (data.case_id) {
          const mode = (data.mode ?? data.app_mode) as AppMode;
          const validMode: AppMode = ["solo", "partner", "coparenting", "solo_coparenting"].includes(mode) ? mode : "partner";
          setCaseSettings({
            case_id: data.case_id,
            app_mode: validMode,
            mode: validMode,
            message_delay_minutes: Number(data.message_delay_minutes) ?? 0,
            ai_moderation_level: (data.ai_moderation_level as AiModerationLevel) ?? "standard",
            messaging_window_start: data.messaging_window_start ?? null,
            messaging_window_end: data.messaging_window_end ?? null,
            quiet_hours_enabled: !!data.quiet_hours_enabled,
          });
          setAppMode(validMode);
          setMessageDelay(Number(data.message_delay_minutes) ?? 0);
          setAiLevel((data.ai_moderation_level as AiModerationLevel) ?? "standard");
          setMessagingWindowStart(data.messaging_window_start ?? "");
          setMessagingWindowEnd(data.messaging_window_end ?? "");
          setQuietHoursEnabled(!!data.quiet_hours_enabled);
        } else {
          setCaseSettings({
            case_id: null,
            app_mode: "partner",
            mode: "partner",
            message_delay_minutes: 0,
            ai_moderation_level: "standard",
            messaging_window_start: null,
            messaging_window_end: null,
            quiet_hours_enabled: false,
          });
        }
      } finally {
        if (!cancelled) setSettingsLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadSubscription() {
      try {
        const res = await fetch("/api/subscription");
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        const tier = (data.tier as string | undefined)?.toUpperCase();
        if (tier === "PLUS" || tier === "PRO" || tier === "FREE") {
          setCurrentPlan(tier);
        } else if (tier === "STANDARD") {
          setCurrentPlan("PLUS");
        } else if (tier === "PREMIUM") {
          setCurrentPlan("PRO");
        } else {
          setCurrentPlan("FREE");
        }
        const status = (data.status as string | undefined)?.toLowerCase();
        if (status === "active" || status === "trialing") {
          setSubscriptionStatus("active");
        } else if (status === "canceled" || status === "cancel_at_period_end") {
          setSubscriptionStatus("canceled");
        } else {
          setSubscriptionStatus("none");
        }
      } catch {
        // ignore; fallback is FREE
      }
    }
    loadSubscription();
    return () => {
      cancelled = true;
    };
  }, []);

  const billingConfigured =
    typeof process !== "undefined" &&
    !!process.env.NEXT_PUBLIC_BILLING_ENABLED &&
    process.env.NEXT_PUBLIC_BILLING_ENABLED === "true";

  const goToBillingPlaceholder = useCallback(
    (target?: string) => {
      router.push("/billing");
      showSuccessToast("Billing setup coming soon.");
    },
    [router]
  );

  const handleUpgrade = useCallback(
    async (plan: "PLUS" | "PRO") => {
      if (!billingConfigured) {
        goToBillingPlaceholder(plan);
        return;
      }
      try {
        const res = await fetch("/api/billing/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.url) {
          showErrorToast(
            (data as { error?: string }).error ?? "Unable to start checkout. Please try again."
          );
          return;
        }
        window.location.href = data.url as string;
      } catch {
        showErrorToast("Unable to start checkout. Please try again.");
      }
    },
    [billingConfigured, goToBillingPlaceholder]
  );

  const handleManagePlan = useCallback(async () => {
    if (!billingConfigured) {
      goToBillingPlaceholder("manage");
      return;
    }
    try {
      const res = await fetch("/api/billing/portal", {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        showErrorToast(
          (data as { error?: string }).error ?? "Unable to open billing portal. Please try again."
        );
        return;
      }
      window.location.href = data.url as string;
    } catch {
      showErrorToast("Unable to open billing portal. Please try again.");
    }
  }, [billingConfigured, goToBillingPlaceholder]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/settings/user").then((r) => r.json()),
      fetch("/api/messages/cool-off").then((r) => r.json()),
    ]).then(([userData, coolData]) => {
      if (cancelled) return;
      if (userData.sage_message_review !== undefined) {
        setUserSettings({
          sage_message_review: userData.sage_message_review ?? true,
          proactive_sage_enabled: userData.proactive_sage_enabled ?? true,
          vow_references: userData.vow_references ?? true,
          default_pause_duration: userData.default_pause_duration ?? "2hours",
          send_read_receipts: userData.send_read_receipts ?? false,
          delivery_window_enabled: userData.delivery_window_enabled ?? false,
          delivery_start_time: userData.delivery_start_time ?? null,
          delivery_end_time: userData.delivery_end_time ?? null,
        });
      }
      setCoolOffActive((coolData as { active?: { ends_at: string } }).active ?? null);
    });
    return () => { cancelled = true; };
  }, []);

  const saveUserSetting = useCallback(
    async (field: string, value: boolean | string) => {
      const res = await fetch("/api/settings/user", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      setUserSettings((prev) => (prev ? { ...prev, [field]: value } : null));
    },
    []
  );

  const hasCase = !!caseSettings?.case_id;
  const showCommunication = hasCase && (appMode === "coparenting" || appMode === "solo_coparenting");

  const caseDirty =
    hasCase &&
    caseSettings &&
    (messageDelay !== caseSettings.message_delay_minutes ||
      aiLevel !== caseSettings.ai_moderation_level ||
      (messagingWindowStart || "") !== (caseSettings.messaging_window_start ?? "") ||
      (messagingWindowEnd || "") !== (caseSettings.messaging_window_end ?? "") ||
      quietHoursEnabled !== caseSettings.quiet_hours_enabled);

  async function saveCaseSettings() {
    if (!hasCase || !caseDirty) return;
    setSettingsSaving(true);
    try {
      const res = await fetch("/api/cases/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: appMode,
          app_mode: appMode,
          message_delay_minutes: messageDelay,
          ai_moderation_level: aiLevel,
          messaging_window_start: messagingWindowStart || null,
          messaging_window_end: messagingWindowEnd || null,
          quiet_hours_enabled: quietHoursEnabled,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showErrorToast(
          (err as { error?: string }).error ?? "Failed to save"
        );
        return;
      }
      setCaseSettings((prev) =>
        prev
          ? {
              ...prev,
              app_mode: appMode,
              message_delay_minutes: messageDelay,
              ai_moderation_level: aiLevel,
              messaging_window_start: messagingWindowStart || null,
              messaging_window_end: messagingWindowEnd || null,
              quiet_hours_enabled: quietHoursEnabled,
            }
          : null
      );
      router.refresh();
      showSuccessToast("Settings saved");
    } finally {
      setSettingsSaving(false);
    }
  }

  const allSectionsOpen =
    (showCommunication ? openCommunication : true) &&
    openNotifications &&
    openSubscription &&
    openSage &&
    openCoolOff &&
    openPrivacy &&
    openAccount;

  return (
    <div className="space-y-6">
      <p className="text-xs md:text-sm text-foreground-secondary mb-4">
        Subscription, communication, and notifications.
      </p>
      <div className="flex justify-start">
        <button
          type="button"
          className="text-xs text-foreground-secondary hover:text-foreground underline cursor-pointer bg-transparent border-none p-0"
          onClick={() => {
            if (allSectionsOpen) {
              setOpenCommunication(false);
              setOpenNotifications(false);
              setOpenSubscription(false);
              setOpenSage(false);
              setOpenCoolOff(false);
              setOpenPrivacy(false);
              setOpenAccount(false);
            } else {
              setOpenCommunication(true);
              setOpenNotifications(true);
              setOpenSubscription(true);
              setOpenSage(true);
              setOpenCoolOff(true);
              setOpenPrivacy(true);
              setOpenAccount(true);
            }
          }}
        >
          {allSectionsOpen ? "Collapse all" : "Expand all"}
        </button>
      </div>

      <CollapsibleCard
        open={openSubscription}
        onToggle={() => setOpenSubscription((o) => !o)}
        title="Subscription"
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-lg border border-border bg-background p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary">
                Free
              </span>
              {currentPlan === "FREE" ? (
                <span className="rounded-full bg-emerald-600 text-white px-2.5 py-1 text-xs font-medium">
                  Current plan
                </span>
              ) : (
                <button
                  type="button"
                  className="text-xs text-foreground-secondary underline hover:text-foreground bg-transparent border-none p-0"
                  onClick={handleManagePlan}
                >
                  Downgrade to Free
                </button>
              )}
            </div>
            <p className="text-sm text-foreground-secondary flex-1">
              Basic scheduling, documents, calendar
            </p>
          </div>
          <div className="rounded-lg border border-border bg-background p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary">
                Plus
              </span>
              {currentPlan === "PLUS" && (
                <span className="rounded-full bg-emerald-600 text-white px-2.5 py-1 text-xs font-medium">
                  Current plan
                </span>
              )}
            </div>
            <p className="text-sm text-foreground-secondary flex-1">
              Expense tracking, exports, shared visibility
            </p>
            <Button
              size="sm"
              className="mt-1 rounded-full h-8 text-xs"
              disabled={currentPlan === "PLUS"}
              onClick={() => handleUpgrade("PLUS")}
            >
              {currentPlan === "PLUS" ? "Current plan" : "Upgrade to Plus"}
            </Button>
          </div>
          <div className="rounded-lg border border-border bg-background p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary">
                Pro
              </span>
              {currentPlan === "PRO" && (
                <span className="rounded-full bg-emerald-600 text-white px-2.5 py-1 text-xs font-medium">
                  Current plan
                </span>
              )}
            </div>
            <p className="text-sm text-foreground-secondary flex-1">
              AI moderation, court-ready reports, email ingestion, advanced analytics
            </p>
            <Button
              size="sm"
              className="mt-1 rounded-full h-8 text-xs"
              disabled={currentPlan === "PRO"}
              onClick={() => handleUpgrade("PRO")}
            >
              {currentPlan === "PRO" ? "Current plan" : "Upgrade to Pro"}
            </Button>
            {subscriptionStatus === "canceled" && (
              <p className="mt-1 text-[11px] text-foreground-secondary">
                Canceling at end of billing period.
              </p>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-foreground-secondary">
            {subscriptionStatus === "canceled" && "Your subscription will end at the period end."}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="text-xs text-foreground-secondary underline hover:text-foreground bg-transparent border-none p-0"
              onClick={handleManagePlan}
            >
              Manage plan
            </button>
            {(currentPlan === "PLUS" || currentPlan === "PRO") && (
              <button
                type="button"
                className="text-xs text-[#B3583B] underline hover:text-[#8F4630] bg-transparent border-none p-0"
                onClick={handleManagePlan}
              >
                Cancel plan
              </button>
            )}
          </div>
        </div>
      </CollapsibleCard>

      {showCommunication && (
        <CollapsibleCard
          open={openCommunication}
          onToggle={() => setOpenCommunication((o) => !o)}
          title="Communication"
          subtitle="Preferences for co-parent messaging"
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs font-medium text-foreground-secondary">Default pause duration</Label>
              <select
                value={userSettings?.default_pause_duration ?? "2hours"}
                onChange={(e) => {
                  const v = e.target.value as "30min" | "2hours" | "until_tomorrow";
                  setUserSettings((prev) => (prev ? { ...prev, default_pause_duration: v } : null));
                  saveUserSetting("default_pause_duration", v);
                }}
                className="flex h-9 rounded-md border border-input bg-background px-2 py-1 text-sm w-full max-w-xs"
              >
                <option value="30min">30 min</option>
                <option value="2hours">2 hours</option>
                <option value="until_tomorrow">Until tomorrow morning</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="send_read_receipts"
                checked={userSettings?.send_read_receipts ?? false}
                onChange={(e) => {
                  const v = e.target.checked;
                  setUserSettings((prev) => (prev ? { ...prev, send_read_receipts: v } : null));
                  saveUserSetting("send_read_receipts", v);
                }}
                className="rounded border-input"
              />
              <Label htmlFor="send_read_receipts" className="text-sm font-normal cursor-pointer">
                Send read receipts
              </Label>
            </div>
            <p className="text-xs text-foreground-secondary">Read receipts are visible to your co-parent.</p>
            <div className="border-t border-border pt-4 space-y-4">
            <div className="space-y-2">
              <Label className="text-xs font-medium text-foreground-secondary">AI moderation level</Label>
              <select
                value={aiLevel === "high" ? "full" : aiLevel === "standard" ? "gentle" : "off"}
                onChange={(e) => {
                  const v = e.target.value;
                  setAiLevel(v === "full" ? "high" : v === "gentle" ? "standard" : "off");
                }}
                className="flex h-9 rounded-md border border-input bg-background px-2 py-1 text-sm w-full max-w-xs"
              >
                <option value="full">Full</option>
                <option value="gentle">Gentle</option>
                <option value="off">Off</option>
              </select>
              <p className="text-xs text-foreground-secondary">Applies when App Mode is Coparenting or Solo Coparenting.</p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium text-foreground-secondary">Message delay (minutes)</Label>
              <input
                type="number"
                min={0}
                value={messageDelay}
                onChange={(e) => setMessageDelay(Math.max(0, parseInt(e.target.value, 10) || 0))}
                className="flex h-9 w-24 rounded-md border border-input bg-background px-2 py-1 text-sm"
              />
              <p className="text-xs text-foreground-secondary">Optional delay before messages are delivered.</p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium text-foreground-secondary">Messaging window</Label>
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="time"
                  value={messagingWindowStart}
                  onChange={(e) => setMessagingWindowStart(e.target.value)}
                  className="flex h-9 rounded-md border border-input bg-background px-2 py-1 text-sm"
                />
                <span className="text-xs text-foreground-secondary">to</span>
                <input
                  type="time"
                  value={messagingWindowEnd}
                  onChange={(e) => setMessagingWindowEnd(e.target.value)}
                  className="flex h-9 rounded-md border border-input bg-background px-2 py-1 text-sm"
                />
              </div>
              <p className="text-xs text-foreground-secondary">Allowed time range for sending messages.</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="quiet_hours"
                checked={quietHoursEnabled}
                onChange={(e) => setQuietHoursEnabled(e.target.checked)}
                className="rounded border-input"
              />
              <Label htmlFor="quiet_hours" className="text-sm font-normal cursor-pointer">
                Quiet hours (respect messaging window for delivery)
              </Label>
            </div>
            {caseDirty && (
              <Button
                size="sm"
                className="rounded-full h-8 text-xs bg-[#7B9E87] hover:bg-[#6A8A78] text-white"
                onClick={saveCaseSettings}
                disabled={settingsSaving}
              >
                {settingsSaving ? "Saving…" : "Save"}
              </Button>
            )}
            </div>
          </div>
        </CollapsibleCard>
      )}

      <div className="border-t border-border pt-6">
        <CollapsibleCard
          open={openNotifications}
        onToggle={() => setOpenNotifications((o) => !o)}
        title="Notifications"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="email_notifications"
              checked={emailNotifications}
              onChange={(e) => setEmailNotifications(e.target.checked)}
              className="rounded border-input"
            />
            <Label htmlFor="email_notifications" className="text-sm font-normal cursor-pointer">
              Email notifications
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="push_notifications"
              checked={pushNotifications}
              onChange={(e) => setPushNotifications(e.target.checked)}
              className="rounded border-input"
            />
            <Label htmlFor="push_notifications" className="text-sm font-normal cursor-pointer">
              Push notifications
            </Label>
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-medium text-foreground-secondary">Notification frequency</Label>
            <select
              value={notificationFrequency}
              onChange={(e) => setNotificationFrequency(e.target.value as "immediate" | "daily")}
              className="flex h-9 rounded-md border border-input bg-background px-2 py-1 text-sm max-w-xs"
            >
              <option value="immediate">Immediate</option>
              <option value="daily">Daily digest</option>
            </select>
          </div>
          <p className="text-xs text-foreground-secondary">Notification preferences are device-specific.</p>

          <div className="mt-4 border-t border-border pt-4 space-y-3">
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">Delivery window</p>
              <p className="text-xs text-foreground-secondary">
                Control when co-parent messages are delivered to you.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="delivery_window_enabled"
                  checked={userSettings?.delivery_window_enabled ?? false}
                  onChange={async (e) => {
                    const v = e.target.checked;
                    setUserSettings((prev) =>
                      prev ? { ...prev, delivery_window_enabled: v } : null
                    );
                    await saveUserSetting("delivery_window_enabled", v);
                  }}
                  className="rounded border-input"
                />
                <Label
                  htmlFor="delivery_window_enabled"
                  className="text-sm font-normal cursor-pointer"
                >
                  Enable delivery window
                </Label>
              </div>
            </div>

            {userSettings?.delivery_window_enabled && (
              <div className="space-y-2">
                <Label className="text-xs font-medium text-foreground-secondary">
                  Deliver messages between:
                </Label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="time"
                    value={userSettings?.delivery_start_time ?? ""}
                    onChange={async (e) => {
                      const v = e.target.value || null;
                      setUserSettings((prev) =>
                        prev ? { ...prev, delivery_start_time: v } : null
                      );
                      await saveUserSetting("delivery_start_time", v ?? "");
                    }}
                    className="flex h-8 w-28 rounded-md border border-input bg-background px-2 py-1 text-xs"
                  />
                  <span className="text-xs text-foreground-secondary">to</span>
                  <input
                    type="time"
                    value={userSettings?.delivery_end_time ?? ""}
                    onChange={async (e) => {
                      const v = e.target.value || null;
                      setUserSettings((prev) =>
                        prev ? { ...prev, delivery_end_time: v } : null
                      );
                      await saveUserSetting("delivery_end_time", v ?? "");
                    }}
                    className="flex h-8 w-28 rounded-md border border-input bg-background px-2 py-1 text-xs"
                  />
                </div>
                <p className="text-[11px] text-foreground-secondary">
                  Messages outside this window will be delivered when your window opens. Emergency messages always come through immediately.
                </p>
              </div>
            )}
          </div>
        </div>
      </CollapsibleCard>
      </div>

      <CollapsibleCard
        open={openSage}
        onToggle={() => setOpenSage((o) => !o)}
        title={
          <span className="flex items-center gap-2">
            <Feather className="h-5 w-5 text-[#7C8B6E]" />
            Sage
          </span>
        }
        subtitle="Control how Sage supports your communication"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="sage_message_review"
              checked={userSettings?.sage_message_review ?? true}
              onChange={(e) => {
                const v = e.target.checked;
                setUserSettings((prev) => (prev ? { ...prev, sage_message_review: v } : null));
                saveUserSetting("sage_message_review", v);
              }}
              className="rounded border-input"
            />
            <Label htmlFor="sage_message_review" className="text-sm font-normal cursor-pointer">
              Sage message review
            </Label>
          </div>
          <p className="text-xs text-foreground-secondary ml-6">Sage reviews messages before sending.</p>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="proactive_nudges"
              checked={userSettings?.proactive_sage_enabled ?? true}
              onChange={(e) => {
                const v = e.target.checked;
                setUserSettings((prev) => (prev ? { ...prev, proactive_sage_enabled: v } : null));
                saveUserSetting("proactive_sage_enabled", v);
              }}
              className="rounded border-input"
            />
            <Label htmlFor="proactive_nudges" className="text-sm font-normal cursor-pointer">
              Proactive nudges
            </Label>
          </div>
          <p className="text-xs text-foreground-secondary ml-6">Sage suggests support when conversations get tense.</p>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="vow_references"
              checked={userSettings?.vow_references ?? true}
              onChange={(e) => {
                const v = e.target.checked;
                setUserSettings((prev) => (prev ? { ...prev, vow_references: v } : null));
                saveUserSetting("vow_references", v);
              }}
              className="rounded border-input"
            />
            <Label htmlFor="vow_references" className="text-sm font-normal cursor-pointer">
              Vow references
            </Label>
          </div>
          <p className="text-xs text-foreground-secondary ml-6">Sage may gently reference your vow during private coaching.</p>
          <p className="text-xs text-foreground-secondary pt-2">
            These settings apply to all conversations. You can override per conversation from the thread header.
          </p>
        </div>
      </CollapsibleCard>

      <CollapsibleCard
        open={openCoolOff}
        onToggle={() => setOpenCoolOff((o) => !o)}
        title={
          <span className="flex items-center gap-2">
            <Moon className="h-5 w-5 text-[#7C8B6E]" />
            Cool-Off
          </span>
        }
        subtitle="Take a private break from messaging"
      >
        <div className="space-y-4">
          {!coolOffActive ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full border-[#7C8B6E] text-[#5B7A52] hover:bg-[#F2F5EF] hover:border-[#5B7A52]"
                onClick={() => setShowCoolOffSelector((v) => !v)}
              >
                Take a cool-off break
              </Button>
              {showCoolOffSelector && (
                <div className="rounded-lg border border-border bg-[#FDFBF7] p-3 space-y-3">
                  <Label className="text-xs font-medium text-foreground-secondary">Duration</Label>
                  <div className="flex flex-wrap gap-2">
                    {[1, 4, 12, 24, 48].map((h) => (
                      <button
                        key={h}
                        type="button"
                        onClick={() => setCoolOffHours(h)}
                        className={cn(
                          "rounded-full px-3 py-1.5 text-xs border transition-colors",
                          coolOffHours === h
                            ? "border-[#7C8B6E] bg-[#F2F5EF] text-[#5B7A52]"
                            : "border-border bg-background hover:bg-muted/50"
                        )}
                      >
                        {h === 1 ? "1 hour" : `${h} hours`}
                      </button>
                    ))}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    className="rounded-full h-8 text-xs bg-[#5B7A52] hover:bg-[#476242] text-white"
                    disabled={startingCoolOff}
                    onClick={async () => {
                      setStartingCoolOff(true);
                      try {
                        const res = await fetch("/api/messages/cool-off", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ hours: coolOffHours }),
                        });
                        const d = await res.json().catch(() => ({}));
                        if (res.ok && d.ends_at) {
                          setCoolOffActive({ ends_at: d.ends_at });
                          setShowCoolOffSelector(false);
                        } else {
                          showErrorToast(
                            (d as { error?: string }).error ?? "Could not start cool-off."
                          );
                        }
                      } finally {
                        setStartingCoolOff(false);
                      }
                    }}
                  >
                    {startingCoolOff ? "Starting…" : "Start cool-off"}
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-foreground">
                Cool-off active — ends at{" "}
                {new Date(coolOffActive.ends_at).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full h-8 text-xs"
                disabled={endingCoolOff}
                onClick={async () => {
                  setEndingCoolOff(true);
                  try {
                    const res = await fetch("/api/messages/cool-off", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ end_early: true }),
                    });
                    if (res.ok) setCoolOffActive(null);
                  } finally {
                    setEndingCoolOff(false);
                  }
                }}
              >
                {endingCoolOff ? "Ending…" : "End early"}
              </Button>
            </div>
          )}
          <p className="text-xs text-foreground-secondary">
            During cool-off, you cannot send messages. Incoming messages are held until your break ends. Your co-parent will not know you are on a break.
          </p>
          <p className="text-xs text-foreground-secondary">
            Emergency messages from your co-parent will still come through.
          </p>
        </div>
      </CollapsibleCard>

      <CollapsibleCard
        open={openPrivacy}
        onToggle={() => setOpenPrivacy((o) => !o)}
        title="Privacy"
        subtitle="What's shared and what stays private"
      >
        <ul className="space-y-2 text-sm text-foreground-secondary">
          <li className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-[#7C8B6E] shrink-0" />
            Your vows are always private
          </li>
          <li className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-[#7C8B6E] shrink-0" />
            Sage coaching conversations are always private
          </li>
          <li className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-[#7C8B6E] shrink-0" />
            Cool-off breaks are always private
          </li>
          <li className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-[#7C8B6E] shrink-0" />
            Thread summaries may appear in reports
          </li>
          <li className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-[#7C8B6E] shrink-0" />
            Structured pauses appear in reports as neutral events
          </li>
        </ul>
      </CollapsibleCard>

      <CollapsibleCard
        open={openAccount}
        onToggle={() => setOpenAccount((o) => !o)}
        title="Account"
      >
        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium text-foreground-secondary mb-0.5">
              Timezone
            </p>
            <p className="text-[11px] text-foreground-secondary mb-1">
              Used for delivery windows, reports, and calendar events.
            </p>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="flex h-9 w-full max-w-xs rounded-md border border-input bg-background px-2 py-1 text-sm"
            >
              <option value="America/Denver">Mountain (America/Denver)</option>
              <option value="America/Los_Angeles">Pacific (America/Los_Angeles)</option>
              <option value="America/Chicago">Central (America/Chicago)</option>
              <option value="America/New_York">Eastern (America/New_York)</option>
              <option value={timezone}>Use browser default ({timezone})</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              className="rounded-md border border-[#E8E4DC] px-4 py-2 text-sm font-medium text-[#3D3D3D] hover:bg-[#F2F5EF] transition-colors"
              onClick={() => {
                router.push("/settings/change-password");
              }}
            >
              Change Password
            </button>
            <button
              type="button"
              className="rounded-md border border-[#C97B7B] px-4 py-2 text-sm font-medium text-[#A85C5C] hover:bg-[#FDF2F2] transition-colors"
              onClick={() => {
                showErrorToast(
                  "Account deletion will permanently remove your data. This flow is not yet enabled."
                );
              }}
            >
              Delete Account
            </button>
          </div>
        </div>
      </CollapsibleCard>
    </div>
  );
}
