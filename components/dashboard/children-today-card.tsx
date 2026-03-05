"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export type ChildrenTodayCustodyItem = {
  child_id: string;
  child_name: string;
  event_title: string;
  start_time: string;
  all_day: boolean;
};

export type NextExchange = {
  start_time: string;
  title: string;
  child_name: string | null;
} | null;

type Props = {
  items: ChildrenTodayCustodyItem[];
  nextExchange: NextExchange;
  timezone: string;
};

function formatTime(iso: string, timezone: string) {
  const d = new Date(iso);
  const hasTime = !(d.getHours() === 0 && d.getMinutes() === 0);
  if (!hasTime) return null;
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });
}

function formatExchangeDateTime(iso: string, timezone: string) {
  const d = new Date(iso);
  const dateStr = d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: timezone,
  });
  const timeStr = formatTime(iso, timezone);
  return timeStr ? `${dateStr} at ${timeStr}` : dateStr;
}

export function ChildrenTodayCard({ items, nextExchange, timezone }: Props) {
  const hasCustodyData = items.length > 0 || nextExchange != null;

  return (
    <Card className="rounded-card border border-[#E8E4DC] bg-[#FDFBF7]">
      <CardHeader className="pb-2 px-4 pt-4 flex items-center justify-between gap-2">
        <CardTitle className="font-heading text-lg text-foreground">
          Children today
        </CardTitle>
        <Button asChild size="sm" variant="outline" className="rounded-full h-8 text-xs">
          <Link href="/calendar">Calendar</Link>
        </Button>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        {!hasCustodyData ? (
          <p className="text-sm text-foreground-secondary">
            Add custody events to your calendar to see this.
          </p>
        ) : (
          <>
            {items.length > 0 && (
              <ul className="space-y-2">
                {items.map((item) => {
                  const timeStr = formatTime(item.start_time, timezone);
                  return (
                    <li key={`${item.child_id}-${item.start_time}`} className="flex flex-col gap-0.5">
                      <p className="text-sm font-medium text-foreground">
                        {item.child_name}
                      </p>
                      <p className="text-xs text-foreground-secondary">
                        {item.event_title}
                        {timeStr ? ` · ${timeStr}` : ""}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
            {nextExchange && (
              <p className="text-xs text-foreground-secondary border-t border-[#E8E4DC] pt-2 mt-1">
                <span className="font-medium text-foreground">Next custody exchange:</span>{" "}
                {formatExchangeDateTime(nextExchange.start_time, timezone)}
                {nextExchange.child_name ? ` (${nextExchange.child_name})` : ""}
                {nextExchange.title ? ` — ${nextExchange.title}` : ""}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
