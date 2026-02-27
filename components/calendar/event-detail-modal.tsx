"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CalendarEventRow } from "@/components/calendar/calendar-month";

type Child = { id: string; first_name: string };

type StatusKey = "scheduled" | "completed" | "no_show" | "conflict" | "canceled";

type HistoryEntry = {
  id: string;
  field_name: string;
  new_value: string | null;
  note: string | null;
  changed_by_name: string | null;
  created_at: string;
};

export interface EventDetailModalProps {
  open: boolean;
  onClose: () => void;
  event: (CalendarEventRow & {
    recurring_rule?: string | null;
  }) | null;
  caseId: string;
  children: Child[];
  onSaved?: () => void;
}

const STATUS_LABELS: Record<StatusKey, string> = {
  scheduled: "Scheduled",
  completed: "Completed",
  no_show: "No-show",
  conflict: "Conflict",
  canceled: "Canceled",
};

const STATUS_KEYS: StatusKey[] = [
  "scheduled",
  "completed",
  "no_show",
  "conflict",
  "canceled",
];

const EVENT_TYPE_LABELS: Record<string, string> = {
  medical: "Medical",
  school: "School",
  extracurricular: "Extracurricular",
  custody_exchange: "Custody exchange",
  therapy: "Therapy",
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

function formatDateTimeRange(startIso: string, endIso: string | null, allDay: boolean) {
  const start = new Date(startIso);
  const end = endIso ? new Date(endIso) : null;

  const dateStr = start.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  if (allDay) {
    return `${dateStr} · All day`;
  }

  const startTime = start.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  if (!end) {
    return `${dateStr} · ${startTime}`;
  }

  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();

  const endTime = end.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  if (sameDay) {
    return `${dateStr} · ${startTime} – ${endTime}`;
  }

  const endDate = end.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  return `${dateStr} · ${startTime} – ${endDate} ${endTime}`;
}

function formatDisplayTimestamp(iso: string) {
  const d = new Date(iso);
  const dateStr = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timeStr = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${dateStr} · ${timeStr}`;
}

export function EventDetailModal({
  open,
  onClose,
  event,
  caseId,
  children,
  onSaved,
}: EventDetailModalProps) {
  const [editMode, setEditMode] = useState(false);
  const [title, setTitle] = useState("");
  const [eventType, setEventType] = useState<string | null>(null);
  const [childId, setChildId] = useState<string>("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [recurringRule, setRecurringRule] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusKey>("scheduled");
  const [statusNote, setStatusNote] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actualExchangeTime, setActualExchangeTime] = useState("");
  const [transportedBy, setTransportedBy] = useState("");
  const [exchangeLocation, setExchangeLocation] = useState("");
  const [childConditionNotes, setChildConditionNotes] = useState("");

  const original = useMemo(() => event, [event]);

  useEffect(() => {
    if (!event) return;

    setEditMode(false);
    setError(null);
    setTitle(event.title);
    setEventType(event.event_type);
    setChildId(event.child_id ?? "");
    setDescription(event.description ?? "");
    setIsPrivate(event.isPrivate);

    const start = new Date(event.start_time);
    const startLocal = new Date(
      start.getTime() - start.getTimezoneOffset() * 60 * 1000
    );
    setDate(startLocal.toISOString().slice(0, 10));
    setStartTime(event.start_time.slice(11, 16));

    if (event.end_time) {
      setEndTime(event.end_time.slice(11, 16));
    } else {
      setEndTime("");
    }

    setRecurringRule(
      (event as any).recurring_rule ? String((event as any).recurring_rule) : null
    );

    const currentStatus = (event.status ?? "") as string;
    if (
      currentStatus === "completed" ||
      currentStatus === "no_show" ||
      currentStatus === "conflict" ||
      currentStatus === "canceled"
    ) {
      setStatus(currentStatus as StatusKey);
    } else {
      setStatus("scheduled");
    }
    setStatusNote("");

    const anyEvent: any = event;
    const actual = anyEvent.actual_exchange_time as string | null | undefined;
    setActualExchangeTime(actual ? actual.slice(11, 16) : "");
    setTransportedBy((anyEvent.transported_by as string | null) ?? "");
    setExchangeLocation((anyEvent.exchange_location as string | null) ?? "");
    setChildConditionNotes(
      (anyEvent.child_condition_notes as string | null) ?? ""
    );
  }, [event]);

  useEffect(() => {
    if (!open || !event) return;

    // Always start in read-only mode when opened, even for the same event.
    setEditMode(false);

    async function loadHistory() {
      try {
        setLoadingHistory(true);
        const res = await fetch(
          `/api/calendar/event/history?event_id=${encodeURIComponent(event.id)}`
        );
        if (!res.ok) {
          setHistory([]);
          return;
        }
        const data = (await res.json()) as HistoryEntry[];
        setHistory(data ?? []);
      } catch {
        setHistory([]);
      } finally {
        setLoadingHistory(false);
      }
    }

    loadHistory();
  }, [open, event]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open || !event) {
    return null;
  }

  const categoryLabel =
    EVENT_TYPE_LABELS[event.event_type ?? ""] ??
    event.event_type ??
    "Event";
  const colorClass =
    EVENT_COLORS[event.event_type ?? ""] ?? "bg-primary";

  const currentDisplayStatus = status;

  function needsNote(key: StatusKey) {
    return key === "no_show" || key === "conflict" || key === "canceled";
  }

  async function saveStatus(next: StatusKey) {
    if (!original) return;
    try {
      setError(null);
      const payload = {
        event_id: original.id,
        case_id: caseId,
        status: next === "scheduled" ? null : next,
        status_note: needsNote(next)
          ? statusNote.trim() || null
          : null,
        deleted: false,
      };
      // Debug: log status update payload
      // eslint-disable-next-line no-console
      console.log("[EventDetailModal] saveStatus payload", payload);
      const res = await fetch("/api/calendar/event/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      // Debug: log full API response
      // eslint-disable-next-line no-console
      console.log("[EventDetailModal] saveStatus response", {
        status: res.status,
        ok: res.ok,
        data,
      });
      if (!res.ok) {
        throw new Error(data.message || "Status update failed");
      }
      setStatus(next);
      if (onSaved) {
        onSaved();
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Status update failed"
      );
    }
  }

  async function handleSave() {
    if (!original) return;
    try {
      setSaving(true);
      setError(null);

      const startTimeValue = startTime || "00:00";
      const endTimeValue = endTime || "";
      const startIso = `${date}T${startTimeValue}:00.000Z`;
      const endIso = endTimeValue ? `${date}T${endTimeValue}:00.000Z` : null;

      const rawPayload: Record<string, unknown> = {
        event_id: original.id,
        // Only send fields that exist on calendar_events
        title: title.trim(),
        description: description.trim() || null,
        event_type: eventType || null,
        child_id: childId || null,
        start_time: startIso,
        end_time: endIso,
        recurring_rule: recurringRule || null,
        actual_exchange_time: actualExchangeTime
          ? `${date}T${actualExchangeTime}:00.000Z`
          : null,
        transported_by: transportedBy.trim() || null,
        exchange_location: exchangeLocation.trim() || null,
        child_condition_notes: childConditionNotes.trim() || null,
      };

      // Strip out undefined values to avoid Supabase errors
      const payload = Object.fromEntries(
        Object.entries(rawPayload).filter(([, value]) => value !== undefined)
      );

      // Debug: log full save payload
      // eslint-disable-next-line no-console
      console.log("[EventDetailModal] handleSave payload", payload);

      const res = await fetch("/api/calendar/event/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      // Debug: log full save response
      // eslint-disable-next-line no-console
      console.log("[EventDetailModal] handleSave response", {
        status: res.status,
        ok: res.ok,
        data,
      });
      if (!res.ok) {
        throw new Error(data.message || "Save failed");
      }

      if (onSaved) {
        onSaved();
      }
      setEditMode(false);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!original) return;
    try {
      setDeletePending(true);
      setError(null);

      const payload = {
        event_id: original.id,
        deleted_at: new Date().toISOString(),
      };
      // Debug: log delete payload
      // eslint-disable-next-line no-console
      console.log("[EventDetailModal] handleDelete payload", payload);

      const res = await fetch("/api/calendar/event/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      // Debug: log delete response
      // eslint-disable-next-line no-console
      console.log("[EventDetailModal] handleDelete response", {
        status: res.status,
        ok: res.ok,
        data,
      });
      if (!res.ok) {
        throw new Error(data.message || "Delete failed");
      }
      if (onSaved) {
        onSaved();
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletePending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4 py-8"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-card border border-border bg-background shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 rounded-full p-1 text-foreground-secondary hover:bg-muted hover:text-foreground"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="border-b border-border px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              {editMode ? (
                <div className="space-y-1">
                  <Label htmlFor="event-title" className="text-xs text-foreground-secondary">
                    Title
                  </Label>
                  <Input
                    id="event-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </div>
              ) : (
                <h2 className="font-heading text-lg text-foreground">
                  {event.title}
                </h2>
              )}
              <div className="flex flex-wrap items-center gap-2 text-xs text-foreground-secondary">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5",
                    "bg-background-secondary"
                  )}
                >
                  <span
                    className={cn("h-2 w-2 rounded-full", colorClass)}
                  />
                  <span>{categoryLabel}</span>
                </span>
                <span className="text-foreground-secondary">
                  {event.child_name || "All children"}
                </span>
              </div>
              <p className="text-xs text-foreground-secondary">
                Created by: {event.created_by_name ?? "Unknown"} —{" "}
                {formatDisplayTimestamp(event.created_at)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setEditMode((prev) => !prev)}
              className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs text-foreground-secondary hover:bg-muted hover:text-foreground"
            >
              <Pencil className="h-3 w-3" />
              <span>{editMode ? "View" : "Edit"}</span>
            </button>
          </div>
        </div>

        <div className="flex flex-col px-5 py-4 space-y-4">
          {error && (
            <p className="text-sm text-alert" role="alert">
              {error}
            </p>
          )}

          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary">
              Details
            </h3>
            <p className="text-sm text-foreground">
              {formatDateTimeRange(
                event.start_time,
                event.end_time,
                event.all_day
              )}
            </p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="detail-date" className="text-xs text-foreground-secondary">
                  Date
                </Label>
                {editMode ? (
                  <Input
                    id="detail-date"
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                ) : (
                  <p className="text-sm text-foreground-secondary">
                    {new Date(event.start_time).toLocaleDateString("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="detail-start-time" className="text-xs text-foreground-secondary">
                    Start time
                  </Label>
                  {editMode ? (
                    <Input
                      id="detail-start-time"
                      type="time"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                    />
                  ) : (
                    <p className="text-sm text-foreground-secondary">
                      {new Date(event.start_time).toLocaleTimeString("en-US", {
                        hour: "numeric",
                        minute: "2-digit",
                        hour12: true,
                      })}
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="detail-end-time" className="text-xs text-foreground-secondary">
                    End time
                  </Label>
                  {editMode ? (
                    <Input
                      id="detail-end-time"
                      type="time"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                    />
                  ) : (
                    <p className="text-sm text-foreground-secondary">
                      {event.end_time
                        ? new Date(event.end_time).toLocaleTimeString("en-US", {
                            hour: "numeric",
                            minute: "2-digit",
                            hour12: true,
                          })
                        : "—"}
                    </p>
                  )}
                </div>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-foreground-secondary">
                Notes for the record
              </Label>
              {editMode ? (
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className={cn(
                    "w-full rounded-card border border-input bg-background px-3 py-2 text-sm",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  )}
                  placeholder="Add calm, factual notes if helpful."
                />
              ) : (
                <p className="text-sm text-foreground">
                  {event.description || "No notes have been added yet."}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled
                className="inline-flex items-center rounded-full border border-border px-3 py-1 text-xs text-foreground-secondary"
              >
                📎 Attach document
              </button>
              <button
                type="button"
                disabled
                className="inline-flex items-center rounded-full border border-border px-3 py-1 text-xs text-foreground-secondary"
              >
                📷 Upload photo
              </button>
              <button
                type="button"
                disabled
                className="inline-flex items-center rounded-full border border-border px-3 py-1 text-xs text-foreground-secondary"
              >
                🔗 Link to message thread
              </button>
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5",
                    event.isPrivate
                      ? "bg-[#F4EDE2] text-[#7B6A4A]"
                      : "bg-[#E3F2E6] text-[#3C6848]"
                  )}
                >
                  {event.isPrivate ? "🔒 Visible only to me" : "Shared event"}
                </span>
                {recurringRule && (
                  <span className="inline-flex items-center rounded-full bg-background-secondary px-2 py-0.5 text-xs text-foreground-secondary">
                    Repeats: {recurringRule}
                  </span>
                )}
              </div>
              {editMode && (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <Label
                      htmlFor="detail-visibility"
                      className="text-xs text-foreground-secondary"
                    >
                      Who can see this?
                    </Label>
                    <label className="inline-flex items-center gap-2 text-foreground-secondary text-xs">
                      <input
                        type="checkbox"
                        checked={isPrivate}
                        onChange={(e) => setIsPrivate(e.target.checked)}
                        className="rounded border-border"
                      />
                      <span>🔒 Visible only to me</span>
                    </label>
                  </div>
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label
                  htmlFor="detail-category"
                  className="text-xs text-foreground-secondary"
                >
                  Category
                </Label>
                {editMode ? (
                  <select
                    id="detail-category"
                    value={eventType ?? ""}
                    onChange={(e) => setEventType(e.target.value || null)}
                    className={cn(
                      "flex h-10 w-full rounded-card border border-input bg-background px-3 py-2 text-sm",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    )}
                  >
                    <option value="">Select category</option>
                    {Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-sm text-foreground-secondary">
                    {categoryLabel}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label
                  htmlFor="detail-child"
                  className="text-xs text-foreground-secondary"
                >
                  Child
                </Label>
                {editMode ? (
                  <select
                    id="detail-child"
                    value={childId}
                    onChange={(e) => setChildId(e.target.value)}
                    className={cn(
                      "flex h-10 w-full rounded-card border border-input bg-background px-3 py-2 text-sm",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    )}
                  >
                    <option value="">All children</option>
                    {children.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.first_name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-sm text-foreground-secondary">
                    {event.child_name || "All children"}
                  </p>
                )}
              </div>
            </div>
          </section>

          <section className="space-y-2 border-t border-border pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary">
              Status
            </h3>
            <div className="flex flex-wrap gap-2 text-xs">
              {STATUS_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => saveStatus(key)}
                  className={cn(
                    "rounded-full px-3 py-1 border",
                    currentDisplayStatus === key
                      ? "bg-[#7B9E87] border-[#7B9E87] text-white"
                      : "border-border bg-background text-foreground-secondary hover:bg-muted hover:text-foreground"
                  )}
                >
                  {STATUS_LABELS[key]}
                </button>
              ))}
            </div>
            {needsNote(currentDisplayStatus) && (
              <div className="space-y-1">
                <p className="text-xs text-foreground-secondary">
                  {currentDisplayStatus === "no_show" &&
                    "Would you like to add a brief note for the record?"}
                  {currentDisplayStatus === "conflict" &&
                    "Would you like to calmly describe what occurred?"}
                  {currentDisplayStatus === "canceled" &&
                    "Reason for cancellation?"}
                </p>
                <textarea
                  value={statusNote}
                  onChange={(e) => setStatusNote(e.target.value)}
                  rows={3}
                  className={cn(
                    "w-full rounded-card border border-input bg-background px-3 py-2 text-sm",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  )}
                  placeholder="Optional"
                />
              </div>
            )}
          </section>

          {event.event_type === "custody_exchange" && (
            <section className="space-y-2 border-t border-border pt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary">
                Custody exchange details
              </h3>
              <div className="grid grid-cols-1 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="actual-exchange-time" className="text-xs text-foreground-secondary">
                    Actual exchange time
                  </Label>
                  {editMode ? (
                    <Input
                      id="actual-exchange-time"
                      type="time"
                      value={actualExchangeTime}
                      onChange={(e) => setActualExchangeTime(e.target.value)}
                    />
                  ) : (
                    <p className="text-sm text-foreground-secondary">
                      {actualExchangeTime
                        ? actualExchangeTime
                        : "Not recorded"}
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="transported-by" className="text-xs text-foreground-secondary">
                    Who transported
                  </Label>
                  {editMode ? (
                    <Input
                      id="transported-by"
                      value={transportedBy}
                      onChange={(e) => setTransportedBy(e.target.value)}
                      placeholder="e.g. Parent A, Parent B, grandparent"
                    />
                  ) : (
                    <p className="text-sm text-foreground-secondary">
                      {transportedBy || "Not recorded"}
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="exchange-location" className="text-xs text-foreground-secondary">
                    Location
                  </Label>
                  {editMode ? (
                    <Input
                      id="exchange-location"
                      value={exchangeLocation}
                      onChange={(e) => setExchangeLocation(e.target.value)}
                      placeholder="e.g. school, home, agreed neutral location"
                    />
                  ) : (
                    <p className="text-sm text-foreground-secondary">
                      {exchangeLocation || "Not recorded"}
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="child-condition" className="text-xs text-foreground-secondary">
                    Child condition notes
                  </Label>
                  {editMode ? (
                    <textarea
                      id="child-condition"
                      value={childConditionNotes}
                      onChange={(e) => setChildConditionNotes(e.target.value)}
                      rows={3}
                      className={cn(
                        "w-full rounded-card border border-input bg-background px-3 py-2 text-sm",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      )}
                      placeholder="Optional — use neutral, factual language."
                    />
                  ) : (
                    <p className="text-sm text-foreground-secondary">
                      {childConditionNotes || "No notes recorded."}
                    </p>
                  )}
                </div>
              </div>
            </section>
          )}

          <section className="space-y-2 border-t border-border pt-4">
            <button
              type="button"
              onClick={() => setHistoryOpen((prev) => !prev)}
              className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wide text-foreground-secondary"
            >
              <span>Event history</span>
              <span className="text-[10px]">
                {historyOpen ? "▾" : "▸"}
              </span>
            </button>
            {historyOpen && (
              <>
                {loadingHistory ? (
                  <p className="text-xs text-foreground-secondary">
                    Loading history…
                  </p>
                ) : history.length === 0 ? (
                  <p className="text-xs text-foreground-secondary">
                    No changes recorded yet.
                  </p>
                ) : (
                  <ul className="space-y-1 text-xs text-foreground-secondary">
                    {history.map((h) => (
                      <li key={h.id}>
                        <p>
                          <span className="font-medium">{h.field_name}</span>{" "}
                          changed to{" "}
                          <span className="font-medium">
                            {h.new_value ?? "—"}
                          </span>{" "}
                          by {h.changed_by_name ?? "Unknown"} —{" "}
                          {formatDisplayTimestamp(h.created_at)}
                        </p>
                        {h.note && (
                          <p className="ml-4 mt-0.5 text-[11px] italic text-foreground-secondary">
                            {h.note}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={handleDelete}
            disabled={deletePending}
            className="text-sm text-[#B55353] hover:underline disabled:opacity-50"
          >
            Delete event
          </button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-full bg-[#7B9E87] text-white hover:bg-[#6A8A78]"
          >
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}

