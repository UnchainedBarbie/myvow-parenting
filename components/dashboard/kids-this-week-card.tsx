"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type KidsThisWeekEvent = {
  id: string;
  title: string;
  start_time: string;
  all_day: boolean;
};

export type KidsThisWeekChild = {
  id: string;
  first_name: string;
  ageLabel: string;
  profile_image: string | null;
  weekByDay: {
    date: Date;
    events: KidsThisWeekEvent[];
  }[];
  nextEvent: KidsThisWeekEvent | null;
};

type Props = {
  childrenSummaries: KidsThisWeekChild[];
  timezone: string;
};

function formatShortDay(date: Date, timezone: string) {
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: timezone,
  });
}

function formatShortTime(iso: string, timezone: string) {
  const d = new Date(iso);
  const hasSpecificTime = !(d.getHours() === 0 && d.getMinutes() === 0);
  if (!hasSpecificTime) return "All day";
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });
}

export function KidsThisWeekCard({ childrenSummaries, timezone }: Props) {
  const hasAnyEvents = childrenSummaries.some((child) =>
    child.weekByDay.some((d) => d.events.length > 0)
  );

  return (
    <Card className="shadow-card border-border rounded-card">
      <CardHeader className="pb-2 px-4 pt-4 flex items-center justify-between gap-2">
        <CardTitle className="font-heading text-lg text-foreground">
          Kids this week
        </CardTitle>
        <Button
          asChild
          size="sm"
          variant="outline"
          className="rounded-full h-8 text-xs"
        >
          <Link href="/calendar">View full calendar</Link>
        </Button>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        {childrenSummaries.length === 0 ? (
          <p className="text-sm text-foreground-secondary">
            Add children from the Profile page to see their week here.
          </p>
        ) : !hasAnyEvents ? (
          <p className="text-sm text-foreground-secondary">
            No events scheduled this week.
          </p>
        ) : (
          <ul className="space-y-2">
            {childrenSummaries.map((child) => (
              <li
                key={child.id}
                className="flex flex-col gap-2 rounded-card border border-border bg-background-secondary/60 px-3 py-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    {child.profile_image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={child.profile_image}
                        alt={child.first_name}
                        className="h-7 w-7 rounded-full object-cover border border-border/60 bg-emerald-50"
                      />
                    ) : (
                      <div className="h-7 w-7 rounded-full bg-emerald-50 text-emerald-800 flex items-center justify-center text-xs font-medium">
                        {child.first_name?.charAt(0).toUpperCase() ?? ""}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {child.first_name}
                      </p>
                      <p className="text-xs text-foreground-secondary">
                        {child.ageLabel}
                      </p>
                      {child.nextEvent && (
                        <p className="mt-0.5 text-[11px] text-foreground-secondary truncate">
                          Next: {child.nextEvent.title} ·{" "}
                          {formatShortDay(
                            new Date(child.nextEvent.start_time),
                            timezone
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-1 overflow-x-auto">
                  <div className="grid grid-cols-7 gap-2 min-w-[420px] text-[11px]">
                    {child.weekByDay.map((d) => {
                      const isToday =
                        d.date.toDateString() === new Date().toDateString();
                      const count = d.events.length;
                      const first = d.events[0] ?? null;

                      return (
                        <div
                          key={`${child.id}-${d.date.toISOString()}`}
                          className={cn(
                            "rounded-card border border-[#E8E4DC] bg-background-secondary/60 px-1.5 py-1 space-y-0.5 min-w-0",
                            isToday && "border-[#E8E4DC] bg-[#F5F0E8]"
                          )}
                        >
                          <p className="font-medium text-foreground truncate">
                            {d.date.toLocaleDateString("en-US", {
                              weekday: "short",
                            })}
                          </p>
                          {count === 0 ? (
                            <p className="text-[10px] text-foreground-secondary">
                              –
                            </p>
                          ) : (
                            <>
                              <p className="text-[10px] text-foreground-secondary">
                                {count === 1 ? "1 event" : `${count} events`}
                              </p>
                              {first && (
                                <p className="text-[10px] text-foreground truncate">
                                  {first.title}
                                </p>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

