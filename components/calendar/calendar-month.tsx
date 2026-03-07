"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { CalendarExportButton } from "@/components/calendar/calendar-export-button";
import { getCalendarEventColors } from "@/lib/categoryColors";
import { getCustodyFromRotation } from "@/lib/calendarCustody";
import type { CustodyOverridesMap } from "@/components/calendar/calendar-with-custody";

const EVENT_TYPE_LABELS: Record<string, string> = {
  medical: "Medical",
  school: "School",
  extracurricular: "Extracurricular",
  custody_exchange: "Custody",
  therapy: "Therapy",
  other: "Other",
};

export type CalendarEventRow = {
  id: string;
  title: string;
  description: string | null;
  event_type: string | null;
  child_id: string | null;
  child_name: string | null;
  start_time: string;
  end_time: string | null;
  all_day: boolean;
  status: string | null;
  isPrivate: boolean;
  isMine: boolean;
  created_at: string;
  created_by_name: string | null;
  recurring_rule?: string | null;
  visibility?: "family" | "parents_only" | "private" | "family_read_only" | null;
  kid_title?: string | null;
};

export type CustodyScheduleForOverlay = {
  schedule_type: string;
  rotation_start_date: string | null;
  user_starts_first: boolean | null;
} | null;

interface CalendarMonthProps {
  year: number;
  month: number;
  events: CalendarEventRow[];
  caseId: string;
  children: { id: string; first_name: string }[];
  onRefresh?: () => void;
  onEventClick?: (event: CalendarEventRow) => void;
  custodySchedule?: CustodyScheduleForOverlay;
  custodyOverrides?: CustodyOverridesMap;
  custodyOverlayOn?: boolean;
  onCustodyOverlayChange?: (on: boolean) => void;
  appMode?: string | null;
  userId?: string;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function CalendarMonth({
  year,
  month,
  events,
  caseId,
  children,
  onRefresh,
  onEventClick,
  custodySchedule = null,
  custodyOverrides = {},
  custodyOverlayOn = false,
  onCustodyOverlayChange,
  appMode = null,
  userId = "",
}: CalendarMonthProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [ownerFilter, setOwnerFilter] = useState<"all" | "mine" | "shared">(
    "all"
  );
  const [categoryFilter, setCategoryFilter] = useState<"all" | string>("all");
  const [conflictsOnly, setConflictsOnly] = useState(false);
  const [dateRangeFilter, setDateRangeFilter] = useState<
    "all" | "past7" | "past30" | "past90" | "this_month" | "last_month" | "custom"
  >("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const hasCustodySchedule = !!custodySchedule;

  /**
   * Custody for a single date. Resolution order: (a) overridesMap, (b) rotation, (c) manual + no override → no tint.
   * dateKey must be YYYY-MM-DD (e.g. from calendar cell key).
   */
  function getCustodyForDateKey(dateKey: string): "user" | "coparent" | null {
    if (!custodySchedule || !custodyOverlayOn) return null;
    const dateString = /^\d{4}-\d{2}-\d{2}/.test(dateKey) ? dateKey.slice(0, 10) : dateKey;
    const override = custodyOverrides[dateString];
    if (override === "user") return "user";
    if (override === "coparent") return "coparent";
    if (override === "neither") return null;
    if (custodySchedule.schedule_type === "manual" || custodySchedule.schedule_type === "school_year") return null;
    const [y, m, d] = dateString.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return getCustodyFromRotation(date, custodySchedule);
  }

  const viewMode: "month" | "list" =
    searchParams.get("view") === "list" ? "list" : "month";
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);
  const startPad = first.getDay();
  const daysInMonth = last.getDate();
  const totalCells = startPad + daysInMonth;
  const rows = Math.ceil(totalCells / 7);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("myvowCalendarViewChange", { detail: viewMode })
    );
  }, [viewMode]);

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  function getDateRangeBounds(): { start: Date; end: Date } | null {
    if (dateRangeFilter === "all") return null;
    const end = new Date(startOfToday);
    end.setHours(23, 59, 59, 999);
    if (dateRangeFilter === "past7") {
      const start = new Date(end);
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    }
    if (dateRangeFilter === "past30") {
      const start = new Date(end);
      start.setDate(start.getDate() - 29);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    }
    if (dateRangeFilter === "past90") {
      const start = new Date(end);
      start.setDate(start.getDate() - 89);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    }
    if (dateRangeFilter === "this_month") {
      const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      return { start, end: lastDay };
    }
    if (dateRangeFilter === "last_month") {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
      const lastDay = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      return { start, end: lastDay };
    }
    if (dateRangeFilter === "custom" && customFrom && customTo && /^\d{4}-\d{2}-\d{2}$/.test(customFrom) && /^\d{4}-\d{2}-\d{2}$/.test(customTo)) {
      const [sy, sm, sd] = customFrom.split("-").map(Number);
      const [ey, em, ed] = customTo.split("-").map(Number);
      const start = new Date(sy, sm - 1, sd, 0, 0, 0, 0);
      const end = new Date(ey, em - 1, ed, 23, 59, 59, 999);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
      return { start, end };
    }
    return null;
  }

  const dateRangeBounds = getDateRangeBounds();
  const hasActiveFilters =
    ownerFilter !== "all" ||
    categoryFilter !== "all" ||
    conflictsOnly ||
    dateRangeFilter !== "all";
  function clearAllFilters() {
    setOwnerFilter("all");
    setCategoryFilter("all");
    setConflictsOnly(false);
    setDateRangeFilter("all");
    setCustomFrom("");
    setCustomTo("");
  }
  function getFilterDescription(): string {
    const parts: string[] = [];
    if (ownerFilter !== "all") {
      parts.push(ownerFilter === "mine" ? "My events" : "Shared events");
    }
    if (categoryFilter !== "all") {
      parts.push(EVENT_TYPE_LABELS[categoryFilter] ?? categoryFilter);
    }
    if (conflictsOnly) parts.push("Conflicts only");
    if (viewMode === "list" && dateRangeFilter !== "all") {
      if (dateRangeFilter === "past7") parts.push("Past 7 days");
      else if (dateRangeFilter === "past30") parts.push("Past 30 days");
      else if (dateRangeFilter === "past90") parts.push("Past 90 days");
      else if (dateRangeFilter === "this_month") parts.push("This month");
      else if (dateRangeFilter === "last_month") parts.push("Last month");
      else if (dateRangeFilter === "custom" && customFrom && customTo) {
        parts.push(`${customFrom} to ${customTo}`);
      } else if (dateRangeFilter === "custom") parts.push("Custom");
    }
    return parts.join(" · ");
  }
  const filteredEvents = events.filter((e) => {
    if (ownerFilter === "mine" && !e.isMine) return false;
    if (ownerFilter === "shared" && e.isPrivate) return false;
    if (categoryFilter !== "all" && e.event_type !== categoryFilter)
      return false;
    if (conflictsOnly && e.status !== "conflict") return false;
    if (viewMode === "list" && dateRangeBounds) {
      const d = new Date(e.start_time).getTime();
      if (d < dateRangeBounds.start.getTime() || d > dateRangeBounds.end.getTime()) return false;
    }
    return true;
  });

  const eventsByDay: Record<string, CalendarEventRow[]> = {};
  for (const e of filteredEvents) {
    const d = new Date(e.start_time);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!eventsByDay[key]) eventsByDay[key] = [];
    eventsByDay[key].push(e);
  }

  function buildViewHref(nextView: "month" | "list") {
    const params = new URLSearchParams();
    params.set("year", String(year));
    params.set("month", String(month));
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (nextView === "list") params.set("view", "list");
    return `/calendar?${params.toString()}`;
  }

  const monthHref = buildViewHref("month");
  const listHref = buildViewHref("list");

  function goMonth(delta: number) {
    const next = new Date(year, month - 1 + delta, 1);
    const params = new URLSearchParams();
    params.set("year", String(next.getFullYear()));
    params.set("month", String(next.getMonth() + 1));
    if (viewMode === "list") params.set("view", "list");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    router.push(`/calendar?${params.toString()}`);
  }

  const monthName = first.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const today = new Date();
  const todayYear = today.getFullYear();
  const todayMonth = today.getMonth() + 1;
  const todayDate = today.getDate();

  const cells: { day: number | null; key: string | null }[] = [];
  for (let i = 0; i < rows * 7; i++) {
    if (i < startPad) {
      cells.push({ day: null, key: null });
    } else {
      const d = i - startPad + 1;
      if (d <= daysInMonth) {
        const key = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        cells.push({ day: d, key });
      } else {
        cells.push({ day: null, key: null });
      }
    }
  }

  const isMonthView = viewMode === "month";

  return (
    <>
      <Card className="shadow-card">
        <CardHeader className="flex flex-col gap-2 space-y-0 pb-0.5">
          {/* Row 1: Month nav — same for Month and List view */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => goMonth(-1)}
              className="p-1 rounded-md hover:bg-muted"
              aria-label="Previous month"
            >
              ←
            </button>
            <h2 className="text-lg font-semibold">
              {monthName}
            </h2>
            <button
              type="button"
              onClick={() => goMonth(1)}
              className="p-1 rounded-md hover:bg-muted"
              aria-label="Next month"
            >
              →
            </button>
          </div>
          {/* Row 2: Month/List toggle far left, filters grouped to the right — same for both views */}
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-foreground-secondary">
              <div className="flex items-center gap-2">
              <div className="inline-flex rounded-full border border-border bg-background-secondary/60 p-0.5">
                <Link
                  href={monthHref}
                  className={cn(
                    "px-3 py-1 text-xs rounded-full",
                    isMonthView
                      ? "bg-[#7B9E87] text-white"
                      : "text-foreground-secondary"
                  )}
                >
                  Month
                </Link>
                <Link
                  href={listHref}
                  className={cn(
                    "px-3 py-1 text-xs rounded-full",
                    !isMonthView
                      ? "bg-[#7B9E87] text-white"
                      : "text-foreground-secondary"
                  )}
                >
                  List
                </Link>
                <Link
                  href={`/calendar?view=year&year=${year}`}
                  className="px-3 py-1 text-xs rounded-full text-foreground-secondary hover:text-foreground"
                >
                  Year
                </Link>
                {hasCustodySchedule && onCustodyOverlayChange != null && (
                  <button
                    type="button"
                    onClick={() => onCustodyOverlayChange(!custodyOverlayOn)}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                      custodyOverlayOn
                        ? "bg-[#7B9E87] text-white"
                        : "text-foreground-secondary hover:text-foreground"
                    )}
                  >
                    Custody
                  </button>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {!isMonthView && hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="text-sm text-foreground-secondary hover:text-foreground transition-colors"
                >
                  Clear filters ×
                </button>
              )}
              <select
                value={ownerFilter}
                onChange={(e) =>
                  setOwnerFilter(e.target.value as "all" | "mine" | "shared")
                }
                className="h-8 rounded-card border border-border bg-background px-2"
              >
                <option value="all">All events</option>
                <option value="mine">My events</option>
                <option value="shared">Shared events</option>
              </select>
              <select
                value={categoryFilter}
                onChange={(e) =>
                  setCategoryFilter(e.target.value as "all" | string)
                }
                className="h-8 rounded-card border border-border bg-background px-2"
              >
                <option value="all">All categories</option>
                {Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setConflictsOnly((prev) => !prev)}
                className={cn(
                  "rounded-full px-3 py-1 border text-xs",
                  conflictsOnly
                    ? "bg-[#7B9E87] border-[#7B9E87] text-white"
                    : "border-border text-foreground-secondary bg-background hover:bg-muted hover:text-foreground"
                )}
              >
                Conflicts only
              </button>
              {!isMonthView && (
                <>
                  <select
                    value={dateRangeFilter}
                    onChange={(e) =>
                      setDateRangeFilter(
                        e.target.value as
                          | "all"
                          | "past7"
                          | "past30"
                          | "past90"
                          | "this_month"
                          | "last_month"
                          | "custom"
                      )
                    }
                    className="h-8 rounded-card border border-border bg-background px-2"
                  >
                    <option value="all">All dates</option>
                    <option value="past7">Past 7 days</option>
                    <option value="past30">Past 30 days</option>
                    <option value="past90">Past 90 days</option>
                    <option value="this_month">This month</option>
                    <option value="last_month">Last month</option>
                    <option value="custom">Custom</option>
                  </select>
                  {dateRangeFilter === "custom" && (
                    <span className="inline-flex items-center gap-1.5">
                      <input
                        type="date"
                        value={customFrom}
                        onChange={(e) => setCustomFrom(e.target.value)}
                        className="h-8 rounded-card border border-border bg-background px-2 text-xs"
                        placeholder="From"
                      />
                      <span className="text-foreground-secondary">to</span>
                      <input
                        type="date"
                        value={customTo}
                        onChange={(e) => setCustomTo(e.target.value)}
                        className="h-8 rounded-card border border-border bg-background px-2 text-xs"
                        placeholder="To"
                      />
                    </span>
                  )}
                </>
              )}
              <CalendarExportButton
                view={viewMode}
                year={year}
                month={month}
                events={filteredEvents}
                filterDescription={getFilterDescription() || undefined}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0.5">
          {viewMode === "month" ? (
            <>
              <div className="grid grid-cols-7 gap-px rounded-card border border-gray-300 bg-gray-300">
                {DAYS.map((day) => (
                  <div
                    key={day}
                    className="border-r border-b border-gray-300 bg-gray-200/95 px-1 py-1 text-center text-[11px] font-medium text-gray-600"
                  >
                    {day}
                  </div>
                ))}
                {cells.map(({ day, key }, i) => {
                  const isToday =
                    day != null &&
                    year === todayYear &&
                    month === todayMonth &&
                    day === todayDate;
                  const custody = key ? getCustodyForDateKey(key) : null;
                  const custodyBg =
                    custody === "user" ? "bg-green-50" : custody === "coparent" ? "bg-stone-100" : null;
                  return (
                  <div
                    key={i}
                    className={cn(
                      "min-h-[100px] border-r border-b border-gray-300 p-1.5",
                      !day && "bg-background-secondary/30",
                      day != null && !isToday && !custodyBg && "bg-background",
                      day != null && isToday && !custodyBg && "bg-[#EBE9E6]",
                      custodyBg
                    )}
                  >
                    {day != null && (
                      <>
                        <p
                          className={cn(
                            "text-sm font-medium",
                            isToday ? "text-gray-800" : "text-gray-700"
                          )}
                        >
                          {day}
                        </p>
                        <ul className="mt-1 space-y-1">
                          {(eventsByDay[key!] ?? []).map((ev) => {
                            const isCanceled = ev.status === "canceled";
                            const color = isCanceled
                              ? { bg: "bg-gray-100", dot: "bg-gray-400" }
                              : getCalendarEventColors(ev.event_type);
                            const categoryLabel =
                              EVENT_TYPE_LABELS[ev.event_type ?? ""] ??
                              ev.event_type ??
                              "Event";
                            return (
                              <li key={ev.id}>
                                <button
                                  type="button"
                                  className={cn(
                                    "w-full text-left",
                                    "rounded-card px-2 py-1 text-xs shadow-card",
                                    "bg-background hover:bg-muted",
                                    isCanceled ? "text-gray-500" : "text-foreground",
                                    color.bg
                                  )}
                                  title={ev.description ?? ev.title}
                                  onClick={() => onEventClick?.(ev)}
                                >
                                  <div className="flex items-center gap-1">
                                    <span
                                      className={cn(
                                        "inline-block h-2.5 w-2.5 rounded-full",
                                        color.dot
                                      )}
                                    />
                                    <span
                                      className={cn(
                                        "truncate font-semibold",
                                        isCanceled && "line-through"
                                      )}
                                    >
                                      {ev.title}
                                    </span>
                                  </div>
                                  <span className={cn(
                                    "mt-0.5 block truncate text-[10px]",
                                    isCanceled ? "text-gray-400" : "text-foreground-secondary/60"
                                  )}>
                                    {ev.all_day
                                      ? categoryLabel
                                      : `${formatTime(ev.start_time)} · ${categoryLabel}`}
                                    {ev.child_name && ` · ${ev.child_name}`}
                                  </span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </>
                    )}
                  </div>
                );
                })}
              </div>
              {filteredEvents.length === 0 && (
                <p className="mt-4 text-center text-xs text-foreground-secondary">
                  No events scheduled yet.
                </p>
              )}
            </>
          ) : (
            <div className="mt-1.5 overflow-x-auto rounded-card border border-border bg-background">
              {filteredEvents.length === 0 ? (
                <p className="px-4 py-4 text-xs text-foreground-secondary text-center">
                  No events scheduled yet.
                </p>
              ) : (
                <>
                <table className="min-w-full text-left text-xs md:text-sm">
                  <thead>
                    <tr className="bg-[#E7EFE8]/80 text-foreground-secondary">
                      <th className="w-8 px-3 py-2"></th>
                      <th className="px-3 py-2 font-medium">event</th>
                      <th className="px-3 py-2 font-medium">date</th>
                      <th className="px-3 py-2 font-medium">time</th>
                      <th className="px-3 py-2 font-medium">child</th>
                      <th className="px-3 py-2 font-medium">category</th>
                      <th className="px-3 py-2 font-medium">status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const sorted = filteredEvents
                        .slice()
                        .sort(
                          (a, b) =>
                            new Date(a.start_time).getTime() -
                            new Date(b.start_time).getTime()
                        )
                        .slice(0, 25);
                      const groups = new Map<string, typeof sorted>();
                      for (const ev of sorted) {
                        const d = new Date(ev.start_time);
                        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                        if (!groups.has(key)) groups.set(key, []);
                        groups.get(key)!.push(ev);
                      }
                      const statusLabelMap: Record<string, string> = {
                        scheduled: "Scheduled",
                        completed: "Completed",
                        no_show: "No-show",
                        conflict: "Conflict",
                        canceled: "Canceled",
                      };
                      const statusClassMap: Record<string, string> = {
                        scheduled: "bg-[#7B9E87]/15 text-[#7B9E87]",
                        completed: "bg-[#7B9E87]/25 text-[#5A7A63]",
                        no_show: "bg-[#C9A97B]/20 text-[#A08050]",
                        conflict: "bg-[#C97B7B]/15 text-[#A05555]",
                        canceled: "bg-gray-100 text-gray-400",
                      };
                      let rowIndex = 0;
                      return Array.from(groups.entries()).flatMap(([dateKey, groupEvents]) => {
                        const custody =
                          custodyOverlayOn && hasCustodySchedule
                            ? getCustodyForDateKey(dateKey)
                            : null;
                        const borderClass = custody === "user" ? "border-l-4 border-l-green-500" : custody === "coparent" ? "border-l-4 border-l-stone-400" : "";
                        const [y, m, d] = dateKey.split("-").map(Number);
                        const dateForCustody = new Date(y, m - 1, d);
                        const dateStr = dateForCustody.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                        const headerRow =
                          custodyOverlayOn && hasCustodySchedule ? (
                            <tr key={`h-${dateKey}`} className={cn("border-t border-border", borderClass)}>
                              <td colSpan={7} className="px-3 py-1 text-foreground-secondary font-medium">
                                {dateStr}
                              </td>
                            </tr>
                          ) : null;
                        const eventRows = groupEvents.map((ev) => {
                          const isCanceled = ev.status === "canceled";
                          const color = isCanceled ? { bg: "bg-gray-100", dot: "bg-gray-400" } : getCalendarEventColors(ev.event_type);
                          const categoryLabel = EVENT_TYPE_LABELS[ev.event_type ?? ""] ?? ev.event_type ?? "Event";
                          const rowBg = isCanceled ? "bg-gray-50" : rowIndex++ % 2 === 0 ? "bg-background" : "bg-[#FAF8F5]";
                          const rawStatus = ev.status ?? "scheduled";
                          const statusKey = ["completed", "no_show", "conflict", "canceled"].includes(rawStatus) ? rawStatus : "scheduled";
                          const dateStrEv = new Date(ev.start_time).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                          const timeStr = formatTime(ev.start_time);
                          return (
                            <tr
                              key={ev.id}
                              className={cn(
                                rowBg,
                                "border-t border-border cursor-pointer hover:bg-background-secondary/50",
                                isCanceled ? "text-gray-500" : "text-foreground"
                              )}
                              onClick={() => onEventClick?.(ev)}
                            >
                              <td className="px-3 py-1.5 align-middle">
                                <span className={cn("inline-block h-2.5 w-2.5 rounded-full opacity-75", color.dot)} />
                              </td>
                              <td className={cn("px-3 py-1.5 align-middle font-medium", isCanceled && "line-through")}>
                                {ev.title}
                              </td>
                              <td className="px-3 py-1.5 align-middle text-foreground-secondary">{dateStrEv}</td>
                              <td className="px-3 py-1.5 align-middle text-foreground-secondary">{timeStr}</td>
                              <td className="px-3 py-1.5 align-middle text-foreground-secondary">
                                {ev.child_name || "All children"}
                              </td>
                              <td className="px-3 py-1.5 align-middle text-foreground-secondary">
                                {categoryLabel}
                              </td>
                              <td className="px-3 py-1.5 align-middle">
                                <span
                                  className={cn(
                                    "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] md:text-xs font-medium",
                                    statusClassMap[statusKey]
                                  )}
                                >
                                  {statusLabelMap[statusKey]}
                                </span>
                              </td>
                            </tr>
                          );
                        });
                        return headerRow ? [headerRow, ...eventRows] : eventRows;
                      });
                    })()}
                  </tbody>
                </table>
                {filteredEvents.length > 25 && (
                  <div className="border-t border-border px-3 py-2 text-center">
                    <Link
                      href={monthHref}
                      className="text-xs text-foreground-secondary underline-offset-2 hover:underline"
                    >
                      View all events
                    </Link>
                  </div>
                )}
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
