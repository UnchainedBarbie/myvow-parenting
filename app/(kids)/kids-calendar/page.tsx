"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getCustodyFromRotation, getCustodySwitchInfo } from "@/lib/calendarCustody";
import { cn } from "@/lib/utils";
import {
  CalendarMonthKids,
  type CalendarEventRowKids,
  type CustodyScheduleForOverlay,
} from "@/components/calendar/calendar-month-kids";

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

export default function KidsCalendarPage() {
  const router = useRouter();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [events, setEvents] = useState<CalendarEventRowKids[]>([]);
  const [custodySchedule, setCustodySchedule] = useState<CustodyScheduleForOverlay>(null);
  const [kidsLabelUser, setKidsLabelUser] = useState<string>("Your parent");
  const [kidsLabelCoparent, setKidsLabelCoparent] = useState<string>("Co-parent");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [eventsRes, scheduleRes, caseRes] = await Promise.all([
        fetch("/api/kids/calendar/events"),
        fetch("/api/kids/custody-schedule"),
        fetch("/api/kids/case-details"),
      ]);

      if (eventsRes.status === 401 || scheduleRes.status === 401) {
        router.push("/kids-login");
        return;
      }

      const eventsData = (await eventsRes.json().catch(() => ({}))) as {
        events?: CalendarEventRowKids[];
        message?: string;
      };
      if (!eventsRes.ok) {
        setError(eventsData.message ?? "Could not load calendar.");
        setEvents([]);
      } else {
        setEvents(eventsData.events ?? []);
      }

      const scheduleData = scheduleRes.ok
        ? await scheduleRes.json().catch(() => null)
        : null;
      setCustodySchedule(
        scheduleData && typeof scheduleData === "object" && scheduleData.schedule_type
          ? scheduleData
          : null
      );

      const caseData = caseRes.ok
        ? await caseRes.json().catch(() => ({}))
        : {};
      const labels = caseData as { kids_label_user?: string | null; kids_label_coparent?: string | null };
      if (labels.kids_label_user) setKidsLabelUser(labels.kids_label_user);
      if (labels.kids_label_coparent) setKidsLabelCoparent(labels.kids_label_coparent);
    } catch {
      setError("Could not load calendar.");
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    loadData().then(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [loadData]);

  const todayCustody =
    custodySchedule &&
    (() => {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      return getCustodyFromRotation(d, custodySchedule);
    })();

  const todayBanner =
    todayCustody === "user"
      ? { text: `Today you're with ${kidsLabelUser}`, className: "bg-[#7B9E87] text-white" }
      : todayCustody === "coparent"
        ? { text: `Today you're with ${kidsLabelCoparent}`, className: "bg-stone-200 text-stone-800" }
        : { text: "Check with your parents about today", className: "bg-stone-100 text-stone-600" };

  const custodySwitchInfo = useMemo(() => {
    if (!custodySchedule || todayCustody === null) return null;
    const from = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return getCustodySwitchInfo(custodySchedule, from);
  }, [custodySchedule, todayCustody]);

  const custodySwitchText = custodySwitchInfo && custodySwitchInfo.nextOwner
    ? custodySwitchInfo.daysUntilSwitch === 0
      ? `Switching to ${custodySwitchInfo.nextOwner === "user" ? kidsLabelUser : kidsLabelCoparent} today`
      : custodySwitchInfo.daysUntilSwitch === 1
        ? `Switching to ${custodySwitchInfo.nextOwner === "user" ? kidsLabelUser : kidsLabelCoparent} tomorrow`
        : `${custodySwitchInfo.daysUntilSwitch} more days with ${todayCustody === "user" ? kidsLabelUser : kidsLabelCoparent}`
    : null;

  const firstDayOfNextBlockKey = custodySwitchInfo?.firstDayOfNextBlockKey ?? null;

  const next7DaysEvents = useMemo(() => {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    const startMs = start.getTime();
    const endMs = end.getTime();
    return events
      .filter((e) => {
        const t = new Date(e.start_time).getTime();
        return t >= startMs && t < endMs;
      })
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  }, [events, today]);

  return (
    <div className="w-full max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 rounded-full text-xs"
          onClick={() => router.push("/kids")}
        >
          ← Back
        </Button>
        <h1 className="font-heading text-lg text-[#3D3D3D]">
          Your calendar
        </h1>
        <div className="w-16" />
      </div>

      <div
        className={todayBanner.className + " rounded-2xl px-4 py-3 text-center text-sm font-medium"}
        role="status"
      >
        {todayBanner.text}
      </div>

      {loading ? (
        <p className="text-sm text-foreground-secondary">Loading calendar…</p>
      ) : error ? (
        <p className="text-sm text-alert">{error}</p>
      ) : (
        <>
          <CalendarMonthKids
            year={year}
            month={month}
            events={events}
            custodySchedule={custodySchedule ?? null}
            custodyOverrides={{}}
            kidsLabelUser={kidsLabelUser}
            kidsLabelCoparent={kidsLabelCoparent}
            firstDayOfNextBlockKey={firstDayOfNextBlockKey}
            onMonthChange={(y, m) => {
              setYear(y);
              setMonth(m);
            }}
          />

          <section className="rounded-2xl border border-[#E8E4DC] bg-[#FDFBF7] p-4">
            <h2 className="text-sm font-semibold text-foreground mb-3">Coming up</h2>
            {next7DaysEvents.length === 0 ? (
              <p className="text-sm text-foreground-secondary">Nothing scheduled this week — enjoy your free time! 🌟</p>
            ) : (
              <ul className="space-y-2">
                {next7DaysEvents.map((ev) => {
                  const d = new Date(ev.start_time);
                  const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                  const custodyDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
                  const custody = custodySchedule ? getCustodyFromRotation(custodyDate, custodySchedule) : null;
                  const dayLabel = d.toLocaleDateString("en-US", { weekday: "long" });
                  const withWho = custody === "user" ? kidsLabelUser : custody === "coparent" ? kidsLabelCoparent : "your family";
                  const timeStr = formatTime(ev.start_time);
                  return (
                    <li key={ev.id} className="flex items-center gap-2 text-sm">
                      <span
                        className={cn(
                          "h-2.5 w-2.5 rounded-full shrink-0",
                          custody === "user" ? "bg-green-500" : "bg-stone-400"
                        )}
                        aria-hidden
                      />
                      <span className="text-foreground-secondary">{dayLabel} with {withWho}</span>
                      <span className="text-foreground-secondary">—</span>
                      <span className="font-medium text-foreground">{ev.title}</span>
                      {timeStr !== "12:00 AM" && <span className="text-foreground-secondary">{timeStr}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
