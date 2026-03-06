"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import type { CalendarEventRow } from "@/components/calendar/calendar-month";
import {
  buildUtcIsoFromLocal,
  formatLocalDate,
  formatLocalDateTime,
  formatLocalDateTimeRange,
  formatLocalTime,
  formatTimeForDisplay,
  getLocalDateInputFromUtc,
  getLocalTimeInputFromUtc,
  parseTimeInput,
} from "@/lib/time";
import { getCalendarEventColors } from "@/lib/categoryColors";

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

const STATUS_PILL_SELECTED: Record<StatusKey, string> = {
  scheduled: "bg-blue-100 text-blue-800 border-blue-300",
  completed: "bg-emerald-200 text-emerald-900 border-emerald-300",
  no_show: "bg-amber-200 text-amber-900 border-amber-300",
  conflict: "bg-red-200 text-red-900 border-red-300",
  canceled: "bg-gray-200 text-gray-800 border-gray-300",
};

const STATUS_PILL_UNSELECTED =
  "bg-white text-gray-600 border-gray-300";

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
  const [visibility, setVisibility] = useState<
    "family" | "parents_only" | "private"
  >("family");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [startTimeDisplay, setStartTimeDisplay] = useState("");
  const [endTimeDisplay, setEndTimeDisplay] = useState("");
  const [startTimeError, setStartTimeError] = useState<string | null>(null);
  const [endTimeError, setEndTimeError] = useState<string | null>(null);
  const [recurringRule, setRecurringRule] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusKey>("scheduled");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const deleteDialogRef = useRef<HTMLDivElement>(null);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveWarning, setSaveWarning] = useState<string | null>(null);
  const [actualExchangeTime, setActualExchangeTime] = useState("");
  const [transportedBy, setTransportedBy] = useState("");
  const [exchangeLocation, setExchangeLocation] = useState("");
  const [childConditionNotes, setChildConditionNotes] = useState("");

  const original = useMemo(() => event, [event]);

  function resetFromOriginal() {
    if (!original) return;
    setTitle(original.title);
    setEventType(original.event_type);
    setChildId(original.child_id ?? "");
    setDescription(original.description ?? "");
    const initialVisibility =
      (original.visibility as "family" | "parents_only" | "private" | null | undefined) ??
      (original.isPrivate ? "private" : "family");
    setVisibility(initialVisibility);

    setDate(getLocalDateInputFromUtc(original.start_time));
    const startHhmm = getLocalTimeInputFromUtc(original.start_time);
    const endHhmm = getLocalTimeInputFromUtc(original.end_time);
    setStartTime(startHhmm);
    setEndTime(endHhmm);
    setStartTimeDisplay(formatTimeForDisplay(startHhmm));
    setEndTimeDisplay(endHhmm ? formatTimeForDisplay(endHhmm) : "");
    setStartTimeError(null);
    setEndTimeError(null);

    setRecurringRule(
      (original as any).recurring_rule ? String((original as any).recurring_rule) : null
    );

    const currentStatus = (original.status ?? "") as string;
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

    const anyOriginal: any = original;
    const actual = anyOriginal.actual_exchange_time as string | null | undefined;
    setActualExchangeTime(getLocalTimeInputFromUtc(actual));
    setTransportedBy((anyOriginal.transported_by as string | null) ?? "");
    setExchangeLocation((anyOriginal.exchange_location as string | null) ?? "");
    setChildConditionNotes(
      (anyOriginal.child_condition_notes as string | null) ?? ""
    );
  }

  useEffect(() => {
    if (!event) return;

    setEditMode(false);
    setError(null);
    setSaveWarning(null);
    resetFromOriginal();
  }, [event]);

  useEffect(() => {
    if (!open || !event) return;

    // Always start in read-only mode when opened, even for the same event.
    setEditMode(false);

    async function loadHistory() {
      try {
        setLoadingHistory(true);
        const res = await fetch(
          `/api/calendar/event/history?event_id=${encodeURIComponent(event?.id ?? "")}`
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

  const isDirty = useMemo(() => {
    if (!original) return false;

    const originalVisibility =
      (original.visibility as "family" | "parents_only" | "private" | null | undefined) ??
      (original.isPrivate ? "private" : "family");
    const originalStatusRaw = (original.status ?? "") as string;
    const originalStatusKey: StatusKey =
      originalStatusRaw === "completed" ||
      originalStatusRaw === "no_show" ||
      originalStatusRaw === "conflict" ||
      originalStatusRaw === "canceled"
        ? (originalStatusRaw as StatusKey)
        : "scheduled";

    const origDate = getLocalDateInputFromUtc(original.start_time);
    const origStartTime = getLocalTimeInputFromUtc(original.start_time);
    const origEndTime = getLocalTimeInputFromUtc(original.end_time);

    const anyOriginal: any = original;
    const origActual = getLocalTimeInputFromUtc(
      anyOriginal.actual_exchange_time as string | null | undefined
    );
    const origTransportedBy =
      (anyOriginal.transported_by as string | null) ?? "";
    const origExchangeLocation =
      (anyOriginal.exchange_location as string | null) ?? "";
    const origChildCondition =
      (anyOriginal.child_condition_notes as string | null) ?? "";

    const origEventType = original.event_type ?? null;
    const origChildId = original.child_id ?? "";
    const origTitle = original.title ?? "";
    const origDescription = original.description ?? "";

    if (title !== origTitle) return true;
    if ((description ?? "") !== (origDescription ?? "")) return true;
    if (visibility !== originalVisibility) return true;
    if (status !== originalStatusKey) return true;
    if (date !== origDate) return true;
    if (startTime !== origStartTime) return true;
    if (endTime !== origEndTime) return true;
    if ((eventType ?? null) !== origEventType) return true;
    if (childId !== origChildId) return true;
    if (actualExchangeTime !== origActual) return true;
    if (transportedBy !== origTransportedBy) return true;
    if (exchangeLocation !== origExchangeLocation) return true;
    if (childConditionNotes !== origChildCondition) return true;

    return false;
  }, [
    original,
    title,
    description,
    visibility,
    status,
    date,
    startTime,
    endTime,
    eventType,
    childId,
    actualExchangeTime,
    transportedBy,
    exchangeLocation,
    childConditionNotes,
  ]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        if (editMode && isDirty) {
          setDiscardConfirmOpen(true);
          return;
        }
        setEditMode(false);
        resetFromOriginal();
        setError(null);
        onClose();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose, editMode, isDirty]);

  useEffect(() => {
    if (!deleteConfirmOpen) return;
    const el = deleteCancelRef.current;
    el?.focus();
  }, [deleteConfirmOpen]);

  useEffect(() => {
    if (!deleteConfirmOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        closeDeleteConfirm();
        e.preventDefault();
      }
      if (e.key !== "Tab" || !deleteDialogRef.current) return;
      const root = deleteDialogRef.current;
      const focusable = root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          last?.focus();
          e.preventDefault();
        }
      } else {
        if (document.activeElement === last) {
          first?.focus();
          e.preventDefault();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [deleteConfirmOpen, deletePending]);

  // Do not place hooks below this return. All hooks must run unconditionally.
  if (!open || !event) {
    return null;
  }

  const categoryLabel =
    EVENT_TYPE_LABELS[event.event_type ?? ""] ??
    event.event_type ??
    "Event";
  const colorClass = getCalendarEventColors(event.event_type).dot;

  const currentDisplayStatus = status;

  function visibilityLabel(value: "family" | "parents_only" | "private") {
    if (value === "parents_only") return "👩‍⚖️ Parents only";
    if (value === "private") return "🔒 Visible only to me";
    return "👨‍👩‍👧 Family";
  }

  function visibilityHelper(value: "family" | "parents_only" | "private") {
    if (value === "parents_only") return "Kids won't see this.";
    if (value === "private") return "Only you can see this.";
    return "Kids can view this.";
  }

  function needsNote(key: StatusKey) {
    return key === "no_show" || key === "conflict";
  }

  function historyActionLabel(fieldName: string) {
    switch (fieldName) {
      case "created":
        return "Event created";
      case "title":
        return "Title updated";
      case "description":
        return "Notes updated";
      case "status":
        return "Status changed";
      case "visibility":
        return "Visibility changed";
      case "event_type":
        return "Category updated";
      case "child_id":
        return "Child updated";
      case "start_time":
      case "end_time":
        return "Time updated";
      case "actual_exchange_time":
        return "Actual exchange time updated";
      case "transported_by":
        return "Transport details updated";
      case "exchange_location":
        return "Exchange location updated";
      case "child_condition_notes":
        return "Child condition notes updated";
      default:
        return "Field updated";
    }
  }

  async function saveStatus(next: StatusKey) {
    // Only allow changing status while editing; actual save happens in handleSave.
    if (!original || !editMode) return;
    setStatus(next);
  }

  async function handleSave() {
    if (!original) return;
    try {
      setSaving(true);
      setError(null);

      // Validate and normalize time inputs (in case user saved without blurring)
      const parsedStart = parseTimeInput(startTimeDisplay.trim());
      if (!parsedStart) {
        setStartTimeError("Enter a valid time (e.g. 8:00 PM or 20:00)");
        setSaving(false);
        return;
      }
      setStartTimeError(null);
      setStartTime(parsedStart);
      setStartTimeDisplay(formatTimeForDisplay(parsedStart));

      const endTrimmed = endTimeDisplay.trim();
      let normalizedEndHhmm: string = "";
      if (endTrimmed) {
        const parsedEnd = parseTimeInput(endTrimmed);
        if (!parsedEnd) {
          setEndTimeError("Enter a valid time (e.g. 8:00 PM or 20:00)");
          setSaving(false);
          return;
        }
        setEndTimeError(null);
        setEndTime(parsedEnd);
        setEndTimeDisplay(formatTimeForDisplay(parsedEnd));
        normalizedEndHhmm = parsedEnd;
      } else {
        setEndTimeError(null);
        setEndTime("");
        setEndTimeDisplay("");
      }

      // Build history entries based on actual changes
      const historyEntries: {
        field_changed: string;
        old_value?: string | null;
        new_value?: string | null;
        note?: string | null;
      }[] = [];

      // Original values for comparison
      const originalTitle = original.title ?? "";
      const originalDescription = original.description ?? "";
      const originalVisibility =
        (original.visibility as "family" | "parents_only" | "private" | null | undefined) ??
        (original.isPrivate ? "private" : "family");
      const originalStatusRaw = (original.status ?? "") as string;
      const originalStatusKey: StatusKey =
        originalStatusRaw === "completed" ||
        originalStatusRaw === "no_show" ||
        originalStatusRaw === "conflict" ||
        originalStatusRaw === "canceled"
          ? (originalStatusRaw as StatusKey)
          : "scheduled";
      const newStatusKey: StatusKey = status;

      const originalEventType = original.event_type ?? null;
      const originalChildId = original.child_id ?? "";
      const originalStart = original.start_time;
      const originalEnd = original.end_time ?? null;

      // Use normalized parsed times for payload (state may not have updated yet)
      const startHhmm = parsedStart;
      const startIso = buildUtcIsoFromLocal(date, startHhmm);
      const endIso =
        normalizedEndHhmm.length > 0
          ? buildUtcIsoFromLocal(date, normalizedEndHhmm)
          : null;
      const newDescription = description.trim();

      // Status change
      if (originalStatusKey !== newStatusKey) {
        const fromLabel = STATUS_LABELS[originalStatusKey];
        const toLabel = STATUS_LABELS[newStatusKey];
        historyEntries.push({
          field_changed: "status",
          old_value: originalStatusKey,
          new_value: `Status changed from ${fromLabel} to ${toLabel}`,
        });
      }

      // Notes for record change
      if (originalDescription.trim() !== newDescription) {
        historyEntries.push({
          field_changed: "description",
          old_value: null,
          new_value: "Note updated",
        });
      }

      // Visibility change
      if (originalVisibility !== visibility) {
        historyEntries.push({
          field_changed: "visibility",
          old_value: originalVisibility,
          new_value: `Visibility changed to ${visibilityLabel(visibility)}`,
        });
      }

      // Date/time change
      if (startIso !== originalStart || endIso !== originalEnd) {
        historyEntries.push({
          field_changed: "time",
          old_value: null,
          new_value: "Event time updated",
        });
      }

      // Category or child change
      if (originalEventType !== eventType || originalChildId !== childId) {
        historyEntries.push({
          field_changed: "details",
          old_value: null,
          new_value: "Event details updated",
        });
      }

      const rawPayload: Record<string, unknown> = {
        event_id: original.id,
        // Only send fields that exist on calendar_events
        title: title.trim(),
        description: newDescription || null,
        event_type: eventType || null,
        child_id: childId || null,
        visibility,
        status: newStatusKey === "scheduled" ? null : newStatusKey,
        start_time: startIso,
        end_time: endIso,
        recurring_rule: recurringRule || null,
        actual_exchange_time: actualExchangeTime
          ? buildUtcIsoFromLocal(date, actualExchangeTime)
          : null,
        transported_by: transportedBy.trim() || null,
        exchange_location: exchangeLocation.trim() || null,
        child_condition_notes: childConditionNotes.trim() || null,
        history: historyEntries.length > 0 ? historyEntries : undefined,
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
        const apiMessage =
          (data as { error?: string; message?: string }).error ??
          (data as { error?: string; message?: string }).message ??
          "Save failed";
        throw new Error(apiMessage);
      }

      const warning = (data as { warning?: string }).warning ?? null;
      if (warning) {
        setError(null);
        setSaveWarning(warning);
      }
      if (onSaved) {
        onSaved();
      }
      setEditMode(false);
      if (!warning) {
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function handleCancelEdit() {
    if (!editMode) return;
    if (isDirty) {
      setDiscardConfirmOpen(true);
      return;
    }
    resetFromOriginal();
    setEditMode(false);
    setError(null);
  }

  function openDeleteConfirm() {
    setDeleteError(null);
    setDeleteConfirmOpen(true);
  }

  function closeDeleteConfirm() {
    if (deletePending) return;
    setDeleteConfirmOpen(false);
    setDeleteError(null);
  }

  async function performDelete() {
    if (!original) return;
    setDeletePending(true);
    setDeleteError(null);
    try {
      const payload = {
        event_id: original.id,
        deleted_at: new Date().toISOString(),
      };
      const res = await fetch("/api/calendar/event/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error((data as { error?: string }).error ?? (data as { message?: string }).message ?? "Delete failed");
      }
      setDeleteConfirmOpen(false);
      setDeleteError(null);
      if (onSaved) onSaved();
      onClose();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletePending(false);
    }
  }

  function doClose() {
    setEditMode(false);
    resetFromOriginal();
    setError(null);
    setSaveWarning(null);
    onClose();
  }

  function handleCloseRequest() {
    if (editMode && isDirty) {
      setDiscardConfirmOpen(true);
      return;
    }
    doClose();
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4 py-8"
      onClick={handleCloseRequest}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-card border border-border bg-background shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 border-b border-border bg-background px-5 py-4">
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
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] border opacity-90",
                    STATUS_PILL_SELECTED[currentDisplayStatus]
                  )}
                >
                  {STATUS_LABELS[currentDisplayStatus]}
                </span>
              </div>
              <p className="text-[11px] text-foreground-secondary/80">
                Created by: {event.created_by_name ?? "Unknown"} —{" "}
                {formatLocalDateTime(event.created_at)}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {!editMode && (
                <button
                  type="button"
                  onClick={() => setEditMode(true)}
                  className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs text-foreground-secondary hover:bg-muted hover:text-foreground"
                >
                  <Pencil className="h-3 w-3" />
                  <span>Edit</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleCloseRequest}
                className="rounded-full p-2 text-foreground-secondary hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-col px-5 py-4 space-y-4">
          {error && (
            <p className="text-sm text-alert" role="alert">
              Save failed.{error !== "Save failed" ? ` ${error}` : ""}
            </p>
          )}
          {saveWarning && !error && (
            <p className="text-sm text-foreground-secondary" role="status">
              {saveWarning}
            </p>
          )}

          <section className="space-y-1">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary/80">
              Details
            </h3>
            <p className="text-sm text-foreground">
              {formatLocalDateTimeRange(
                event.start_time,
                event.end_time,
                event.all_day
              )}
            </p>
          </section>

          <div className="grid gap-4 md:grid-cols-2 items-start">
            {/* Left column: structured controls */}
            <div className="space-y-4">
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary/80">
                  Date & time
                </h3>
                <div className="grid grid-cols-1 gap-3">
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
                        {formatLocalDate(event.start_time)}
                      </p>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label
                        htmlFor="detail-start-time"
                        className="text-xs text-foreground-secondary"
                      >
                        Start time
                      </Label>
                      {editMode ? (
                        <div className="space-y-0.5">
                          <Input
                            id="detail-start-time"
                            type="text"
                            value={startTimeDisplay}
                            onChange={(e) => {
                              setStartTimeDisplay(e.target.value);
                              setStartTimeError(null);
                            }}
                            onBlur={() => {
                              const parsed = parseTimeInput(startTimeDisplay);
                              if (parsed) {
                                setStartTime(parsed);
                                setStartTimeDisplay(formatTimeForDisplay(parsed));
                                setStartTimeError(null);
                              } else if (startTimeDisplay.trim()) {
                                setStartTimeError("Enter a valid time (e.g. 8:00 PM or 20:00)");
                              } else {
                                setStartTimeError(null);
                              }
                            }}
                            placeholder="e.g. 8:00 PM or 20:00"
                            className={cn(
                              startTimeError && "border-alert"
                            )}
                            aria-label="Start time"
                            aria-invalid={!!startTimeError}
                          />
                          {startTimeError && (
                            <p className="text-xs text-alert">{startTimeError}</p>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-foreground-secondary">
                          {formatLocalTime(event.start_time)}
                        </p>
                      )}
                    </div>
                    <div className="space-y-1">
                      <Label
                        htmlFor="detail-end-time"
                        className="text-xs text-foreground-secondary"
                      >
                        End time
                      </Label>
                      {editMode ? (
                        <div className="space-y-0.5">
                          <Input
                            id="detail-end-time"
                            type="text"
                            value={endTimeDisplay}
                            onChange={(e) => {
                              setEndTimeDisplay(e.target.value);
                              setEndTimeError(null);
                            }}
                            onBlur={() => {
                              const trimmed = endTimeDisplay.trim();
                              if (!trimmed) {
                                setEndTime("");
                                setEndTimeDisplay("");
                                setEndTimeError(null);
                                return;
                              }
                              const parsed = parseTimeInput(trimmed);
                              if (parsed) {
                                setEndTime(parsed);
                                setEndTimeDisplay(formatTimeForDisplay(parsed));
                                setEndTimeError(null);
                              } else {
                                setEndTimeError("Enter a valid time (e.g. 8:00 PM or 20:00)");
                              }
                            }}
                            placeholder="Optional — e.g. 8:00 PM or leave blank"
                            className={cn(
                              endTimeError && "border-alert"
                            )}
                            aria-label="End time"
                            aria-invalid={!!endTimeError}
                          />
                          {endTimeError && (
                            <p className="text-xs text-alert">{endTimeError}</p>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-foreground-secondary">
                          {formatLocalTime(event.end_time)}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </section>

              <section className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary/80">
                  Visibility
                </Label>
                {!editMode && (
                  <div className="flex flex-col gap-1 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5",
                          visibility === "private"
                            ? "bg-[#F4EDE2] text-[#7B6A4A]"
                            : "bg-[#E3F2E6] text-[#3C6848]"
                        )}
                      >
                        {visibilityLabel(visibility)}
                      </span>
                      {recurringRule && (
                        <span className="inline-flex items-center rounded-full bg-background-secondary px-2 py-0.5 text-xs text-foreground-secondary">
                          Repeats: {recurringRule}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-foreground-secondary/75">
                      {visibilityHelper(visibility)}
                    </p>
                  </div>
                )}
                {editMode && (
                  <div className="space-y-1">
                    <select
                      id="detail-visibility"
                      value={visibility}
                      onChange={(e) =>
                        setVisibility(
                          e.target.value as "family" | "parents_only" | "private"
                        )
                      }
                      className={cn(
                        "flex h-9 w-full rounded-card border border-input bg-background px-3 py-1.5 text-xs",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      )}
                    >
                      <option value="family">👨‍👩‍👧 Family</option>
                      <option value="parents_only">👩‍⚖️ Parents only</option>
                      <option value="private">🔒 Visible only to me</option>
                    </select>
                    <p className="text-[11px] text-foreground-secondary/75">
                      {visibilityHelper(visibility)}
                    </p>
                  </div>
                )}
              </section>

              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary/80">
                  Classification
                </h3>
                <div className="grid grid-cols-1 gap-3">
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
                        {Object.entries(EVENT_TYPE_LABELS).map(
                          ([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          )
                        )}
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

            </div>

            {/* Right column: notes + attachments */}
            <div className="space-y-3">
              <section className="space-y-1">
                <Label className="text-xs text-foreground-secondary">
                  Notes for the record
                </Label>
                {editMode ? (
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={6}
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
              </section>

              <section className="space-y-1">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled
                    className="inline-flex items-center rounded-full border border-border/60 px-3 py-1 text-xs text-foreground-secondary/80"
                  >
                    📎 Attach document
                  </button>
                  <button
                    type="button"
                    disabled
                    className="inline-flex items-center rounded-full border border-border/60 px-3 py-1 text-xs text-foreground-secondary/80"
                  >
                    📷 Upload photo
                  </button>
                  <button
                    type="button"
                    disabled
                    className="inline-flex items-center rounded-full border border-border/60 px-3 py-1 text-xs text-foreground-secondary/80"
                  >
                    🔗 Link to message thread
                  </button>
                </div>
              </section>
            </div>
          </div>

          {editMode && (
            <section className="space-y-2 border-t border-border pt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary/80">
                Status
              </h3>
              <div className="flex w-full gap-2">
                {STATUS_KEYS.map((key) => {
                  const isSelected = currentDisplayStatus === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => saveStatus(key)}
                      className={cn(
                        "flex-1 whitespace-nowrap px-3 py-2 text-sm rounded-md border text-center flex items-center justify-center",
                        isSelected ? STATUS_PILL_SELECTED[key] : STATUS_PILL_UNSELECTED
                      )}
                    >
                      {STATUS_LABELS[key]}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {event.event_type === "custody_exchange" && (
            <section className="space-y-2 border-t border-border pt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary/80">
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
              className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wide text-foreground-secondary/80"
            >
              <span>Event history</span>
              <span className="text-[10px]">
                {historyOpen ? "▾" : "▸"}
              </span>
            </button>
            {historyOpen && (
              <div className="rounded-card border border-border/60 bg-background-secondary/40 px-3 py-2">
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
                          <span>
                            {h.new_value ?? historyActionLabel(h.field_name)}
                          </span>
                          <span className="ml-1">
                            · By {h.changed_by_name ?? "Unknown"} —{" "}
                            {formatLocalDate(h.created_at)} —{" "}
                            {formatLocalTime(h.created_at)}
                          </span>
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
              </div>
            )}
          </section>
        </div>

        <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 border-t border-border bg-background px-5 pt-4 pb-3">
          <button
            type="button"
            onClick={openDeleteConfirm}
            disabled={deletePending}
            className="text-sm text-[#B55353] hover:underline disabled:opacity-50"
          >
            Delete event
          </button>
          {saveWarning ? (
            <Button
              type="button"
              onClick={doClose}
              className="rounded-full bg-[#7B9E87] text-white hover:bg-[#6A8A78]"
            >
              Close
            </Button>
          ) : (
            editMode && (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="text-sm text-foreground-secondary hover:underline"
                >
                  Cancel
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
            )
          )}
        </div>
      </div>

      <ConfirmModal
        open={discardConfirmOpen}
        title="Discard changes?"
        description="This cannot be undone."
        confirmLabel="Discard"
        confirmTone="danger"
        onCancel={() => setDiscardConfirmOpen(false)}
        onConfirm={() => {
          setDiscardConfirmOpen(false);
          resetFromOriginal();
          setEditMode(false);
          setError(null);
          onClose();
        }}
      />

      {deleteConfirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-dialog-title"
          aria-describedby="delete-dialog-desc"
        >
          <div
            ref={deleteDialogRef}
            className="w-full max-w-sm rounded-card border border-border bg-background shadow-card p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="delete-dialog-title"
              className="font-heading text-lg font-semibold text-foreground"
            >
              Delete event?
            </h2>
            <p
              id="delete-dialog-desc"
              className="mt-2 text-sm text-foreground-secondary"
            >
              This will remove it from the shared calendar. This can't be undone.
            </p>
            {deleteError && (
              <p className="mt-3 text-sm text-alert" role="alert">
                {deleteError}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-3">
              <button
                ref={deleteCancelRef}
                type="button"
                onClick={closeDeleteConfirm}
                disabled={deletePending}
                className="rounded-full border border-border bg-background px-4 py-2 text-sm text-foreground-secondary hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => performDelete()}
                disabled={deletePending}
                className="rounded-full bg-[#B55353] px-4 py-2 text-sm text-white hover:bg-[#9E4545] disabled:opacity-50"
              >
                {deletePending ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

