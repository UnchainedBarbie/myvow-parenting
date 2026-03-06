"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getCalendarEventColors } from "@/lib/categoryColors";

type KidCalendarEvent = {
  id: string;
  title: string;
  event_type: string | null;
  start_time: string;
  end_time: string | null;
};

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function KidsCalendarPage() {
  const router = useRouter();
  const [events, setEvents] = useState<KidCalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/kids/calendar/events");
        const data = (await res.json().catch(() => ({}))) as {
          events?: KidCalendarEvent[];
          message?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          if (res.status === 401) {
            router.push("/kids/login");
            return;
          }
          setError(data.message ?? "Could not load calendar.");
          return;
        }
        setEvents(data.events ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="w-full max-w-xl space-y-4">
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

      <Card className="border border-[#E8E4DC] bg-white/80 shadow-sm rounded-2xl">
        <div className="px-4 py-3 border-b border-[#E8E4DC]">
          <p className="text-sm font-medium text-[#3D3D3D]">
            Family events
          </p>
          <p className="text-[11px] text-[#6B6B6B]">
            These are events your whole family can see.
          </p>
        </div>
        <div className="px-4 py-3 space-y-2 max-h-[420px] overflow-y-auto">
          {loading ? (
            <p className="text-sm text-foreground-secondary">Loading…</p>
          ) : error ? (
            <p className="text-sm text-alert">{error}</p>
          ) : events.length === 0 ? (
            <p className="text-sm text-foreground-secondary">
              No family events yet.
            </p>
          ) : (
            events.map((event) => {
              const color = getCalendarEventColors(event.event_type);
              return (
                <div
                  key={event.id}
                  className="flex items-center gap-3 rounded-xl border border-[#E8E4DC] bg-[#FDFBF7] px-3 py-2"
                >
                  <div className="flex flex-col items-center justify-center w-16 shrink-0">
                    <span className="text-[11px] font-medium text-[#6B6B6B]">
                      {formatDate(event.start_time)}
                    </span>
                    {formatTime(event.start_time) && (
                      <span className="text-[11px] text-[#8A8A8A]">
                        {formatTime(event.start_time)}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block h-2.5 w-2.5 rounded-full ${color.dot}`}
                      />
                      <p className="truncate text-sm font-semibold text-[#3D3D3D]">
                        {event.title}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Card>
    </div>
  );
}

