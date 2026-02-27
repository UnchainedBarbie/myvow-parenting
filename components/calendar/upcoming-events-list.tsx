"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { CalendarEventRow } from "@/components/calendar/calendar-month";

type UpcomingEvent = {
  id: string;
  title: string;
  event_type: string | null;
  child_name: string | null;
  start_time: string;
  status: string | null;
};

type Child = { id: string; first_name: string };

const CATEGORY_LABELS: Record<string, string> = {
  medical: "Medical",
  school: "School",
  extracurricular: "Extracurricular",
  custody_exchange: "Custody exchange",
  therapy: "Therapy",
  missed_visit: "Missed visit",
  conflict: "Conflict",
  other: "Other",
};

const EVENT_COLORS: Record<string, string> = {
  medical: "bg-[#7BA3C9]",
  school: "bg-[#7B9E87]",
  extracurricular: "bg-[#9B8EC4]",
  custody_exchange: "bg-[#C9A97B]",
  therapy: "bg-[#7BC9B5]",
  missed_visit: "bg-[#C97B7B]",
  conflict: "bg-[#C97B7B]",
};

function formatUpcomingDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatUpcomingTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

interface UpcomingEventsListProps {
  caseId: string;
  upcoming: UpcomingEvent[];
  events: CalendarEventRow[];
  children: Child[];
  onRefresh?: () => void;
  onEventClick?: (event: CalendarEventRow) => void;
}

export function UpcomingEventsList({
  caseId,
  upcoming,
  events,
  children,
  onRefresh,
  onEventClick,
}: UpcomingEventsListProps) {
  const [show, setShow] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    function handleViewModeChange(event: Event) {
      const custom = event as CustomEvent;
      const mode = custom.detail as string;
      setShow(mode !== "list");
    }
    window.addEventListener("myvowCalendarViewChange", handleViewModeChange);
    return () =>
      window.removeEventListener(
        "myvowCalendarViewChange",
        handleViewModeChange
      );
  }, []);

  function handleOpen(eventId: string) {
    const ev = events.find((e) => e.id === eventId) ?? null;
    if (!ev) return;
    onEventClick?.(ev);
  }

  if (!show) {
    return null;
  }

  const limited = upcoming.slice(0, 5);
  const hasMore = upcoming.length > 5;

  return (
    <>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-lg text-foreground">
            Upcoming Events
          </h2>
          <div className="ml-4 flex-1 bg-border h-px" />
        </div>
        <div className="rounded-card border border-border bg-background shadow-card">
          {upcoming.length === 0 ? (
            <p className="px-4 py-4 text-sm text-foreground-secondary">
              No upcoming events.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-xs md:text-sm">
                <thead>
                  <tr className="bg-[#E7EFE8] text-foreground-secondary">
                    <th className="w-8 px-3 py-2"></th>
                    <th className="px-3 py-2 font-semibold">event</th>
                    <th className="px-3 py-2 font-semibold">date</th>
                    <th className="px-3 py-2 font-semibold">time</th>
                    <th className="px-3 py-2 font-semibold">child</th>
                    <th className="px-3 py-2 font-semibold">category</th>
                    <th className="px-3 py-2 font-semibold">status</th>
                  </tr>
                </thead>
                <tbody>
                  {limited.map((e, index) => {
                    const colorClass =
                      EVENT_COLORS[e.event_type ?? ""] ?? "bg-primary";
                    const label =
                      CATEGORY_LABELS[e.event_type ?? ""] ??
                      e.event_type ??
                      "Event";
                    const rowBg =
                      index % 2 === 0 ? "bg-background" : "bg-[#FAF8F5]";

                    const rawStatus = e.status ?? "scheduled";
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
                    return (
                      <tr
                        key={e.id}
                        className={cn(
                          rowBg,
                          "border-t border-border text-foreground cursor-pointer hover:bg-background-secondary/50"
                        )}
                        onClick={() => handleOpen(e.id)}
                      >
                        <td className="px-3 py-2 align-middle">
                          <span
                            className={cn(
                              "inline-block h-2.5 w-2.5 rounded-full",
                              colorClass
                            )}
                          />
                        </td>
                        <td className="px-3 py-2 align-middle font-medium">
                          {e.title}
                        </td>
                        <td className="px-3 py-2 align-middle text-foreground-secondary">
                          {formatUpcomingDate(e.start_time)}
                        </td>
                        <td className="px-3 py-2 align-middle text-foreground-secondary">
                          {formatUpcomingTime(e.start_time)}
                        </td>
                        <td className="px-3 py-2 align-middle text-foreground-secondary">
                          {e.child_name ? e.child_name : "All children"}
                        </td>
                        <td className="px-3 py-2 align-middle text-foreground-secondary">
                          {label}
                        </td>
                        <td className="px-3 py-2 align-middle">
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
              {hasMore && (
                <div className="border-t border-border px-3 py-2 text-right">
                  <button
                    type="button"
                    className="text-xs text-foreground-secondary underline-offset-2 hover:underline"
                  >
                    View all
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

