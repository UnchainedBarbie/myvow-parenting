"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { X } from "lucide-react";
import { AddEventForm, type AddEventFormInitialValues } from "@/components/calendar/add-event-form";

export type EventRequestRow = {
  id: string;
  requested_by_child_id: string | null;
  requested_date: string;
  requested_time: string | null;
  title: string;
  notes: string | null;
  photo_url?: string | null;
  created_at: string;
  child_name?: string | null;
};

type Child = { id: string; first_name: string };

function requestToInitialValues(r: EventRequestRow): AddEventFormInitialValues {
  const date = r.requested_date.slice(0, 10);
  const startTime =
    r.requested_time != null && r.requested_time.trim() !== ""
      ? r.requested_time.trim().slice(0, 5)
      : "09:00";
  return {
    title: r.title,
    date,
    startTime,
    endTime: "",
    description: r.notes ?? "",
    visibility: "just_me_and_kids",
    eventType: "extracurricular",
  };
}

type ExtractedEvent = { title?: string; date?: string; time?: string; notes?: string; category?: string };

function aiToInitialValues(ai: ExtractedEvent): AddEventFormInitialValues {
  const eventType =
    ai.category === "medical" ||
    ai.category === "school" ||
    ai.category === "extracurricular" ||
    ai.category === "other"
      ? ai.category
      : "other";
  return {
    title: ai.title ?? "",
    date: ai.date ?? "",
    startTime: ai.time ?? "09:00",
    endTime: "",
    description: ai.notes ?? "",
    visibility: "just_me_and_kids",
    eventType,
  };
}

function mergeInitialValues(
  kid: AddEventFormInitialValues,
  ai: AddEventFormInitialValues
): AddEventFormInitialValues {
  const merged = { ...ai };
  (Object.keys(kid) as (keyof AddEventFormInitialValues)[]).forEach((k) => {
    const v = kid[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") merged[k] = v;
  });
  return merged;
}

export function EventRequestsCard({
  requests,
  caseId,
  children: childrenList,
}: {
  requests: EventRequestRow[];
  caseId: string;
  children: Child[];
}) {
  const router = useRouter();
  const [actingId, setActingId] = useState<string | null>(null);
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [loadingAddId, setLoadingAddId] = useState<string | null>(null);
  const [expandedPhotoId, setExpandedPhotoId] = useState<string | null>(null);
  const [addModalRequest, setAddModalRequest] = useState<EventRequestRow | null>(null);
  const [addModalInitialValues, setAddModalInitialValues] = useState<AddEventFormInitialValues | null>(null);

  const visible = requests.filter((r) => !removedIds.has(r.id));
  if (visible.length === 0) return null;

  async function handleDecline(id: string) {
    setActingId(id);
    try {
      const res = await fetch(`/api/event-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "declined" }),
      });
      if (res.ok) {
        setRemovedIds((prev) => new Set(prev).add(id));
        setExpandedPhotoId((p) => (p === id ? null : p));
        router.refresh();
      }
    } finally {
      setActingId(null);
    }
  }

  async function handleAddSuccess(requestId: string, eventId: string) {
    const res = await fetch(`/api/event-requests/${requestId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "approved", approved_event_id: eventId }),
    });
    if (res.ok) {
      setRemovedIds((prev) => new Set(prev).add(requestId));
      setAddModalRequest(null);
      setAddModalInitialValues(null);
      router.refresh();
    }
  }

  async function handleStatus(id: string, status: "declined" | "approved") {
    if (status === "declined") {
      handleDecline(id);
      return;
    }
    const r = visible.find((x) => x.id === id);
    if (!r) return;
    if (r.photo_url) {
      setLoadingAddId(id);
      try {
        const res = await fetch("/api/ai/extract-event-from-photo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photo_url: r.photo_url }),
        });
        const data = (await res.json()) as ExtractedEvent | { error?: string };
        const kidValues = requestToInitialValues(r);
        const merged =
          res.ok && !("error" in data && data.error)
            ? mergeInitialValues(kidValues, aiToInitialValues(data as ExtractedEvent))
            : kidValues;
        setAddModalRequest(r);
        setAddModalInitialValues(merged);
      } catch {
        setAddModalRequest(r);
        setAddModalInitialValues(null);
      } finally {
        setLoadingAddId(null);
      }
    } else {
      setAddModalRequest(r);
      setAddModalInitialValues(null);
    }
  }

  return (
    <Card className="shadow-card border-border rounded-card">
      <CardHeader className="pb-2 px-4 pt-4">
        <CardTitle className="font-heading text-lg text-foreground">📬 Requests from your kids</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <ul className="space-y-3">
          {visible.map((r) => {
            const dateLabel = new Date(r.requested_date + "T12:00:00").toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            });
            const timeLabel = r.requested_time
              ? new Date(`2000-01-01T${r.requested_time}`).toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                  hour12: true,
                })
              : null;
            const isActing = actingId === r.id;
            const isReadingPhoto = loadingAddId === r.id;
            return (
              <li
                key={r.id}
                className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border bg-muted/20 p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground-secondary">
                    {r.child_name ? `${r.child_name} wants to add something` : "Event request"}
                  </p>
                  <p className="text-sm text-foreground mt-0.5">
                    <span className="text-foreground-secondary">Event: </span>
                    {r.title}
                  </p>
                  <p className="text-xs text-foreground-secondary mt-0.5">
                    Date: {dateLabel}
                    {timeLabel ? ` at ${timeLabel}` : ""}
                  </p>
                  {r.notes && (
                    <p className="text-xs text-foreground-secondary mt-0.5">
                      Notes: {r.notes}
                    </p>
                  )}
                  {r.photo_url && (
                    <div className="mt-2">
                      <button
                        type="button"
                        className="block rounded-lg border border-border overflow-hidden w-20 h-20 focus:ring-2 focus:ring-[#7B9E87]"
                        onClick={() => setExpandedPhotoId(r.id)}
                      >
                        <img src={r.photo_url} alt="" className="w-full h-full object-cover" />
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-full h-8 text-xs"
                    disabled={isActing}
                    onClick={() => handleStatus(r.id, "declined")}
                  >
                    Decline
                  </Button>
                  <Button
                    size="sm"
                    className="rounded-full h-8 text-xs bg-[#7B9E87] hover:bg-[#6A8A78] text-white"
                    disabled={isActing || isReadingPhoto}
                    onClick={() => handleStatus(r.id, "approved")}
                  >
                    {isReadingPhoto ? "Reading photo... ✨" : isActing ? "…" : "Add to Calendar ✓"}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>

        {expandedPhotoId && (() => {
          const r = visible.find((x) => x.id === expandedPhotoId);
          if (!r?.photo_url) return null;
          return (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
              role="dialog"
              aria-modal="true"
              onClick={() => setExpandedPhotoId(null)}
            >
              <button
                type="button"
                className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white"
                aria-label="Close"
                onClick={() => setExpandedPhotoId(null)}
              >
                <X className="h-5 w-5" />
              </button>
              <img
                src={r.photo_url}
                alt="Request photo"
                className="max-w-full max-h-full object-contain rounded-lg"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          );
        })()}

        {addModalRequest && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-event-from-request-title"
            onClick={() => {
              setAddModalRequest(null);
              setAddModalInitialValues(null);
            }}
          >
            <div
              className="relative w-full max-w-md my-4 rounded-2xl border border-border bg-background shadow-card p-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-3">
                <h2 id="add-event-from-request-title" className="text-lg font-semibold text-foreground">
                  Add to calendar
                </h2>
                <button
                  type="button"
                  className="p-1.5 rounded-md hover:bg-muted text-foreground-secondary"
                  aria-label="Close"
                  onClick={() => {
                    setAddModalRequest(null);
                    setAddModalInitialValues(null);
                  }}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <p className="text-xs text-foreground-secondary mb-3">
                Edit details if you like, then click Add Event. This will add the event and mark the request as approved.
              </p>
              <AddEventForm
                caseId={caseId}
                children={childrenList}
                initialYear={new Date().getFullYear()}
                initialMonth={new Date().getMonth() + 1}
                initialValues={addModalInitialValues ?? requestToInitialValues(addModalRequest)}
                onSuccess={(eventId) => handleAddSuccess(addModalRequest.id, eventId)}
              />
            </div>
          </div>
        )}

        <Button asChild size="sm" variant="outline" className="rounded-full h-8 text-xs mt-3">
          <Link href="/calendar">Open calendar</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
