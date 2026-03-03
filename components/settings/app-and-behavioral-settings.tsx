"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { showErrorToast, showSuccessToast } from "@/components/ui/toaster";

type AppMode = "solo" | "partner" | "coparenting";
type AiModerationLevel = "off" | "standard" | "high";

type SettingsState = {
  case_id: string | null;
  app_mode: AppMode;
  message_delay_minutes: number;
  ai_moderation_level: AiModerationLevel;
};

export function AppAndBehavioralSettings() {
  const router = useRouter();
  const [settings, setSettings] = useState<SettingsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [appMode, setAppMode] = useState<AppMode>("partner");
  const [messageDelay, setMessageDelay] = useState(0);
  const [aiLevel, setAiLevel] = useState<AiModerationLevel>("standard");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/cases/settings");
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (data.case_id) {
          setSettings(data);
          setAppMode((data.app_mode as AppMode) ?? "partner");
          setMessageDelay(Number(data.message_delay_minutes) ?? 0);
          setAiLevel((data.ai_moderation_level as AiModerationLevel) ?? "standard");
        } else {
          setSettings({ case_id: null, app_mode: "partner", message_delay_minutes: 0, ai_moderation_level: "standard" });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/cases/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app_mode: appMode,
          message_delay_minutes: messageDelay,
          ai_moderation_level: aiLevel,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showErrorToast(
          (err as { error?: string }).error ?? "Failed to save"
        );
        return;
      }
      setSettings((prev) => (prev ? { ...prev, app_mode: appMode, message_delay_minutes: messageDelay, ai_moderation_level: aiLevel } : null));
      router.refresh();
      showSuccessToast("Settings saved");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Card className="shadow-card">
        <CardContent className="py-6">
          <p className="text-sm text-foreground-secondary">Loading settings…</p>
        </CardContent>
      </Card>
    );
  }

  const hasCase = !!settings?.case_id;
  const dirty =
    hasCase &&
    (appMode !== (settings?.app_mode ?? "partner") ||
      messageDelay !== (settings?.message_delay_minutes ?? 0) ||
      aiLevel !== (settings?.ai_moderation_level ?? "standard"));

  return (
    <div className="space-y-6">
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="font-heading text-lg">App Mode</CardTitle>
          <p className="text-sm text-foreground-secondary font-normal mt-1">
            Choose how you use MyVow: <strong>Solo</strong> (just you), <strong>Partner</strong> (with a cooperative co-parent), or <strong>Coparenting</strong> (AI-moderated communication).
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {!hasCase ? (
            <p className="text-sm text-foreground-secondary">Create a case below to set app mode.</p>
          ) : (
            <>
              <div className="space-y-2">
                <Label className="text-xs font-medium text-foreground-secondary">Mode</Label>
                <div className="flex flex-col gap-2">
                  {(
                    [
                      { value: "solo" as const, label: "Solo", desc: "Just you — manage your own schedule and documents." },
                      { value: "partner" as const, label: "Partner", desc: "With a cooperative co-parent — direct messaging and shared tools." },
                      { value: "coparenting" as const, label: "Coparenting", desc: "AI-moderated communication — tone and content are reviewed before delivery." },
                    ] as const
                  ).map(({ value, label, desc }) => (
                    <label key={value} className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="radio"
                        name="app_mode"
                        value={value}
                        checked={appMode === value}
                        onChange={() => setAppMode(value)}
                        className="mt-1.5"
                      />
                      <div>
                        <span className="text-sm font-medium text-foreground">{label}</span>
                        <p className="text-xs text-foreground-secondary">{desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {hasCase && (
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="font-heading text-lg">Behavioral settings</CardTitle>
            <p className="text-sm text-foreground-secondary font-normal mt-1">
              Messaging and AI moderation options for this case.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs font-medium text-foreground-secondary">Message delay (minutes)</Label>
              <input
                type="number"
                min={0}
                value={messageDelay}
                onChange={(e) => setMessageDelay(Math.max(0, parseInt(e.target.value, 10) || 0))}
                className="flex h-9 w-24 rounded-md border border-input bg-background px-2 py-1 text-sm"
              />
              <p className="text-xs text-foreground-secondary">Optional delay before messages are delivered (e.g. cool-off period).</p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium text-foreground-secondary">AI moderation level</Label>
              <select
                value={aiLevel}
                onChange={(e) => setAiLevel(e.target.value as AiModerationLevel)}
                className="flex h-9 rounded-md border border-input bg-background px-2 py-1 text-sm"
              >
                <option value="off">Off</option>
                <option value="standard">Standard</option>
                <option value="high">High</option>
              </select>
              <p className="text-xs text-foreground-secondary">Applies when App Mode is Coparenting. Standard = tone review; High = stricter rewriting.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {hasCase && dirty && (
        <div className="flex justify-end">
          <Button onClick={save} disabled={saving} className="rounded-full">
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      )}
    </div>
  );
}
