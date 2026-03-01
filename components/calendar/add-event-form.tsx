"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { FileText, Image, Trash2, Camera } from "lucide-react";

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB
const ACCEPT = "image/*,.pdf,application/pdf,.doc,.docx";
const ACCEPT_LABEL = "PDF, JPG, PNG, DOCX, max 25MB";
const TITLE_MAX = 120;
const DESCRIPTION_MAX = 250;

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileNameWithoutExt(name: string) {
  const last = name.lastIndexOf(".");
  return last > 0 ? name.slice(0, last) : name;
}

function toTitleCase(s: string) {
  return s
    .split(/\s+/)
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ")
    .trim();
}

/** Suggest event type from filename keywords (event types: medical, school, extracurricular, custody_exchange, therapy, other). */
function suggestEventTypeFromFileName(fileName: string): string {
  const lower = fileName.toLowerCase();
  const keywordMap: Array<{ keys: string[]; value: string }> = [
    { keys: ["medical", "doctor", "rx", "health", "pediatric"], value: "medical" },
    { keys: ["school", "report", "grade", "teacher", "parent-teacher"], value: "school" },
    { keys: ["therapy", "counsel", "counseling"], value: "therapy" },
    { keys: ["custody", "exchange", "handoff", "pickup", "dropoff"], value: "custody_exchange" },
    { keys: ["soccer", "dance", "sport", "extracurricular", "practice"], value: "extracurricular" },
  ];
  for (const { keys, value } of keywordMap) {
    if (keys.some((k) => lower.includes(k))) return value;
  }
  return "other";
}

function getEventSuggestionsFromFile(f: File) {
  const baseName = fileNameWithoutExt(f.name);
  const cleanTitle = toTitleCase(
    baseName.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim()
  ).slice(0, TITLE_MAX);
  const suggestedTitle = cleanTitle || "Untitled event";
  const suggestedEventType = suggestEventTypeFromFileName(f.name);
  const today = new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const suggestedDescription = `Uploaded ${f.name} on ${today}`.slice(0, DESCRIPTION_MAX);
  return { suggestedTitle, suggestedEventType, suggestedDescription };
}

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
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [titleTouched, setTitleTouched] = useState(false);
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [descriptionTouched, setDescriptionTouched] = useState(false);
  const [titleSuggested, setTitleSuggested] = useState(false);
  const [categorySuggested, setCategorySuggested] = useState(false);
  const [descriptionSuggested, setDescriptionSuggested] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

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

  function validateFile(f: File): string | null {
    const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
    if (!allowed.some((t) => f.type === t || f.type.startsWith("image/"))) return `Accepted: ${ACCEPT_LABEL}.`;
    if (f.size > MAX_FILE_BYTES) return `Max size 25MB. This file is ${formatSize(f.size)}.`;
    return null;
  }

  const applySuggestions = useCallback((f: File) => {
    const { suggestedTitle, suggestedEventType, suggestedDescription } = getEventSuggestionsFromFile(f);
    if (!titleTouched) {
      setTitle(suggestedTitle);
      setTitleSuggested(true);
    }
    if (!categoryTouched) {
      setEventType(suggestedEventType);
      setCategorySuggested(true);
    }
    if (!descriptionTouched) {
      setDescription(suggestedDescription);
      setDescriptionSuggested(true);
    }
  }, [titleTouched, categoryTouched, descriptionTouched]);

  function handleFileSelect(f: File | null) {
    setFileError(null);
    if (!f) {
      setSelectedFile(null);
      return;
    }
    const err = validateFile(f);
    if (err) {
      setFileError(err);
      setSelectedFile(null);
      return;
    }
    setSelectedFile(f);
    applySuggestions(f);
    if (f.type.startsWith("image/")) {
      setPhotoUploading(true);
      setError(null);
      const form = new FormData();
      form.set("file", f);
      form.set("case_id", caseId);
      fetch("/api/calendar/inbox/photo", { method: "POST", body: form })
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? "Upload failed");
          return data;
        })
        .then((data) => {
          const d = data.draft ?? {};
          if (d.title && !titleTouched) setTitle(d.title);
          if (d.date) setDate(d.date.slice(0, 10));
          if (d.start_time) setStartTime(timeToHHmm(d.start_time));
          if (d.end_time) setEndTime(timeToHHmm(d.end_time));
          if (d.notes && !descriptionTouched) setDescription(d.notes);
          if (d.category && EVENT_TYPES.some((t) => t.value === d.category) && !categoryTouched) setEventType(d.category);
          if (d.child_name && children.length) {
            const child = children.find((c) => c.first_name.toLowerCase() === String(d.child_name).toLowerCase());
            if (child) setChildId(child.id);
          }
          setSourceMessageId(data.message_id ?? null);
        })
        .catch((err) => setError(err instanceof Error ? err.message : "Upload failed"))
        .finally(() => setPhotoUploading(false));
    }
  }

  function handleDrag(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(e.type === "dragenter" || e.type === "dragover");
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFileSelect(f);
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
      setSelectedFile(null);
      setTitleTouched(false);
      setCategoryTouched(false);
      setDescriptionTouched(false);
      setTitleSuggested(false);
      setCategorySuggested(false);
      setDescriptionSuggested(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="shadow-card border-border rounded-card">
      <CardHeader className="pb-2 px-4 pt-4">
        <CardTitle className="font-heading text-lg text-foreground">Add event</CardTitle>
        <p className="text-sm text-foreground-secondary mt-0.5">
          Medical, school, extracurricular, custody exchange, therapy, or other.
        </p>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0 space-y-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <p className="text-xs text-alert" role="alert">
              {error}
            </p>
          )}
          <div className="space-y-2">
            <Label className="text-xs font-medium">Photo / File</Label>
            {!selectedFile ? (
              <>
                <div
                  onDragEnter={handleDrag}
                  onDragLeave={handleDrag}
                  onDragOver={handleDrag}
                  onDrop={handleDrop}
                  className={cn(
                    "rounded-card border border-dashed transition-colors flex flex-col items-center justify-center min-h-[80px] py-4 px-3 text-center",
                    dragActive ? "border-primary bg-primary/5" : "border-border bg-background-secondary/30"
                  )}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPT}
                    className="hidden"
                    onChange={(e) => {
                      handleFileSelect(e.target.files?.[0] ?? null);
                      e.target.value = "";
                    }}
                  />
                  <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => {
                      handleFileSelect(e.target.files?.[0] ?? null);
                      e.target.value = "";
                    }}
                  />
                  <p className="text-xs text-foreground-secondary">Drop file or click to browse</p>
                  <p className="text-[11px] text-foreground-secondary mt-1">{ACCEPT_LABEL}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Choose file
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1.5"
                      onClick={() => cameraInputRef.current?.click()}
                      disabled={photoUploading}
                    >
                      <Camera className="h-3.5 w-3.5" aria-hidden />
                      {photoUploading ? "Extracting…" : "Take photo"}
                    </Button>
                  </div>
                </div>
                {fileError && <p className="text-xs text-alert">{fileError}</p>}
              </>
            ) : (
              <div className="rounded-card border border-border bg-background p-2 flex items-center gap-2">
                {selectedFile.type.startsWith("image/") ? (
                  <Image className="h-8 w-8 text-foreground-secondary shrink-0" aria-hidden />
                ) : (
                  <FileText className="h-8 w-8 text-foreground-secondary shrink-0" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-foreground truncate" title={selectedFile.name}>
                    {selectedFile.name}
                  </p>
                  <p className="text-[11px] text-foreground-secondary">
                    {formatSize(selectedFile.size)} · {selectedFile.type.split("/")[1] || "file"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs shrink-0"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Replace
                </Button>
                <button
                  type="button"
                  onClick={() => handleFileSelect(null)}
                  className="p-1.5 rounded hover:bg-muted text-foreground-secondary"
                  aria-label="Remove file"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
          {(titleSuggested || categorySuggested || descriptionSuggested) && (
            <p className="text-xs text-muted-foreground">Fields auto-filled based on your file. Review before saving.</p>
          )}
          <div className="space-y-2">
            <Label htmlFor="title" className="text-xs font-medium">
              Title
            </Label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(e) => {
                setTitleTouched(true);
                setTitleSuggested(false);
                setTitle(e.target.value);
              }}
              placeholder="e.g. Pediatrician visit"
              required
              className={cn(
                "flex h-8 w-full rounded-card border border-input bg-background px-2 py-1 text-xs",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              )}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="event_type" className="text-xs font-medium">
              Category
            </Label>
            <select
              id="event_type"
              value={eventType}
              onChange={(e) => {
                const next = e.target.value;
                setCategoryTouched(true);
                setCategorySuggested(false);
                setEventType(next);
                if (!visibilityTouched) {
                  const v = getDefaultVisibilityForType(next);
                  setVisibility(v);
                  setAutoParentsOnlyHint(v === "parents_only");
                }
              }}
              className={cn(
                "flex h-8 w-full rounded-card border border-input bg-background px-2 py-1 text-xs",
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
            <Label htmlFor="child" className="text-xs font-medium">
              Child
            </Label>
            <select
              id="child"
              value={childId}
              onChange={(e) => setChildId(e.target.value)}
              className={cn(
                "flex h-8 w-full rounded-card border border-input bg-background px-2 py-1 text-xs",
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
            <Label htmlFor="description" className="text-xs font-medium">
              Description
            </Label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => {
                setDescriptionTouched(true);
                setDescriptionSuggested(false);
                setDescription(e.target.value);
              }}
              placeholder="Notes"
              required
              rows={4}
              className={cn(
                "flex w-full rounded-card border border-input bg-background px-2 py-1 text-xs",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                "min-h-[80px] resize-y"
              )}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="visibility" className="text-xs font-medium">
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
                "flex h-8 w-full rounded-card border border-input bg-background px-2 py-1 text-xs",
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
            <div className="space-y-2">
              <Label
                htmlFor="kid_title"
                className="text-xs font-medium text-foreground-secondary"
              >
                Kid-friendly title (optional)
              </Label>
              <input
                id="kid_title"
                type="text"
                value={kidTitle}
                onChange={(e) => setKidTitle(e.target.value)}
                placeholder="e.g. Parent appointment"
                className={cn(
                  "flex h-8 w-full rounded-card border border-input bg-background px-2 py-1 text-xs",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                )}
              />
              <p className="text-[11px] text-foreground-secondary">
                Optional — a simpler title your children will see
              </p>
            </div>
          )}
          <div className="space-y-2">
            <div className="space-y-2">
              <Label htmlFor="date" className="text-xs font-medium">
                Date
              </Label>
              <input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                className={cn(
                  "flex h-8 w-full rounded-card border border-input bg-background px-2 py-1 text-xs",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label htmlFor="start_time" className="text-xs font-medium">
                  Start time
                </Label>
                <input
                  id="start_time"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className={cn(
                    "flex h-8 w-full min-w-[120px] rounded-card border border-input bg-background px-2 py-1 text-xs",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  )}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end_time" className="text-xs font-medium">
                  End time
                </Label>
                <input
                  id="end_time"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className={cn(
                    "flex h-8 w-full min-w-[120px] rounded-card border border-input bg-background px-2 py-1 text-xs",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  )}
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
              <Label htmlFor="repeating" className="font-normal text-xs font-medium">
                Repeating event
              </Label>
            </div>
            {isRepeating && (
              <>
                <Label htmlFor="repeat" className="text-xs font-medium">
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
            className="rounded-full h-8 px-4 text-xs bg-[#7B9E87] hover:bg-[#6A8A78] text-white"
          >
            {loading ? "Adding…" : "Add event"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
