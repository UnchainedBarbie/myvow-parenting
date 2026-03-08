"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getCustodyFromRotation } from "@/lib/calendarCustody";
import {
  CalendarMonthKids,
  type CalendarEventRowKids,
  type CustodyScheduleForOverlay,
} from "@/components/calendar/calendar-month-kids";

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
        router.push("/kids/login");
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
        <CalendarMonthKids
          year={year}
          month={month}
          events={events}
          custodySchedule={custodySchedule ?? null}
          custodyOverrides={{}}
          kidsLabelUser={kidsLabelUser}
          kidsLabelCoparent={kidsLabelCoparent}
          onMonthChange={(y, m) => {
            setYear(y);
            setMonth(m);
          }}
        />
      )}
    </div>
  );
}
