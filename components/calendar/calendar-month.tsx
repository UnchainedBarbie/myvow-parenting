"use client";

import { useState } from "react";
import Link from "next/link";
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
};

interface CalendarMonthProps {
  year: number;
  month: number;
  events: CalendarEventRow[];
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function CalendarMonth({ year, month, events }: CalendarMonthProps) {
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
          <label className="inline-flex items-center gap-1">
            <input
              type="checkbox"
              checked={conflictsOnly}
              onChange={(e) => setConflictsOnly(e.target.checked)}
              className="rounded border-border"
            />
            <span>Conflicts only</span>
          </label>
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
                    {(eventsByDay[key!] ?? []).map((ev) => (
                      <li key={ev.id}>
                        <span
                          className={cn(
                            "block rounded px-2 py-0.5 text-left text-xs",
                            "bg-primary-light text-primary-dark"
                          )}
                          title={ev.description ?? ev.title}
                        >
                          <span className="font-medium truncate block">
                            {ev.title}
                          </span>
                          <span className="text-foreground-secondary truncate block">
                            {ev.all_day
                              ? EVENT_TYPE_LABELS[ev.event_type ?? ""] ?? ev.event_type ?? "Event"
                              : formatTime(ev.start_time)}
                            {ev.child_name && ` · ${ev.child_name}`}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
