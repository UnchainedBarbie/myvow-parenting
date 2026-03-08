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
  const [eventRequests, setEventRequests] = useState<{
    id: string;
    title: string;
    requested_date: string;
    requested_time?: string | null;
    notes?: string | null;
    photo_url?: string | null;
    status: string;
  }[]>([]);
  const [editingRequest, setEditingRequest] = useState<{
    id: string;
    title: string;
    requested_date: string;
    requested_time?: string | null;
    notes?: string | null;
    photo_url?: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [eventsRes, scheduleRes, caseRes, requestsRes] = await Promise.all([
        fetch("/api/kids/calendar/events"),
        fetch("/api/kids/custody-schedule"),
        fetch("/api/kids/case-details"),
        fetch("/api/kids/event-requests"),
      ]);

      if (eventsRes.status === 401 || scheduleRes.status === 401 || requestsRes.status === 401) {
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

      const requestsData = requestsRes.ok ? await requestsRes.json().catch(() => []) : [];
      setEventRequests(Array.isArray(requestsData) ? requestsData : []);
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
      ? `Today you switch to ${custodySwitchInfo.nextOwner === "user" ? kidsLabelUser : kidsLabelCoparent}`
      : custodySwitchInfo.daysUntilSwitch === 1
        ? `Switching to ${custodySwitchInfo.nextOwner === "user" ? kidsLabelUser : kidsLabelCoparent} tomorrow`
        : `${custodySwitchInfo.daysUntilSwitch} more days with ${todayCustody === "user" ? kidsLabelUser : kidsLabelCoparent}`
    : null;

  const firstDayOfNextBlockKey = custodySwitchInfo?.firstDayOfNextBlockKey ?? null;

  const [openRequestWithNoDate, setOpenRequestWithNoDate] = useState(false);

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
      <div className="flex items-center justify-center">
        <h1 className="font-heading text-lg text-[#3D3D3D]">
          Your calendar
        </h1>
      </div>

      <div
        className={todayBanner.className + " rounded-2xl px-4 py-3 text-center"}
        role="status"
      >
        <p className="text-sm font-medium">{todayBanner.text}</p>
        {custodySwitchText && (
          <p className="text-sm opacity-80 mt-1">{custodySwitchText}</p>
        )}
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
            openRequestWithNoDate={openRequestWithNoDate}
            onRequestModalOpened={() => setOpenRequestWithNoDate(false)}
            editingRequest={editingRequest}
            onEditDone={() => {
              setEditingRequest(null);
              loadData();
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

          {eventRequests.length > 0 && (
            <section className="rounded-2xl border border-[#E8E4DC] bg-[#FDFBF7] p-4">
              <h2 className="text-sm font-semibold text-foreground mb-2">My Requests</h2>
              <hr className="border-[#E8E4DC] mb-3" aria-hidden />
              <ul className="space-y-3">
                {eventRequests.map((req) => {
                  const [y, m, d] = req.requested_date.split("-").map(Number);
                  const reqDate = new Date(y, m - 1, d);
                  const dateStr = reqDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
                  const custody = custodySchedule ? getCustodyFromRotation(reqDate, custodySchedule) : null;
                  const parentLabel = custody === "user" ? kidsLabelUser : custody === "coparent" ? kidsLabelCoparent : "your parent";
                  const statusDisplay =
                    req.status === "approved"
                      ? { text: "✓ Added to calendar", className: "text-green-600" }
                      : req.status === "declined"
                        ? { text: "Not this time", className: "text-stone-400" }
                        : { text: "Pending...", className: "text-stone-400" };
                  const isPending = req.status === "pending";
                  return (
                    <li key={req.id} className="border-b border-[#E8E4DC] last:border-b-0 pb-3 last:pb-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground">
                            {req.title} — {dateStr}
                          </p>
                          <p className="text-xs text-foreground-secondary mt-0.5">
                            Sent to {parentLabel} · <span className={statusDisplay.className}>{statusDisplay.text}</span>
                          </p>
                        </div>
                        {isPending && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              className="p-1.5 rounded-md hover:bg-[#E8E4DC] text-foreground-secondary hover:text-foreground"
                              aria-label="Edit request"
                              onClick={() =>
                                setEditingRequest({
                                  id: req.id,
                                  title: req.title,
                                  requested_date: req.requested_date,
                                  requested_time: req.requested_time ?? null,
                                  notes: req.notes ?? null,
                                  photo_url: req.photo_url ?? null,
                                })
                              }
                            >
                              ✏️
                            </button>
                            <button
                              type="button"
                              className="p-1.5 rounded-md hover:bg-[#E8E4DC] text-foreground-secondary hover:text-foreground"
                              aria-label="Delete request"
                              onClick={async () => {
                                if (!confirm("Cancel this request?")) return;
                                const res = await fetch(`/api/kids/event-requests/${req.id}`, { method: "DELETE" });
                                if (res.ok) {
                                  setEventRequests((prev) => prev.filter((r) => r.id !== req.id));
                                }
                              }}
                            >
                              🗑️
                            </button>
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <button
            type="button"
            className="fixed bottom-6 right-6 bg-[#7B9E87] text-white rounded-full px-4 py-3 shadow-lg flex items-center gap-2 text-sm hover:bg-[#6A8A78]"
            onClick={() => setOpenRequestWithNoDate(true)}
          >
            + Ask to add something
          </button>
        </>
      )}
    </div>
  );
}
