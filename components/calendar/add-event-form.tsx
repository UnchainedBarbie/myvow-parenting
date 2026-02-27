"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const EVENT_TYPES = [
  { value: "medical", label: "Medical" },
  { value: "school", label: "School" },
  { value: "extracurricular", label: "Extracurricular" },
  { value: "custody_exchange", label: "Custody exchange" },
  { value: "therapy", label: "Therapy" },
  { value: "other", label: "Other" },
] as const;

type Child = { id: string; first_name: string };

interface AddEventFormProps {
  caseId: string;
  children: Child[];
  initialYear: number;
  initialMonth: number;
}

export function AddEventForm({
  caseId,
  children,
  initialYear,
  initialMonth,
}: AddEventFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [eventType, setEventType] = useState<string>("other");
  const [childId, setChildId] = useState<string>("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(() => {
    const d = new Date(initialYear, initialMonth - 1, 1);
    return d.toISOString().slice(0, 10);
  });
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [isPrivate, setIsPrivate] = useState(false);
  const [isRepeating, setIsRepeating] = useState(false);
  const [repeat, setRepeat] = useState<string>("weekly");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError("Please enter a title.");
      return;
    }
    if (!description.trim()) {
      setError("Please enter a description.");
      return;
    }
    const startTimeValue = startTime || "00:00";
    const endTimeValue = endTime || "";
    const start = `${date}T${startTimeValue}:00.000Z`;
    const end = endTimeValue ? `${date}T${endTimeValue}:00.000Z` : null;
    setLoading(true);
    try {
      const res = await fetch("/api/calendar/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          case_id: caseId,
          title: title.trim(),
          description: description.trim() || undefined,
          event_type: eventType,
          child_id: childId || undefined,
          start_time: start,
          end_time: end,
          all_day: false,
          is_private: isPrivate,
          recurring_rule: isRepeating ? repeat : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Create failed");
      setTitle("");
      setDescription("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="font-heading text-lg">Add event</CardTitle>
        <CardDescription>
          Medical, school, extracurricular, custody exchange, therapy, or other.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="text-sm text-alert" role="alert">{error}</p>}
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Pediatrician visit" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="event_type">Category</Label>
            <select
              id="event_type"
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
              className={cn(
                "flex h-10 w-full rounded-card border border-input bg-background px-3 py-2 text-sm ring-offset-background",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              )}
            >
              {EVENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="child">Child</Label>
            <select
              id="child"
              value={childId}
              onChange={(e) => setChildId(e.target.value)}
              className={cn(
                "flex h-10 w-full rounded-card border border-input bg-background px-3 py-2 text-sm ring-offset-background",
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
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Notes"
              required
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="private"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
              className="rounded border-border"
            />
            <Label htmlFor="private" className="font-normal">
              🔒 Visible only to me
            </Label>
          </div>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <Input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                className="w-full"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="start_time">Start time</Label>
                <Input
                  id="start_time"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full min-w-[140px]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end_time">End time</Label>
                <Input
                  id="end_time"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full min-w-[140px]"
                />
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="repeating"
                checked={isRepeating}
                onChange={(e) => setIsRepeating(e.target.checked)}
                className="rounded border-border"
              />
              <Label htmlFor="repeating" className="font-normal">
                Repeating event
              </Label>
            </div>
            {isRepeating && (
              <>
                <Label htmlFor="repeat">Frequency</Label>
                <select
                  id="repeat"
                  value={repeat}
                  onChange={(e) => setRepeat(e.target.value)}
                  className={cn(
                    "flex h-10 w-full rounded-card border border-input bg-background px-3 py-2 text-sm",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  )}
                >
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Every 2 weeks</option>
                  <option value="monthly">Monthly</option>
                </select>
              </>
            )}
          </div>
          <Button type="submit" disabled={loading} className="rounded-full">
            {loading ? "Adding…" : "Add event"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
