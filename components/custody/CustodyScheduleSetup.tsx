"use client";

/*
  Two-week modal: openScheduleModal and saveScheduleFromModal (reference copy)

  async function openScheduleModal() {
    setScheduleModalOpen(true);
    setScheduleModalError(null);
    setDayStates({});
    setScheduleModalLoading(true);
    const today = new Date();
    const sunday = new Date(today);
    sunday.setDate(today.getDate() - today.getDay());
    sunday.setHours(0, 0, 0, 0);
    setGridStartDate(sunday.toISOString().split("T")[0]);
    try {
      const dates = getTwoWeekDatesFromLastSunday();
      const res = await fetch("/api/custody-schedule");
      const schedule = res.ok ? await res.json().catch(() => null) : null;
      const next: Record<string, DayCustody> = {};
      if (schedule?.schedule_type === "manual" && Array.isArray(schedule.manual_pattern) && schedule.manual_pattern.length === 14 && schedule.rotation_start_date) {
        const [sy, sm, sd] = schedule.rotation_start_date.split("-").map(Number);
        const startSunday = new Date(sy, (sm ?? 1) - 1, sd ?? 1);
        for (let i = 0; i < dates.length; i++) {
          const [y, m, d] = dates[i].split("-").map(Number);
          const dayDate = new Date(y, m - 1, d);
          const daysSinceStart = Math.round((dayDate.getTime() - startSunday.getTime()) / (1000 * 60 * 60 * 24));
          const cyclePos = ((daysSinceStart % 14) + 14) % 14;
          const val = schedule.manual_pattern[cyclePos];
          next[dates[i]] = val === "user" ? "user" : val === "coparent" ? "coparent" : "unassigned";
        }
      } else {
        for (const date of dates) next[date] = "unassigned";
      }
      setDayStates(next);
    } catch {
      setScheduleModalError("Failed to load existing schedule.");
    } finally {
      setScheduleModalLoading(false);
    }
  }

  async function saveScheduleFromModal() {
    // Compute grid start date right here at save time (never null)
    const today = new Date();
    const sunday = new Date(today);
    sunday.setDate(today.getDate() - today.getDay());
    sunday.setHours(0, 0, 0, 0);
    const rotationStartDate = sunday.toISOString().split("T")[0];
    const dates = getTwoWeekDatesFromLastSunday();
    const manual_pattern = dates.map((date) => {
      const state = dayStates[date] ?? "unassigned";
      return state === "user" ? "user" : state === "coparent" ? "coparent" : "neither";
    });
    const payload = { schedule_type: "manual", rotation_start_date: rotationStartDate, manual_pattern, user_starts_first: true };
    console.log("saving manual payload:", payload);
    // ... rest of save logic (validation, fetch, close, callbacks)
  }
*/

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const SCHEDULE_OPTIONS = [
  { value: "week_on_week_off" as const, label: "7/7", description: "Week on / week off" },
  { value: "five_two_two_five" as const, label: "5/2/2/5", description: "5 days, 2 days, 2 days, 5 days" },
  { value: "two_two_three" as const, label: "2/2/3", description: "Rotating 2-2-3" },
  { value: "manual" as const, label: "Manual", description: "I'll mark custody days on the calendar" },
] as const;

type ScheduleType = (typeof SCHEDULE_OPTIONS)[number]["value"];

/** Map internal value to display value sent to API so DB stores '7/7', '5/2/2/5', etc. */
const SCHEDULE_TYPE_TO_DISPLAY: Record<ScheduleType, string> = {
  week_on_week_off: "7/7",
  five_two_two_five: "5/2/2/5",
  two_two_three: "2/2/3",
  manual: "manual",
};

/** Map API schedule_type (display or snake_case) to our option value for UI state. */
function apiScheduleTypeToValue(st: string): ScheduleType | null {
  const s = st?.trim?.() ?? "";
  const byValue = SCHEDULE_OPTIONS.find((o) => o.value === s);
  if (byValue) return byValue.value;
  const byLabel = SCHEDULE_OPTIONS.find((o) => o.label === s || o.label.toLowerCase() === s);
  if (byLabel) return byLabel.value;
  if (s === "7/7" || s === "seven_seven") return "week_on_week_off";
  if (s === "5/2/2/5") return "five_two_two_five";
  if (s === "2/2/3") return "two_two_three";
  return null;
}

const ROTATION_TYPES: ScheduleType[] = ["week_on_week_off", "five_two_two_five", "two_two_three"];
const SHOW_WHO_STARTS: ScheduleType[] = ["week_on_week_off", "five_two_two_five", "two_two_three"];

function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

type DayCustody = "unassigned" | "user" | "coparent";

const DAY_ABBREV = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Returns 14 days starting from the most recent Sunday (Sun–Sat, Sun–Sat). */
function getTwoWeekDatesFromLastSunday(): string[] {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 = Sunday
  const startSunday = new Date(today);
  startSunday.setDate(today.getDate() - dayOfWeek);
  const out: string[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(startSunday.getFullYear(), startSunday.getMonth(), startSunday.getDate() + i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}

export interface CustodyScheduleSetupProps {
  caseId: string;
  onSave?: () => void;
  compact?: boolean;
  /** Required for manual schedule "Set Up My Schedule" so "My custody" days can be saved correctly. */
  userId?: string;
}

export function CustodyScheduleSetup({
  caseId,
  onSave,
  compact = false,
  userId,
}: CustodyScheduleSetupProps) {
  const [scheduleType, setScheduleType] = useState<ScheduleType | null>(null);
  const [rotationStartDate, setRotationStartDate] = useState("");
  const [userStartsFirst, setUserStartsFirst] = useState<boolean | null>(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessageState, setSaveMessageState] = useState<"hidden" | "visible" | "fading">("hidden");

  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [gridStartDate, setGridStartDate] = useState<string | null>(null);
  const [dayStates, setDayStates] = useState<Record<string, DayCustody>>({});
  const [scheduleModalLoading, setScheduleModalLoading] = useState(false);
  const [scheduleModalSaving, setScheduleModalSaving] = useState(false);
  const [scheduleModalError, setScheduleModalError] = useState<string | null>(null);
  const [scheduleSavedMessage, setScheduleSavedMessage] = useState<"hidden" | "visible" | "fading">("hidden");

  const fetchSchedule = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/custody-schedule");
      if (!res.ok) {
        if (res.status === 403) return;
        throw new Error("Failed to load schedule");
      }
      const data = await res.json();
      if (data && typeof data === "object") {
        const st = data.schedule_type as string | undefined;
        const value = st ? apiScheduleTypeToValue(st) : null;
        if (value) setScheduleType(value);
        setRotationStartDate(toDateInputValue(data.rotation_start_date));
        if (typeof data.user_starts_first === "boolean") {
          setUserStartsFirst(data.user_starts_first);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!caseId) return;
    void fetchSchedule();
  }, [caseId, fetchSchedule]);

  async function openScheduleModal() {
    console.log("OPEN MODAL called");
    setScheduleModalOpen(true);
    setScheduleModalError(null);
    setDayStates({});
    setScheduleModalLoading(true);
    const today = new Date();
    const sunday = new Date(today);
    sunday.setDate(today.getDate() - today.getDay());
    sunday.setHours(0, 0, 0, 0);
    setGridStartDate(sunday.toISOString().split("T")[0]);
    try {
      const dates = getTwoWeekDatesFromLastSunday();
      const res = await fetch("/api/custody-schedule");
      const schedule = res.ok ? await res.json().catch(() => null) : null;
      const next: Record<string, DayCustody> = {};
      if (schedule?.schedule_type === "manual" && Array.isArray(schedule.manual_pattern) && schedule.manual_pattern.length === 14 && schedule.rotation_start_date) {
        const [sy, sm, sd] = schedule.rotation_start_date.split("-").map(Number);
        const startSunday = new Date(sy, (sm ?? 1) - 1, sd ?? 1);
        for (let i = 0; i < dates.length; i++) {
          const [y, m, d] = dates[i].split("-").map(Number);
          const dayDate = new Date(y, m - 1, d);
          const daysSinceStart = Math.round((dayDate.getTime() - startSunday.getTime()) / (1000 * 60 * 60 * 24));
          const cyclePos = ((daysSinceStart % 14) + 14) % 14;
          const val = schedule.manual_pattern[cyclePos];
          next[dates[i]] = val === "user" ? "user" : val === "coparent" ? "coparent" : "unassigned";
        }
      } else {
        for (const date of dates) next[date] = "unassigned";
      }
      setDayStates(next);
    } catch {
      setScheduleModalError("Failed to load existing schedule.");
    } finally {
      setScheduleModalLoading(false);
    }
  }

  function cycleDayCustody(dateStr: string) {
    setDayStates((prev) => {
      const cur = prev[dateStr] ?? "unassigned";
      const next: DayCustody = cur === "unassigned" ? "user" : cur === "user" ? "coparent" : "unassigned";
      return { ...prev, [dateStr]: next };
    });
  }

  async function saveScheduleFromModal() {
    const start = new Date();
    const day = start.getDay();
    start.setDate(start.getDate() - day);
    start.setHours(0, 0, 0, 0);
    const rotation_start_date = start.toISOString().split("T")[0];

    const dates = getTwoWeekDatesFromLastSunday();
    const manual_pattern: ("user" | "coparent" | "neither")[] = dates.map((date) => {
      const state = dayStates[date] ?? "unassigned";
      return state === "user" ? "user" : state === "coparent" ? "coparent" : "neither";
    });

    const body = {
      schedule_type: "manual",
      rotation_start_date,
      user_starts_first: true,
      manual_pattern,
    };
    console.log("POST body:", body);

    const hasUserDays = manual_pattern.some((p) => p === "user");
    if (hasUserDays && !userId) {
      setScheduleModalError("Cannot save \"My days\" without user ID. Please refresh the page.");
      return;
    }
    setScheduleModalSaving(true);
    setScheduleModalError(null);
    try {
      console.log("[CustodySetup] POST payload:", JSON.stringify(body));
      const res = await fetch("/api/custody-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      console.log("Save response:", json);
      if (!res.ok) {
        throw new Error(json?.error ?? "Failed to save schedule");
      }
      setScheduleModalOpen(false);
      setScheduleSavedMessage("visible");
      onSave?.();
      await fetchSchedule();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("myvowCustodyDayOverridesSaved"));
      }
      window.setTimeout(() => setScheduleSavedMessage("fading"), 3000);
      window.setTimeout(() => setScheduleSavedMessage("hidden"), 3300);
    } catch (e) {
      setScheduleModalError(e instanceof Error ? e.message : "Failed to save schedule.");
    } finally {
      setScheduleModalSaving(false);
    }
  }

  async function handleSave() {
    if (scheduleType === null) return;
    if (scheduleType === "manual") {
      setError("Use the \"Set Up My Schedule\" button to configure manual mode.");
      return;
    }
    setSaving(true);
    setError(null);
    setSaveMessageState("hidden");
    try {
      const scheduleTypeMap: Record<string, string> = {
        "7/7": "seven_seven",
        week_on_week_off: "seven_seven",
        "5/2/2/5": "five_two_two_five",
        five_two_two_five: "five_two_two_five",
        "2/2/3": "two_two_three",
        two_two_three: "two_two_three",
        manual: "manual",
      };
      const normalizedType = scheduleTypeMap[scheduleType] ?? scheduleType;

      let payload: {
        schedule_type: string;
        rotation_start_date: string | null;
        user_starts_first: boolean | null;
      };
      {
        payload = {
          schedule_type: normalizedType,
          rotation_start_date: null,
          user_starts_first: null,
        };
        if (ROTATION_TYPES.includes(scheduleType)) {
          payload.rotation_start_date =
            rotationStartDate && /^\d{4}-\d{2}-\d{2}$/.test(rotationStartDate)
              ? rotationStartDate
              : null;
          if (SHOW_WHO_STARTS.includes(scheduleType)) {
            payload.user_starts_first = userStartsFirst;
          }
        }
      }
      console.log("Saving custody schedule:", payload);
      console.log("[CustodySetup] POST payload:", JSON.stringify(payload));
      console.log("[handleSave] posting payload:", JSON.stringify(payload));
      const res = await fetch("/api/custody-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      console.log("Response status:", res.status);
      const data = await res.json().catch(() => ({}));
      console.log("Response body:", data);
      if (!res.ok) {
        const message = data?.error ?? data?.message ?? "Save failed";
        setError(message);
        return;
      }
      setSaveMessageState("visible");
      onSave?.();
      window.setTimeout(() => setSaveMessageState("fading"), 3000);
      window.setTimeout(() => setSaveMessageState("hidden"), 3300);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  const showRotationFields = scheduleType !== null && ROTATION_TYPES.includes(scheduleType);
  const showWhoStartsFirst =
    scheduleType !== null && SHOW_WHO_STARTS.includes(scheduleType);

  if (loading) {
    return (
      <div className={compact ? "" : "p-4 md:p-6"}>
        <p className="text-sm text-foreground-secondary">Loading schedule…</p>
      </div>
    );
  }

  return (
    <div className={cn(compact ? "" : "p-3 space-y-4")}>
      {!compact && (
        <p className="text-sm font-medium text-foreground-secondary">
          What&apos;s your custody schedule?
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 min-w-0">
        {SCHEDULE_OPTIONS.map((opt) => (
          <Card
            key={opt.value}
            className={cn(
              "cursor-pointer transition-all rounded-card border min-w-0 w-full",
              scheduleType === opt.value
                ? "border-[#7B9E87] bg-[#EEF2E9]/30"
                : "border-border bg-muted/20 hover:border-[#B0A899]"
            )}
            onClick={() => setScheduleType(opt.value)}
          >
            <CardContent className="p-2.5 min-w-0">
              <p className="text-sm font-medium text-foreground">{opt.label}</p>
              <p className="text-xs text-foreground-secondary mt-0.5">
                {opt.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {scheduleType === "manual" && (
        <div className="space-y-1">
          <Button
            type="button"
            variant="outline"
            className="rounded-full border-[#E8E4DC] bg-[#FDFBF7] text-foreground hover:bg-[#F5F3EF]"
            onClick={openScheduleModal}
          >
            Set Up My Schedule
          </Button>
          {(scheduleSavedMessage === "visible" || scheduleSavedMessage === "fading") && (
            <p
              className={cn(
                "text-sm text-[#7B9E87] transition-opacity duration-300",
                scheduleSavedMessage === "fading" ? "opacity-0" : "opacity-100"
              )}
              role="status"
              aria-live="polite"
            >
              Schedule saved!
            </p>
          )}
        </div>
      )}

      {scheduleModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => e.target === e.currentTarget && setScheduleModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="schedule-modal-title"
        >
          <div className="w-full max-w-[420px] rounded-2xl border border-[#E8E4DC] bg-[#FDFBF7] p-4 shadow-card">
            <h2 id="schedule-modal-title" className="text-lg font-semibold text-foreground mb-1">
              Set Up Your Custody Schedule
            </h2>
            <p className="text-sm text-foreground-secondary mb-3">
              {gridStartDate
                ? `Your typical two-week schedule starting ${new Date(gridStartDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}`
                : "Your typical two-week schedule"}
            </p>

            {scheduleModalLoading ? (
              <p className="text-sm text-foreground-secondary py-6">Loading…</p>
            ) : (
              <>
                <div className="grid grid-cols-7 gap-1.5 mb-4">
                  {getTwoWeekDatesFromLastSunday().map((dateStr) => {
                    const [y, m, d] = dateStr.split("-").map(Number);
                    const dObj = new Date(y, m - 1, d);
                    const state = dayStates[dateStr] ?? "unassigned";
                    return (
                      <button
                        key={dateStr}
                        type="button"
                        onClick={() => cycleDayCustody(dateStr)}
                        className={cn(
                          "rounded-lg border text-xs font-medium py-2 flex flex-col items-center justify-center min-h-[44px] transition-colors",
                          state === "user" && "bg-[#7B9E87] border-[#6A8A78] text-white",
                          state === "coparent" && "bg-[#E8E4DC] border-[#D2CEC6] text-[#3D3D3D]",
                          state === "unassigned" && "border-[#E8E4DC] bg-[#F5F3EF] text-foreground-secondary hover:bg-[#EEEDE8]"
                        )}
                      >
                        <span>{DAY_ABBREV[dObj.getDay()]}</span>
                        <span>{dObj.getDate()}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="flex gap-4 text-xs text-foreground-secondary mb-4">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-[#7B9E87]" aria-hidden /> My days
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-[#E8E4DC]" aria-hidden /> Co-Parent&apos;s days
                  </span>
                </div>
              </>
            )}

            {scheduleModalError && (
              <p className="text-sm text-[#C97B7B] mb-3" role="alert">
                {scheduleModalError}
              </p>
            )}

            <div className="flex gap-2 justify-end">
              <Button
                type="button"
                variant="outline"
                className="rounded-full border-[#E8E4DC]"
                onClick={() => setScheduleModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="rounded-full bg-[#7B9E87] hover:bg-[#6A8A78] text-white"
                onClick={saveScheduleFromModal}
                disabled={scheduleModalLoading || scheduleModalSaving}
              >
                {scheduleModalSaving ? "Saving…" : "Save Schedule"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {showRotationFields && (
        <div className="space-y-4">
          <div>
            <Label htmlFor="custody-rotation-start" className="text-sm text-foreground-secondary">
              My custody starts on
            </Label>
            <Input
              id="custody-rotation-start"
              type="date"
              value={rotationStartDate}
              onChange={(e) => setRotationStartDate(e.target.value)}
              className="mt-1 rounded-card border-border max-w-[200px]"
            />
          </div>
          {showWhoStartsFirst && (
            <div>
              <Label className="text-sm text-foreground-secondary block mb-2">
                Who starts first?
              </Label>
              <div className="inline-flex rounded-full border border-[#E8E4DC] bg-[#F5F3EF] p-0.5">
                <button
                  type="button"
                  onClick={() => setUserStartsFirst(true)}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                    userStartsFirst === true
                      ? "bg-white text-[#3D3D3D] shadow-sm border border-[#E8E4DC]"
                      : "text-foreground-secondary hover:text-foreground"
                  )}
                >
                  Me
                </button>
                <button
                  type="button"
                  onClick={() => setUserStartsFirst(false)}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                    userStartsFirst === false
                      ? "bg-white text-[#3D3D3D] shadow-sm border border-[#E8E4DC]"
                      : "text-foreground-secondary hover:text-foreground"
                  )}
                >
                  Co-Parent
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="text-sm text-[#C97B7B]" role="alert">
          {error}
        </p>
      )}

      {scheduleType !== "manual" && (
        <Button
          type="button"
          onClick={handleSave}
          disabled={scheduleType === null || saving}
          className="h-9 rounded-full text-sm bg-[#7B9E87] hover:bg-[#6A8A78] text-white"
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      )}

      {(saveMessageState === "visible" || saveMessageState === "fading") && (
        <p
          className={cn(
            "text-sm text-[#7B9E87] transition-opacity duration-300",
            saveMessageState === "fading" ? "opacity-0" : "opacity-100"
          )}
          role="status"
          aria-live="polite"
        >
          Custody schedule saved ✓
        </p>
      )}
    </div>
  );
}
