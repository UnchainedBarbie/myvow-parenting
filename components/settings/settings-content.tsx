"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

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
  headerAction,
  children: content,
}: {
  open: boolean;
  onToggle: () => void;
  title: string;
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
        <CardTitle className="font-heading text-lg text-foreground">{title}</CardTitle>
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

  const [caseSettings, setCaseSettings] = useState<CaseSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);

  const [appMode, setAppMode] = useState<AppMode>("partner");
  const [aiLevel, setAiLevel] = useState<AiModerationLevel>("standard");
  const [messageDelay, setMessageDelay] = useState(0);
  const [messagingWindowStart, setMessagingWindowStart] = useState("");
  const [messagingWindowEnd, setMessagingWindowEnd] = useState("");
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(false);

  const [emailNotifications, setEmailNotifications] = useState(true);
  const [pushNotifications, setPushNotifications] = useState(false);
  const [notificationFrequency, setNotificationFrequency] = useState<"immediate" | "daily">("immediate");

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
        window.alert((err as { error?: string }).error ?? "Failed to save");
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
    } finally {
      setSettingsSaving(false);
    }
  }

  const allSectionsOpen =
    openCommunication && openNotifications && openSubscription;

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
            } else {
              setOpenCommunication(true);
              setOpenNotifications(true);
              setOpenSubscription(true);
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
          <div className="rounded-lg border border-border bg-background p-4 flex flex-col gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Free</span>
              <span className="rounded-full bg-emerald-600 text-white px-2.5 py-1 text-xs font-medium">Current plan</span>
            </div>
            <p className="text-sm text-foreground-secondary flex-1">Basic scheduling, documents, calendar</p>
          </div>
          <div className="rounded-lg border border-border bg-background p-4 flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Plus</span>
            <p className="text-sm text-foreground-secondary flex-1">Expense tracking, exports, shared visibility</p>
            <span className="text-xs text-foreground-secondary">Upgrade to unlock</span>
          </div>
          <div className="rounded-lg border border-border bg-background p-4 flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Pro</span>
            <p className="text-sm text-foreground-secondary flex-1">AI moderation, court-ready reports, email ingestion, advanced analytics</p>
            <span className="text-xs text-foreground-secondary">Upgrade to unlock</span>
          </div>
        </div>
      </CollapsibleCard>

      {showCommunication && (
        <CollapsibleCard
          open={openCommunication}
          onToggle={() => setOpenCommunication((o) => !o)}
          title="Communication"
        >
          <div className="space-y-4">
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
        </div>
      </CollapsibleCard>
      </div>
    </div>
  );
}
