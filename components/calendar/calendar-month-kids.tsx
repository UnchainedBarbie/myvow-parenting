"use client";

import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { showSuccessToast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import { getCalendarEventColors } from "@/lib/categoryColors";
import { getCustodyFromRotation } from "@/lib/calendarCustody";
import type { CustodyOverridesMap } from "@/components/calendar/calendar-with-custody";
import { X } from "lucide-react";

const EVENT_TYPE_LABELS: Record<string, string> = {
  medical: "Medical",
  school: "School",
  extracurricular: "Extracurricular",
  custody_exchange: "Custody",
  therapy: "Therapy",
  other: "Other",
};

export type CalendarEventRowKids = {
  id: string;
  title: string;
  event_type: string | null;
  start_time: string;
  end_time: string | null;
};

export type CustodyScheduleForOverlay = {
  schedule_type: string;
  rotation_start_date: string | null;
  user_starts_first: boolean | null;
  manual_pattern?: (string | null)[] | null;
} | null;

interface CalendarMonthKidsProps {
  year: number;
  month: number;
  events: CalendarEventRowKids[];
  custodySchedule: CustodyScheduleForOverlay;
  custodyOverrides?: CustodyOverridesMap;
  kidsLabelUser: string;
  kidsLabelCoparent: string;
  firstDayOfNextBlockKey?: string | null;
  onMonthChange?: (year: number, month: number) => void;
  /** When true, open the request modal with no date pre-filled (kid picks date). Parent should clear after opening. */
  openRequestWithNoDate?: boolean;
  onRequestModalOpened?: () => void;
  /** When set, open the request modal in edit mode with these values. Parent should clear on close via onEditDone. */
  editingRequest?: {
    id: string;
    title: string;
    requested_date: string;
    requested_time?: string | null;
    notes?: string | null;
    photo_url?: string | null;
  } | null;
  onEditDone?: () => void;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function CalendarMonthKids({
  year,
  month,
  events,
  custodySchedule,
  custodyOverrides = {},
  kidsLabelUser,
  kidsLabelCoparent,
  firstDayOfNextBlockKey = null,
  onMonthChange,
  openRequestWithNoDate = false,
  onRequestModalOpened,
  editingRequest = null,
  onEditDone,
}: CalendarMonthKidsProps) {
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [requestDateKey, setRequestDateKey] = useState<string | null>(null);
  const [requestTitle, setRequestTitle] = useState("");
  const [requestTime, setRequestTime] = useState("");
  const [requestNotes, setRequestNotes] = useState("");
  const [requestPhotoUrl, setRequestPhotoUrl] = useState("");
  const [requestPhotoUploading, setRequestPhotoUploading] = useState(false);
  const [requestSending, setRequestSending] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [editingRequestId, setEditingRequestId] = useState<string | null>(null);
  const takePhotoInputRef = useRef<HTMLInputElement>(null);
  const uploadPhotoInputRef = useRef<HTMLInputElement>(null);
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);
  const startPad = first.getDay();
  const daysInMonth = last.getDate();
  const totalCells = startPad + daysInMonth;
  const rows = Math.ceil(totalCells / 7);

  function getCustodyForDateKey(dateKey: string): "user" | "coparent" | null {
    if (!custodySchedule) return null;
    const dateString = /^\d{4}-\d{2}-\d{2}/.test(dateKey) ? dateKey.slice(0, 10) : dateKey;
    const [y, m, d] = dateString.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    if (custodySchedule.schedule_type === "manual") {
      return getCustodyFromRotation(date, custodySchedule);
    }
    if (custodySchedule.schedule_type === "school_year") return null;
    const override = custodyOverrides[dateString];
    if (override === "user") return "user";
    if (override === "coparent") return "coparent";
    if (override === "neither") return null;
    return getCustodyFromRotation(date, custodySchedule);
  }

  const eventsByDay: Record<string, CalendarEventRowKids[]> = {};
  for (const e of events) {
    const d = new Date(e.start_time);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!eventsByDay[key]) eventsByDay[key] = [];
    eventsByDay[key].push(e);
  }

  const monthName = first.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const today = new Date();
  const todayYear = today.getFullYear();
  const todayMonth = today.getMonth() + 1;
  const todayDate = today.getDate();

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

  function goMonth(delta: number) {
    const next = new Date(year, month - 1 + delta, 1);
    onMonthChange?.(next.getFullYear(), next.getMonth() + 1);
  }

  const todayKey = `${todayYear}-${String(todayMonth).padStart(2, "0")}-${String(todayDate).padStart(2, "0")}`;

  useEffect(() => {
    if (openRequestWithNoDate) {
      setRequestDateKey(null);
      setRequestTitle("");
      setRequestTime("");
      setRequestNotes("");
      setRequestPhotoUrl("");
      setRequestError(null);
      setEditingRequestId(null);
      setRequestModalOpen(true);
      onRequestModalOpened?.();
    }
  }, [openRequestWithNoDate, onRequestModalOpened]);

  useEffect(() => {
    if (editingRequest) {
      setRequestDateKey(editingRequest.requested_date);
      setRequestTitle(editingRequest.title);
      setRequestTime(
        editingRequest.requested_time != null && editingRequest.requested_time !== ""
          ? String(editingRequest.requested_time).slice(0, 5)
          : ""
      );
      setRequestNotes(editingRequest.notes ?? "");
      setRequestPhotoUrl(editingRequest.photo_url ?? "");
      setRequestError(null);
      setEditingRequestId(editingRequest.id);
      setRequestModalOpen(true);
    }
  }, [editingRequest]);

  function openRequestModal(key: string) {
    setRequestDateKey(key);
    setRequestTitle("");
    setRequestTime("");
    setRequestNotes("");
    setRequestPhotoUrl("");
    setRequestError(null);
    setRequestModalOpen(true);
  }

  async function handlePhotoFile(file: File) {
    setRequestPhotoUploading(true);
    setRequestError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/kids/event-requests/upload-photo", {
        method: "POST",
        body: form,
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; message?: string };
      if (res.ok && data.url) setRequestPhotoUrl(data.url);
      else setRequestError((data as { message?: string }).message ?? "Photo upload failed");
    } finally {
      setRequestPhotoUploading(false);
    }
  }

  async function submitEventRequest() {
    const dateToUse = requestDateKey?.trim();
    if (!dateToUse || !/^\d{4}-\d{2}-\d{2}$/.test(dateToUse) || !requestTitle.trim()) {
      if (!dateToUse) setRequestError("Please pick a date.");
      return;
    }
    setRequestSending(true);
    setRequestError(null);
    const [y, m, d] = dateToUse.split("-").map(Number);
    const selectedDate = new Date(y, m - 1, d);
    const owner = custodySchedule ? getCustodyFromRotation(selectedDate, custodySchedule) : null;
    const requested_parent: "user" | "coparent" | "either" =
      owner === "user" ? "user" : owner === "coparent" ? "coparent" : "either";
    const body: { requested_date: string; title: string; requested_time?: string; notes?: string; photo_url?: string; requested_parent: "user" | "coparent" | "either" } = {
      requested_date: dateToUse,
      title: requestTitle.trim(),
      requested_parent,
    };
    if (requestTime.trim()) body.requested_time = requestTime.trim();
    if (requestNotes.trim()) body.notes = requestNotes.trim();
    if (requestPhotoUrl.trim()) body.photo_url = requestPhotoUrl.trim();
    try {
      if (editingRequestId) {
        const res = await fetch(`/api/kids/event-requests/${editingRequestId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setRequestError((data as { message?: string }).message ?? "Failed to update request");
          return;
        }
        setRequestModalOpen(false);
        setRequestDateKey(null);
        setRequestPhotoUrl("");
        setEditingRequestId(null);
        onEditDone?.();
        showSuccessToast("Request updated! 💚");
      } else {
        const res = await fetch("/api/kids/event-requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setRequestError((data as { message?: string }).message ?? "Failed to send request");
          return;
        }
        const custody = requestDateKey ? getCustodyForDateKey(requestDateKey) : null;
        const parentLabel =
          custody === "user" ? kidsLabelUser : custody === "coparent" ? kidsLabelCoparent : "your parent";
        setRequestModalOpen(false);
        setRequestDateKey(null);
        setRequestPhotoUrl("");
        showSuccessToast(`Sent! ${parentLabel} will let you know 💚`);
      }
    } finally {
      setRequestSending(false);
    }
  }

  function closeRequestModal() {
    if (!requestSending) {
      const wasEditing = !!editingRequestId;
      setRequestModalOpen(false);
      setEditingRequestId(null);
      if (wasEditing) onEditDone?.();
    }
  }

  const requestModalParentLabel = (() => {
    if (!requestDateKey || !/^\d{4}-\d{2}-\d{2}$/.test(requestDateKey.trim())) return "your parent";
    const [y, m, d] = requestDateKey.trim().split("-").map(Number);
    const selectedDate = new Date(y, m - 1, d);
    const owner = custodySchedule ? getCustodyFromRotation(selectedDate, custodySchedule) : null;
    return owner === "user" ? kidsLabelUser : owner === "coparent" ? kidsLabelCoparent : "your parent";
  })();

  return (
    <Card className="shadow-card">
      <CardHeader className="flex flex-col gap-2 space-y-0 pb-0.5">
        <div className="flex items-center gap-3">
          {onMonthChange && (
            <>
              <button
                type="button"
                onClick={() => goMonth(-1)}
                className="p-1 rounded-md hover:bg-muted"
                aria-label="Previous month"
              >
                ←
              </button>
              <h2 className="text-lg font-semibold">{monthName}</h2>
              <button
                type="button"
                onClick={() => goMonth(1)}
                className="p-1 rounded-md hover:bg-muted"
                aria-label="Next month"
              >
                →
              </button>
            </>
          )}
          {!onMonthChange && <h2 className="text-lg font-semibold">{monthName}</h2>}
        </div>
        <div className="flex gap-4 text-xs text-foreground-secondary">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full bg-green-100 border border-green-200" aria-hidden />
            With {kidsLabelUser}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full bg-stone-200 border border-stone-300" aria-hidden />
            With {kidsLabelCoparent}
          </span>
        </div>
      </CardHeader>
      <CardContent className="pt-0.5">
        <div className="grid grid-cols-7 gap-px rounded-card border border-gray-300 bg-gray-300">
          {DAYS.map((day) => (
            <div
              key={day}
              className="border-r border-b border-gray-300 bg-gray-200/95 px-1 py-1 text-center text-[11px] font-medium text-gray-600"
            >
              {day}
            </div>
          ))}
          {cells.map(({ day, key }, i) => {
            const isToday =
              day != null &&
              year === todayYear &&
              month === todayMonth &&
              day === todayDate;
            const custody = key ? getCustodyForDateKey(key) : null;
            const custodyBg =
              custody === "user"
                ? "bg-green-100"
                : custody === "coparent"
                  ? "bg-stone-200"
                  : "bg-white";
            const isFuture = key ? key > todayKey : false;
            const isFirstDayOfNextBlock = key === firstDayOfNextBlockKey;
            return (
              <div
                key={i}
                className={cn(
                  "min-h-[100px] border-r border-b border-gray-300 p-1.5",
                  !day && "bg-background-secondary/30",
                  day != null && custodyBg,
                  isFuture && "cursor-pointer hover:ring-2 hover:ring-[#7B9E87] hover:ring-inset"
                )}
                onClick={day != null && isFuture && key ? () => openRequestModal(key) : undefined}
                role={isFuture ? "button" : undefined}
                aria-label={isFuture && key ? `Request event on ${key}` : undefined}
              >
                {day != null && (
                  <>
                    <p
                      className={cn(
                        "text-sm font-medium flex items-center gap-1",
                        isToday ? "text-gray-900" : "text-gray-700"
                      )}
                    >
                      {day}
                      {isFirstDayOfNextBlock && (
                        <span className="h-1.5 w-1.5 rounded-full bg-[#7B9E87] ring-2 ring-white shrink-0" aria-hidden />
                      )}
                    </p>
                    <ul className="mt-1 space-y-1">
                      {(eventsByDay[key!] ?? []).map((ev) => {
                        const color = getCalendarEventColors(ev.event_type);
                        const categoryLabel =
                          EVENT_TYPE_LABELS[ev.event_type ?? ""] ??
                          ev.event_type ??
                          "Event";
                        return (
                          <li key={ev.id}>
                            <div
                              className={cn(
                                "w-full text-left rounded-card px-2 py-1 text-xs shadow-sm",
                                "bg-white/80 border border-gray-200/80",
                                color.bg
                              )}
                            >
                              <div className="flex items-center gap-1">
                                <span
                                  className={cn(
                                    "inline-block h-2.5 w-2.5 rounded-full",
                                    color.dot
                                  )}
                                />
                                <span className="truncate font-semibold text-foreground">
                                  {ev.title}
                                </span>
                              </div>
                              <span className="mt-0.5 block truncate text-[10px] text-foreground-secondary/80">
                                {formatTime(ev.start_time)
                                  ? `${formatTime(ev.start_time)} · ${categoryLabel}`
                                  : categoryLabel}
                              </span>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>

      {requestModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="request-event-title"
          onClick={(e) => e.target === e.currentTarget && closeRequestModal()}
        >
          <div className="w-full max-w-sm rounded-2xl border border-[#E8E4DC] bg-[#FDFBF7] p-4 shadow-card max-h-[90vh] overflow-y-auto">
            <h2 id="request-event-title" className="text-lg font-semibold text-foreground">
              Ask {requestModalParentLabel} to add something
            </h2>
            <div className="mt-2 mb-3">
              <Label htmlFor="request-date" className="text-xs font-medium">Date *</Label>
              <Input
                id="request-date"
                type="date"
                value={requestDateKey ?? ""}
                onChange={(e) => setRequestDateKey(e.target.value.slice(0, 10))}
                min={new Date().toISOString().split("T")[0]}
                className="mt-1 h-9 text-sm"
              />
            </div>

            {/* Photo (optional) */}
            <div className="mb-3">
              <p className="text-xs font-medium text-foreground-secondary mb-1.5">📷 Got a flyer? Snap a photo! (optional)</p>
              <div className="flex flex-wrap gap-2 items-center">
                <input
                  ref={takePhotoInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePhotoFile(f); e.target.value = ""; }}
                />
                <input
                  ref={uploadPhotoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePhotoFile(f); e.target.value = ""; }}
                />
                <Button type="button" variant="outline" size="sm" className="rounded-full h-8 text-xs" onClick={() => takePhotoInputRef.current?.click()} disabled={requestPhotoUploading}>
                  Take Photo
                </Button>
                <Button type="button" variant="outline" size="sm" className="rounded-full h-8 text-xs" onClick={() => uploadPhotoInputRef.current?.click()} disabled={requestPhotoUploading}>
                  Upload Image
                </Button>
              </div>
              {requestPhotoUrl && (
                <div className="mt-2 flex items-start gap-2">
                  <img src={requestPhotoUrl} alt="Uploaded" className="max-h-32 w-auto object-cover rounded-lg border border-border" />
                  <button
                    type="button"
                    className="p-1 rounded-full border border-border hover:bg-muted"
                    aria-label="Remove photo"
                    onClick={() => setRequestPhotoUrl("")}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>

            <form
              onSubmit={(e) => { e.preventDefault(); submitEventRequest(); }}
              className="space-y-3"
            >
              <div>
                <Label htmlFor="request-title" className="text-xs font-medium">What? *</Label>
                <Input
                  id="request-title"
                  value={requestTitle}
                  onChange={(e) => setRequestTitle(e.target.value)}
                  placeholder="e.g. Soccer practice"
                  className="mt-1 h-9 text-sm"
                  required
                />
              </div>
              <div>
                <Label htmlFor="request-time" className="text-xs font-medium">What time? (optional)</Label>
                <Input
                  id="request-time"
                  type="time"
                  value={requestTime}
                  onChange={(e) => setRequestTime(e.target.value)}
                  className="mt-1 h-9 text-sm"
                />
              </div>
              <div>
                <Label htmlFor="request-notes" className="text-xs font-medium">Note for {requestModalParentLabel} (optional)</Label>
                <Textarea
                  id="request-notes"
                  value={requestNotes}
                  onChange={(e) => setRequestNotes(e.target.value)}
                  placeholder="Anything else to say?"
                  className="mt-1 min-h-[72px] text-sm resize-y"
                  rows={3}
                />
              </div>
              {requestError && <p className="text-xs text-red-600">{requestError}</p>}
              <div className="flex gap-2 justify-end pt-1">
                <Button type="button" variant="outline" size="sm" className="rounded-full h-9 text-xs" onClick={closeRequestModal} disabled={requestSending}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" className="rounded-full h-9 text-xs bg-[#7B9E87] hover:bg-[#6A8A78] text-white" disabled={requestSending || !requestTitle.trim() || !(requestDateKey ?? "").trim()}>
                  {requestSending ? (editingRequestId ? "Updating…" : "Sending…") : editingRequestId ? "Update Request" : `Send Request to ${requestModalParentLabel} 💌`}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Card>
  );
}
