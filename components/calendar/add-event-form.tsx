"use client";

import { useState, useRef } from "react";
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
  const [visibility, setVisibility] = useState<
    "family" | "family_read_only" | "parents_only" | "private"
  >("family");
  const [isRepeating, setIsRepeating] = useState(false);
  const [repeat, setRepeat] = useState<string>("weekly");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [kidTitle, setKidTitle] = useState("");
  const [autoParentsOnlyHint, setAutoParentsOnlyHint] = useState(false);
  const [visibilityTouched, setVisibilityTouched] = useState(false);
  const [sourceMessageId, setSourceMessageId] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  function timeToHHmm(s: string | null): string {
    if (!s || !s.trim()) return "09:00";
    const t = s.trim();
    const match = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (match) {
      let h = parseInt(match[1], 10);
      const m = parseInt(match[2] || "0", 10);
      if (match[3]?.toLowerCase() === "pm" && h < 12) h += 12;
      if (match[3]?.toLowerCase() === "am" && h === 12) h = 0;
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }
    if (/^\d{1,2}:\d{2}$/.test(t)) return t.length === 4 ? `0${t}` : t;
    return "09:00";
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !file.type.startsWith("image/")) return;
    setPhotoUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("case_id", caseId);
      const res = await fetch("/api/calendar/inbox/photo", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      const d = data.draft ?? {};
      if (d.title) setTitle(d.title);
      if (d.date) setDate(d.date.slice(0, 10));
      if (d.start_time) setStartTime(timeToHHmm(d.start_time));
      if (d.end_time) setEndTime(timeToHHmm(d.end_time));
      setDescription(d.notes ?? (d.title ? "From photo" : ""));
      if (d.category && EVENT_TYPES.some((t) => t.value === d.category)) setEventType(d.category);
      if (d.child_name && children.length) {
        const child = children.find((c) => c.first_name.toLowerCase() === String(d.child_name).toLowerCase());
        if (child) setChildId(child.id);
      }
      setSourceMessageId(data.message_id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setPhotoUploading(false);
    }
  }

  function getDefaultVisibilityForType(
    type: string
  ): "family" | "parents_only" | "private" {
    if (type === "therapy") return "parents_only";
    if (
      type === "school" ||
      type === "extracurricular" ||
      type === "custody_exchange" ||
      type === "medical"
    ) {
      return "family";
    }
    return "family";
  }

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
          visibility,
          is_private: visibility === "private",
          recurring_rule: isRepeating ? repeat : undefined,
          kid_title: kidTitle.trim() || undefined,
          ...(sourceMessageId && { source: "photo", source_message_id: sourceMessageId }),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Create failed");
      setTitle("");
      setDescription("");
      setKidTitle("");
      setSourceMessageId(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="shadow-card">
      <CardHeader className="pb-2">
        <CardTitle className="font-heading text-sm md:text-base">Add event</CardTitle>
        <CardDescription className="text-[11px] md:text-xs">
          Medical, school, extracurricular, custody exchange, therapy, or other.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-2">
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handlePhotoUpload}
          />
          {error && (
            <p className="text-xs text-alert" role="alert">
              {error}
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={photoUploading}
              onClick={() => photoInputRef.current?.click()}
              className="text-xs"
            >
              {photoUploading ? "Extracting…" : "Add event via photo"}
            </Button>
            {sourceMessageId && (
              <span className="text-[11px] text-foreground-secondary">Draft from photo — edit and save</span>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="title" className="text-xs">
              Title
            </Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => {
                const next = e.target.value;
                setTitle(next);
              }}
              placeholder="e.g. Pediatrician visit"
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="event_type" className="text-xs">
              Category
            </Label>
            <select
              id="event_type"
              value={eventType}
              onChange={(e) => {
                const next = e.target.value;
                setEventType(next);
                if (!visibilityTouched) {
                  const v = getDefaultVisibilityForType(next);
                  setVisibility(v);
                  setAutoParentsOnlyHint(v === "parents_only");
                }
              }}
              className={cn(
                "flex h-8 w-full rounded-card border border-input bg-background px-2 py-1 text-xs ring-offset-background",
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
          <div className="space-y-1">
            <Label htmlFor="child" className="text-xs">
              Child
            </Label>
            <select
              id="child"
              value={childId}
              onChange={(e) => setChildId(e.target.value)}
              className={cn(
                "flex h-8 w-full rounded-card border border-input bg-background px-2 py-1 text-xs ring-offset-background",
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
          <div className="space-y-1">
            <Label htmlFor="description" className="text-xs">
              Description
            </Label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => {
                const next = e.target.value;
                setDescription(next);
              }}
              placeholder="Notes"
              required
              rows={4}
              className={cn(
                "flex w-full rounded-card border border-input bg-background px-3 py-2 text-sm ring-offset-background",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                "min-h-[80px] resize-y"
              )}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="visibility" className="text-xs">
              Who can see this?
            </Label>
            <select
              id="visibility"
              value={visibility}
              onChange={(e) => {
                const value = e.target.value as
                  | "family"
                  | "family_read_only"
                  | "parents_only"
                  | "private";
                setVisibility(value);
                setVisibilityTouched(true);
                setAutoParentsOnlyHint(value === "parents_only");
              }}
              className={cn(
                "flex h-8 w-full rounded-card border border-input bg-background px-2 py-1 text-xs ring-offset-background",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              )}
            >
              <option value="family">👨‍👩‍👧 Family</option>
              <option value="parents_only">👩‍⚖️ Parents only</option>
              <option value="private">🔒 Just me</option>
            </select>
            <p className="text-[11px] text-foreground-secondary">
              {visibility === "family" && "Kids can view this."}
              {visibility === "parents_only" && "Kids won't see this."}
              {visibility === "private" && "Only you can see this."}
            </p>
          </div>
          {(visibility === "family" || visibility === "family_read_only") && (
            <div className="space-y-0.5">
              <Label
                htmlFor="kid_title"
                className="text-xs text-foreground-secondary"
              >
                Kid-friendly title (optional)
              </Label>
              <Input
                id="kid_title"
                value={kidTitle}
                onChange={(e) => setKidTitle(e.target.value)}
                placeholder="e.g. Parent appointment"
              />
              <p className="text-[11px] text-foreground-secondary">
                Optional — a simpler title your children will see
              </p>
            </div>
          )}
          <div className="space-y-2">
            <div className="space-y-1">
              <Label htmlFor="date" className="text-xs">
                Date
              </Label>
              <Input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                className="w-full h-8 px-2 py-1 text-xs"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="start_time" className="text-xs">
                  Start time
                </Label>
                <Input
                  id="start_time"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full min-w-[120px] h-8 px-2 py-1 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="end_time" className="text-xs">
                  End time
                </Label>
                <Input
                  id="end_time"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full min-w-[120px] h-8 px-2 py-1 text-xs"
                />
              </div>
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="repeating"
                checked={isRepeating}
                onChange={(e) => setIsRepeating(e.target.checked)}
                className="rounded border-border"
              />
              <Label htmlFor="repeating" className="font-normal text-xs">
                Repeating event
              </Label>
            </div>
            {isRepeating && (
              <>
                <Label htmlFor="repeat" className="text-xs">
                  Frequency
                </Label>
                <select
                  id="repeat"
                  value={repeat}
                  onChange={(e) => setRepeat(e.target.value)}
                  className={cn(
                    "flex h-8 w-full rounded-card border border-input bg-background px-2 py-1 text-xs",
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
          <Button
            type="submit"
            disabled={loading}
            className="rounded-full h-8 px-4 text-xs"
          >
            {loading ? "Adding…" : "Add event"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
