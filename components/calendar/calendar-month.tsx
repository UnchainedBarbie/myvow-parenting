"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const EVENT_TYPE_LABELS: Record<string, string> = {
  medical: "Medical",
  school: "School",
  extracurricular: "Extracurricular",
  custody_exchange: "Custody",
  therapy: "Therapy",
  other: "Other",
};

const EVENT_COLORS: Record<string, { bg: string; dot: string }> = {
  medical: { bg: "bg-[#7BA3C9]/15", dot: "bg-[#7BA3C9]" }, // soft blue
  school: { bg: "bg-[#7B9E87]/15", dot: "bg-[#7B9E87]" }, // sage
  extracurricular: { bg: "bg-[#9B8EC4]/15", dot: "bg-[#9B8EC4]" }, // soft purple
  custody_exchange: { bg: "bg-[#C9A97B]/20", dot: "bg-[#C9A97B]" }, // warm gold
  therapy: { bg: "bg-[#7BC9B5]/20", dot: "bg-[#7BC9B5]" }, // teal
  missed_visit: { bg: "bg-[#C97B7B]/15", dot: "bg-[#C97B7B]" }, // muted rose
  conflict: { bg: "bg-[#C97B7B]/15", dot: "bg-[#C97B7B]" }, // muted rose
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

interface CalendarMonthProps {
  year: number;
  month: number;
  events: CalendarEventRow[];
  caseId: string;
  children: { id: string; first_name: string }[];
  onRefresh?: () => void;
  onEventClick?: (event: CalendarEventRow) => void;
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
}: CalendarMonthProps) {
  const router = useRouter();
  const [ownerFilter, setOwnerFilter] = useState<"all" | "mine" | "shared">(
    "all"
  );
  const [categoryFilter, setCategoryFilter] = useState<"all" | string>("all");
  const [conflictsOnly, setConflictsOnly] = useState(false);
  const [viewMode, setViewMode] = useState<"month" | "list">("month");
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

  const filteredEvents = events.filter((e) => {
    if (ownerFilter === "mine" && !e.isMine) return false;
    if (ownerFilter === "shared" && e.isPrivate) return false;
    if (categoryFilter !== "all" && e.event_type !== categoryFilter)
      return false;
    if (conflictsOnly && e.status !== "conflict") return false;
    return true;
  });

  const eventsByDay: Record<string, CalendarEventRow[]> = {};
  for (const e of filteredEvents) {
    const d = new Date(e.start_time);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!eventsByDay[key]) eventsByDay[key] = [];
    eventsByDay[key].push(e);
  }

  function goMonth(delta: number) {
    const next = new Date(year, month - 1 + delta, 1);
    router.push(`/calendar?year=${next.getFullYear()}&month=${next.getMonth() + 1}`);
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
                <button
                  type="button"
                  onClick={() => setViewMode("month")}
                  className={cn(
                    "px-3 py-1 text-xs rounded-full",
                    isMonthView
                      ? "bg-[#7B9E87] text-white"
                      : "text-foreground-secondary"
                  )}
                >
                  Month
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("list")}
                  className={cn(
                    "px-3 py-1 text-xs rounded-full",
                    !isMonthView
                      ? "bg-[#7B9E87] text-white"
                      : "text-foreground-secondary"
                  )}
                >
                  List
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
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
                  return (
                  <div
                    key={i}
                    className={cn(
                      "min-h-[100px] border-r border-b border-gray-300 p-1.5",
                      !day && "bg-background-secondary/30",
                      day != null && !isToday && "bg-background",
                      day != null &&
                        isToday &&
                        "bg-[#EBE9E6]"
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
                              : EVENT_COLORS[ev.event_type ?? ""] ?? {
                                  bg: "bg-primary-light",
                                  dot: "bg-primary-dark",
                                };
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
              {events.length === 0 ? (
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
                    {events
                      .slice()
                      .sort(
                        (a, b) =>
                          new Date(a.start_time).getTime() -
                          new Date(b.start_time).getTime()
                      )
                      .slice(0, 25)
                      .map((ev, index) => {
                        const isCanceled = ev.status === "canceled";
                        const color = isCanceled
                          ? { bg: "bg-gray-100", dot: "bg-gray-400" }
                          : EVENT_COLORS[ev.event_type ?? ""] ?? {
                              bg: "bg-primary-light",
                              dot: "bg-primary-dark",
                            };
                        const categoryLabel =
                          EVENT_TYPE_LABELS[ev.event_type ?? ""] ??
                          ev.event_type ??
                          "Event";
                        const rowBg = isCanceled
                          ? "bg-gray-50"
                          : index % 2 === 0
                            ? "bg-background"
                            : "bg-[#FAF8F5]";
                        const rawStatus = ev.status ?? "scheduled";
                        const statusKey = (
                          ["completed", "no_show", "conflict", "canceled"].includes(
                            rawStatus
                          )
                            ? rawStatus
                            : "scheduled"
                        ) as "scheduled" | "completed" | "no_show" | "conflict" | "canceled";
                        const statusLabelMap: Record<
                          "scheduled" | "completed" | "no_show" | "conflict" | "canceled",
                          string
                        > = {
                          scheduled: "Scheduled",
                          completed: "Completed",
                          no_show: "No-show",
                          conflict: "Conflict",
                          canceled: "Canceled",
                        };
                        const statusClassMap: Record<
                          "scheduled" | "completed" | "no_show" | "conflict" | "canceled",
                          string
                        > = {
                          scheduled: "bg-[#7B9E87]/15 text-[#7B9E87]",
                          completed: "bg-[#7B9E87]/25 text-[#5A7A63]",
                          no_show: "bg-[#C9A97B]/20 text-[#A08050]",
                          conflict: "bg-[#C97B7B]/15 text-[#A05555]",
                          canceled: "bg-gray-100 text-gray-400",
                        };
                        const dateStr = new Date(
                          ev.start_time
                        ).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        });
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
                              <span
                                className={cn(
                                  "inline-block h-2.5 w-2.5 rounded-full opacity-75",
                                  color.dot
                                )}
                              />
                            </td>
                            <td
                              className={cn(
                                "px-3 py-1.5 align-middle font-medium",
                                isCanceled && "line-through"
                              )}
                            >
                              {ev.title}
                            </td>
                            <td className="px-3 py-1.5 align-middle text-foreground-secondary">
                              {dateStr}
                            </td>
                            <td className="px-3 py-1.5 align-middle text-foreground-secondary">
                              {timeStr}
                            </td>
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
                      })}
                  </tbody>
                </table>
                {events.length > 25 && (
                  <div className="border-t border-border px-3 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => setViewMode("month")}
                      className="text-xs text-foreground-secondary underline-offset-2 hover:underline"
                    >
                      View all events
                    </button>
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
