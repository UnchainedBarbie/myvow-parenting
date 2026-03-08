"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  computeCustodyForDate,
  getStoredCustodyOverlay,
  setStoredCustodyOverlay,
  type CustodySchedule,
  type HolidayCustodyOverride,
} from "@/lib/custody";
import { cn } from "@/lib/utils";

interface CalendarYearViewProps {
  year: number;
  eventDateKeys: string[];
  custodySchedule: CustodySchedule | null;
  appMode: string | null;
  userId: string;
  caseId: string;
}

export function CalendarYearView({
  year,
  eventDateKeys,
  custodySchedule,
  appMode,
  userId,
  caseId,
}: CalendarYearViewProps) {
  const hasCustodySchedule = !!custodySchedule;
  const [custodyOverlayOn, setCustodyOverlayOn] = useState(() =>
    getStoredCustodyOverlay(appMode, hasCustodySchedule)
  );
  const [holidayOverrides, setHolidayOverrides] = useState<HolidayCustodyOverride[]>([]);

  useEffect(() => {
    setCustodyOverlayOn(getStoredCustodyOverlay(appMode, hasCustodySchedule));
  }, [appMode, hasCustodySchedule]);

  useEffect(() => {
    if (!custodyOverlayOn || !caseId) return;
    fetch("/api/holiday-custody")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: { start_date: string; end_date: string; custodial_parent: string }[]) => {
        setHolidayOverrides(rows);
      })
      .catch(() => setHolidayOverrides([]));
  }, [custodyOverlayOn, caseId]);

  function getCustodyForDate(date: Date): "user" | "coparent" {
    return computeCustodyForDate(date, custodySchedule, {
      holidayOverrides,
      currentUserId: userId,
    });
  }

  const eventSet = new Set(eventDateKeys);
  const today = new Date();
  const todayYear = today.getFullYear();
  const todayMonth = today.getMonth() + 1;
  const todayDate = today.getDate();

  return (
    <div className="w-full min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-foreground-secondary mb-2">
        <div className="inline-flex rounded-full border border-border bg-background-secondary/60 p-0.5">
          <Link
            href={`/calendar?view=month&year=${year}&month=1`}
            className="px-3 py-1 text-xs rounded-full text-foreground-secondary hover:text-foreground"
          >
            Month
          </Link>
          <Link
            href={`/calendar?view=list&year=${year}&month=1`}
            className="px-3 py-1 text-xs rounded-full text-foreground-secondary hover:text-foreground"
          >
            List
          </Link>
          <span className="px-3 py-1 text-xs rounded-full bg-[#7B9E87] text-white">
            Year
          </span>
        </div>
        {hasCustodySchedule && (
          <button
            type="button"
            onClick={() => {
              const next = !custodyOverlayOn;
              setCustodyOverlayOn(next);
              setStoredCustodyOverlay(next);
            }}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium border transition-colors",
              custodyOverlayOn
                ? "bg-[#7B9E87] border-[#7B9E87] text-white"
                : "border-border text-foreground-secondary bg-background hover:bg-muted hover:text-foreground"
            )}
          >
            Custody
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {Array.from({ length: 12 }).map((_, index) => {
          const monthNumber = index + 1;
          const firstDay = new Date(year, monthNumber - 1, 1).getDay();
          const daysInMonth = new Date(year, monthNumber, 0).getDate();
          const blanks = Array.from({ length: firstDay });
          const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
          const monthName = new Date(year, monthNumber - 1, 1).toLocaleString("en-US", { month: "short" });

          return (
            <div
              key={monthNumber}
              className="rounded-card border border-[#E8E4DC] bg-[#FDFBF7] p-3 flex flex-col gap-2"
            >
              <div className="text-xs font-semibold text-foreground mb-1">
                {monthName} {year}
              </div>
              <div className="grid grid-cols-7 gap-1 text-[10px] text-foreground-secondary">
                {["S", "M", "T", "W", "T", "F", "S"].map((d) => (
                  <div key={d} className="flex items-center justify-center h-5">
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1 text-[11px]">
                {blanks.map((_, i) => (
                  <div key={`b-${i}`} className="h-6" />
                ))}
                {days.map((day) => {
                  const key = `${year}-${String(monthNumber).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                  const hasEvent = eventSet.has(key);
                  const isToday =
                    year === todayYear && monthNumber === todayMonth && day === todayDate;
                  const custody =
                    custodyOverlayOn && hasCustodySchedule
                      ? getCustodyForDate(new Date(year, monthNumber - 1, day))
                      : null;
                  const dayClasses =
                    "flex flex-col items-center justify-center h-7 w-7 mx-auto rounded-full";
                  const activeClasses = isToday
                    ? "bg-[#EEF2E9] text-[#5B7A52]"
                    : "text-foreground";
                  const params = new URLSearchParams();
                  params.set("year", String(year));
                  params.set("month", String(monthNumber));
                  const href = `/calendar?${params.toString()}`;

                  return (
                    <Link
                      key={day}
                      href={href}
                      className="flex flex-col items-center gap-0.5"
                    >
                      <div className={cn(dayClasses, activeClasses)}>
                        {day}
                      </div>
                      <div className="flex flex-col items-center gap-0.5">
                        {hasEvent && (
                          <div className="h-1.5 w-1.5 rounded-full bg-[#7C8B6E]" />
                        )}
                        {custody === "user" && (
                          <div className="h-1 w-1 rounded-full bg-green-500" title="Your custody" />
                        )}
                        {custody === "coparent" && (
                          <div className="h-1 w-1 rounded-full bg-stone-400" title="Co-parent custody" />
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
