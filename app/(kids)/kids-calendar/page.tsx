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

function relativeTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sec = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (sec < 60) return "Just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return min === 1 ? "1 min ago" : `${min} mins ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr === 1 ? "1 hour ago" : `${hr} hours ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "Yesterday";
  if (day < 7) return `${day} days ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type NotificationRow = {
  id: string;
  title: string;
  status: string;
  updated_at: string;
};

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
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
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
      const [eventsRes, scheduleRes, caseRes, requestsRes, notificationsRes] = await Promise.all([
        fetch("/api/kids/calendar/events"),
        fetch("/api/kids/custody-schedule"),
        fetch("/api/kids/case-details"),
        fetch("/api/kids/event-requests"),
        fetch("/api/kids/notifications"),
      ]);

      if (eventsRes.status === 401 || scheduleRes.status === 401 || requestsRes.status === 401 || notificationsRes.status === 401) {
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

      const notificationsData = notificationsRes.ok ? await notificationsRes.json().catch(() => []) : [];
      setNotifications(Array.isArray(notificationsData) ? notificationsData : []);
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

  async function markNotificationRead(id: string) {
    const res = await fetch(`/api/kids/notifications/${id}/read`, { method: "PATCH" });
    if (res.ok) {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    }
  }

  return (
    <div className="w-full max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-lg text-[#3D3D3D]">
          Your calendar
        </h1>
        <button
          type="button"
          className="relative p-2 rounded-full hover:bg-[#E8E4DC] text-[#3D3D3D]"
          aria-label={notifications.length > 0 ? `${notifications.length} unread notifications` : "Notifications"}
          onClick={() => setNotificationsOpen((o) => !o)}
        >
          <span aria-hidden>🔔</span>
          {notifications.length > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 min-w-[1.25rem] h-5 px-1 flex items-center justify-center rounded-full bg-[#7B9E87] text-white text-xs font-medium"
              aria-hidden
            >
              {notifications.length > 9 ? "9+" : notifications.length}
            </span>
          )}
        </button>
      </div>

      {notificationsOpen && (
        <div
          className="rounded-2xl border border-[#E8E4DC] bg-[#FDFBF7] shadow-lg overflow-hidden"
          role="dialog"
          aria-label="Notifications"
        >
          <div className="px-4 py-2 border-b border-[#E8E4DC] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Notifications</h2>
            <button
              type="button"
              className="p-1.5 rounded-md hover:bg-[#E8E4DC] text-foreground-secondary"
              aria-label="Close notifications"
              onClick={() => setNotificationsOpen(false)}
            >
              ✕
            </button>
          </div>
          <ul className="max-h-[60vh] overflow-y-auto">
            {notifications.length === 0 ? (
              <li className="px-4 py-4 text-sm text-foreground-secondary">No new notifications</li>
            ) : (
              notifications.map((n) => (
                <li key={n.id} className="border-b border-[#E8E4DC] last:border-b-0">
                  <button
                    type="button"
                    className="w-full text-left px-4 py-3 hover:bg-[#E8E4DC]/50 transition-colors"
                    onClick={() => markNotificationRead(n.id)}
                  >
                    <p className="text-sm text-foreground">
                      {n.status === "approved"
                        ? `🎉 ${kidsLabelUser} added ${n.title} to the calendar!`
                        : `💙 ${kidsLabelUser} said not this time for ${n.title}`}
                    </p>
                    <p className="text-xs text-foreground-secondary mt-1">{relativeTime(n.updated_at)}</p>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}

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
