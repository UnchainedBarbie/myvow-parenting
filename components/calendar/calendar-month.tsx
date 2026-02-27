"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { EventDetailModal } from "@/components/calendar/event-detail-modal";

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
};

interface CalendarMonthProps {
  year: number;
  month: number;
  events: CalendarEventRow[];
  caseId: string;
  children: { id: string; first_name: string }[];
  onRefresh?: () => void;
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
}: CalendarMonthProps) {
  const router = useRouter();
  const [ownerFilter, setOwnerFilter] = useState<"all" | "mine" | "shared">(
    "all"
  );
  const [categoryFilter, setCategoryFilter] = useState<"all" | string>("all");
  const [conflictsOnly, setConflictsOnly] = useState(false);
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);
  const startPad = first.getDay();
  const daysInMonth = last.getDate();
  const totalCells = startPad + daysInMonth;
  const rows = Math.ceil(totalCells / 7);

  const [selectedEvent, setSelectedEvent] = useState<CalendarEventRow | null>(
    null
  );
  const [open, setOpen] = useState(false);

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

  return (
    <>
      <Card className="shadow-card">
        <CardHeader className="flex flex-col gap-2 space-y-0 pb-2">
          <div className="flex flex-row items-center justify-between">
            <CardTitle className="font-heading text-lg">{monthName}</CardTitle>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => goMonth(-1)}
                className="rounded-full p-2 text-foreground-secondary hover:bg-muted hover:text-foreground"
                aria-label="Previous month"
              >
                ←
              </button>
              <Link
                href={`/calendar?year=${new Date().getFullYear()}&month=${new Date().getMonth() + 1}`}
                className="rounded-full px-3 py-1.5 text-sm text-foreground-secondary hover:bg-muted hover:text-foreground"
              >
                Today
              </Link>
              <button
                type="button"
                onClick={() => goMonth(1)}
                className="rounded-full p-2 text-foreground-secondary hover:bg-muted hover:text-foreground"
                aria-label="Next month"
              >
                →
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-foreground-secondary">
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
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-px rounded-card border border-border bg-border">
            {DAYS.map((day) => (
              <div
                key={day}
                className="bg-background-secondary px-1 py-2 text-center text-xs font-medium text-foreground-secondary"
              >
                {day}
              </div>
            ))}
            {cells.map(({ day, key }, i) => (
              <div
                key={i}
                className={cn(
                  "min-h-[80px] bg-background p-2",
                  !day && "bg-background-secondary/30"
                )}
              >
                {day != null && (
                  <>
                    <p className="text-sm font-medium text-foreground">{day}</p>
                    <ul className="mt-1 space-y-1">
                      {(eventsByDay[key!] ?? []).map((ev) => {
                        const color =
                          EVENT_COLORS[ev.event_type ?? ""] ?? {
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
                                "text-foreground bg-background",
                                color.bg,
                                "hover:bg-muted"
                              )}
                              title={ev.description ?? ev.title}
                              onClick={() => {
                                setSelectedEvent(ev);
                                setOpen(true);
                              }}
                            >
                              <div className="flex items-center gap-1">
                                <span
                                  className={cn(
                                    "inline-block h-2.5 w-2.5 rounded-full",
                                    color.dot
                                  )}
                                />
                                <span className="truncate font-semibold">
                                  {ev.title}
                                </span>
                              </div>
                              <span className="mt-0.5 block truncate text-[10px] text-foreground-secondary/60">
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
            ))}
          </div>
          {filteredEvents.length === 0 && (
            <p className="mt-4 text-center text-xs text-foreground-secondary">
              No events scheduled yet.
            </p>
          )}
        </CardContent>
      </Card>
      <EventDetailModal
        open={open}
        onClose={() => setOpen(false)}
        event={selectedEvent}
        caseId={caseId}
        children={children}
        onSaved={onRefresh}
      />
    </>
  );
}
