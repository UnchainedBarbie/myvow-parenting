"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { X } from "lucide-react";

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

export function EventRequestsCard({ requests }: { requests: EventRequestRow[] }) {
  const router = useRouter();
  const [actingId, setActingId] = useState<string | null>(null);
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [expandedPhotoId, setExpandedPhotoId] = useState<string | null>(null);

  const visible = requests.filter((r) => !removedIds.has(r.id));
  if (visible.length === 0) return null;

  async function handleStatus(id: string, status: "approved" | "declined") {
    setActingId(id);
    try {
      const res = await fetch(`/api/event-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
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
                    disabled={isActing}
                    onClick={() => handleStatus(r.id, "approved")}
                  >
                    {isActing ? "…" : "Add to Calendar ✓"}
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

        <Button asChild size="sm" variant="outline" className="rounded-full h-8 text-xs mt-3">
          <Link href="/calendar">Open calendar</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
