"use client";

import { useState, useEffect, useCallback } from "react";
import { CalendarRoot } from "@/components/calendar/calendar-root";
import type { CalendarEventRow } from "@/components/calendar/calendar-month";

const CUSTODY_OVERLAY_STORAGE_KEY = "myvow_custody_overlay";

export const PATTERNS: Record<string, string[]> = {
  "7/7": ["U", "U", "U", "U", "U", "U", "U", "C", "C", "C", "C", "C", "C", "C"],
  seven_seven: ["U", "U", "U", "U", "U", "U", "U", "C", "C", "C", "C", "C", "C", "C"],
  "5/2/2/5": ["U", "U", "U", "U", "U", "C", "C", "U", "U", "C", "C", "C", "C", "C"],
  five_two_two_five: ["U", "U", "U", "U", "U", "C", "C", "U", "U", "C", "C", "C", "C", "C"],
  "2/2/3": ["U", "U", "C", "C", "U", "U", "U", "C", "C", "C"],
  two_two_three: ["U", "U", "C", "C", "U", "U", "U", "C", "C", "C"],
};

const TWO_TWO_THREE_PATTERN = PATTERNS["2/2/3"];
if (typeof window !== "undefined") {
  console.log("[calendar-with-custody] 2/2/3 pattern:", TWO_TWO_THREE_PATTERN, "length:", TWO_TWO_THREE_PATTERN?.length);
}

const ROTATION_SCHEDULE_TYPES = ["week_on_week_off", "seven_seven", "five_two_two_five", "two_two_three"] as const;
const VALID_SCHEDULE_TYPES = [...ROTATION_SCHEDULE_TYPES, "manual"] as const;
const DISPLAY_SCHEDULE_TYPES = ["7/7", "5/2/2/5", "2/2/3", "manual"] as const;
type ValidScheduleType = (typeof VALID_SCHEDULE_TYPES)[number];

function isRotationOrManual(scheduleType: string): boolean {
  return [
    "seven_seven", "7/7", "week_on_week_off",
    "five_two_two_five", "5/2/2/5",
    "two_two_three", "2/2/3",
    "manual"
  ].includes(scheduleType);
}

/** Normalize to YYYY-MM-DD for consistent map keys and lookups. */
function toDateKey(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  const s = typeof value === "string" ? value.trim() : new Date(value).toISOString();
  if (s.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  } catch {
    return null;
  }
}

export type CustodyScheduleFromApi = {
  schedule_type: string;
  rotation_start_date: string | null;
  user_starts_first: boolean | null;
  manual_pattern?: string[] | null;
} | null;

export type CustodyOverridesMap = Record<string, "user" | "coparent" | "neither">;

type Child = { id: string; first_name: string };
type UpcomingEvent = {
  id: string;
  title: string;
  event_type: string | null;
  child_name: string | null;
  start_time: string;
  status: string | null;
};

interface CalendarWithCustodyProps {
  caseId: string;
  userId: string;
  events: CalendarEventRow[];
  upcoming: UpcomingEvent[];
  eventsForModal: CalendarEventRow[];
  children: Child[];
  showUpcoming?: boolean;
  year?: number;
  month?: number;
  appMode?: string | null;
}

function getDefaultOverlayOn(): boolean {
  if (typeof window === "undefined") return true;
  const stored = localStorage.getItem(CUSTODY_OVERLAY_STORAGE_KEY);
  if (stored === "false") return false;
  return true;
}

function setStoredOverlayOn(on: boolean) {
  if (typeof window === "undefined") return;
  localStorage.setItem(CUSTODY_OVERLAY_STORAGE_KEY, on ? "true" : "false");
}

export function CalendarWithCustody({
  caseId,
  userId,
  events,
  upcoming,
  eventsForModal,
  children,
  showUpcoming = true,
  year,
  month,
  appMode = null,
}: CalendarWithCustodyProps) {
  const [custodySchedule, setCustodySchedule] = useState<CustodyScheduleFromApi>(null);
  const [custodyOverrides, setCustodyOverrides] = useState<CustodyOverridesMap>({});
  const [custodyOverlayOn, setCustodyOverlayOn] = useState(getDefaultOverlayOn);

  const refetchCustodyOverrides = useCallback(() => {
    fetch("/api/custody-day-overrides", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) {
          console.log("custody data: custody-day-overrides fetch not ok", r.status);
          return [];
        }
        return r.json();
      })
      .then((rows: { date: string; custodial_parent: string }[]) => {
        console.log("[CalendarWithCustody] GET /api/custody-day-overrides raw response:", rows);
        const overridesMap: Record<string, "user" | "coparent" | "neither"> = {};
        for (const o of rows ?? []) {
          const dateKey = toDateKey(o.date);
          if (!dateKey) continue;
          const val = o.custodial_parent ?? "";
          if (val === userId || val === "user") overridesMap[dateKey] = "user";
          else if (val === "coparent") overridesMap[dateKey] = "coparent";
          else overridesMap[dateKey] = "neither";
        }
        console.log("[calendar-with-custody] overridesMap", overridesMap);
        setCustodyOverrides(overridesMap);
      })
      .catch((err) => {
        console.log("custody data: custody-day-overrides fetch error", err);
        setCustodyOverrides({});
      });
  }, [userId]);

  function fetchCustodyData() {
    console.log("[CalendarWithCustody] calling /api/custody-schedule");
    fetch("/api/custody-schedule", {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    })
      .then(async (r) => {
        const raw = await r.json();
        console.log("[CalendarWithCustody] schedule loaded:", JSON.stringify(raw));
        if (!r.ok) {
          console.log("custody data: custody-schedule fetch not ok", r.status);
          return null;
        }
        return raw as CustodyScheduleFromApi;
      })
      .then((data) => {
        if (data && typeof data === "object" && data.schedule_type) {
          const scheduleType = data.schedule_type;
          const effectiveType = isRotationOrManual(scheduleType)
            ? scheduleType
            : "manual";
          if (effectiveType !== scheduleType) {
            console.log("[CalendarWithCustody] schedule_type not recognized, treating as manual:", scheduleType);
          }
          setCustodySchedule({
            schedule_type: effectiveType,
            rotation_start_date: data.rotation_start_date ?? null,
            user_starts_first: data.user_starts_first ?? null,
            manual_pattern: data.manual_pattern ?? null,
          });
        } else {
          setCustodySchedule(null);
        }
      })
      .catch((err) => {
        console.log("custody data: custody-schedule fetch error", err);
        setCustodySchedule(null);
      });
  }

  useEffect(() => {
    console.log("[CalendarWithCustody] fetching custody schedule...");
    fetchCustodyData();
  }, []);

  useEffect(() => {
    refetchCustodyOverrides();
  }, [refetchCustodyOverrides]);

  useEffect(() => {
    console.log("custody data:", custodySchedule, custodyOverrides);
  }, [custodySchedule, custodyOverrides]);

  useEffect(() => {
    const onFocus = () => refetchCustodyOverrides();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refetchCustodyOverrides]);

  useEffect(() => {
    const onSaved = () => refetchCustodyOverrides();
    window.addEventListener("myvowCustodyDayOverridesSaved", onSaved);
    return () => window.removeEventListener("myvowCustodyDayOverridesSaved", onSaved);
  }, [refetchCustodyOverrides]);

  function handleCustodyOverlayChange(next: boolean) {
    setCustodyOverlayOn(next);
    setStoredOverlayOn(next);
  }

  return (
    <CalendarRoot
      caseId={caseId}
      events={events}
      upcoming={upcoming}
      eventsForModal={eventsForModal}
      children={children}
      showUpcoming={showUpcoming}
      year={year}
      month={month}
      userId={userId}
      appMode={appMode}
      custodySchedule={custodySchedule}
      custodyOverrides={custodyOverrides}
      custodyOverlayOn={custodyOverlayOn}
      onCustodyOverlayChange={handleCustodyOverlayChange}
    />
  );
}
