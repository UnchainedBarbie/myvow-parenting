"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { FileText, Image, Trash2, Shield, Clock, FileCheck } from "lucide-react";

const DOCUMENT_CATEGORIES = [
  { value: "court_order", label: "Court Order" },
  { value: "school", label: "School" },
  { value: "medical", label: "Medical" },
  { value: "expenses", label: "Expenses" },
  { value: "messages", label: "Messages" },
  { value: "photos", label: "Photos" },
  { value: "therapy", label: "Therapy" },
  { value: "legal", label: "Legal" },
  { value: "communication", label: "Communication" },
  { value: "incident", label: "Incident" },
  { value: "other", label: "Other" },
] as const;

const VISIBILITY_OPTIONS = [
  { value: "private", label: "Private", tooltip: "Only you can view" },
  { value: "family", label: "Shared", tooltip: "Other parent can view" },
  { value: "family_read_only", label: "Shared + AI", tooltip: "AI can categorize and draft court-export notes" },
] as const;

const DESCRIPTION_MAX = 250;
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB
const ACCEPT = "image/*,.pdf,application/pdf,.doc,.docx";
const ACCEPT_LABEL = "PDF, JPG, PNG, DOCX";

type Child = { id: string; first_name: string };
type LogEntry = { id: string; external_comm_id: string | null; created_at: string };

interface DocumentUploadFormProps {
  caseId: string;
  children: Child[];
  logEntries?: LogEntry[];
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileNameWithoutExt(name: string) {
  const last = name.lastIndexOf(".");
  return last > 0 ? name.slice(0, last) : name;
}

export function DocumentUploadForm({ caseId, children, logEntries = [] }: DocumentUploadFormProps) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [category, setCategory] = useState<string>("other");
  const [childId, setChildId] = useState<string>("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<string>("family");
  const [notifyOtherParent, setNotifyOtherParent] = useState(false);
  const [relatedCommId, setRelatedCommId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function validateFile(f: File): string | null {
    const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
    if (!allowed.some((t) => f.type === t || f.type.startsWith("image/"))) return `Accepted: ${ACCEPT_LABEL}.`;
    if (f.size > MAX_FILE_BYTES) return `Max size 25MB. This file is ${formatSize(f.size)}.`;
    return null;
  }

  function handleFileSelect(f: File | null) {
    setFileError(null);
    if (!f) {
      setFile(null);
      return;
    }
    const err = validateFile(f);
    if (err) {
      setFileError(err);
      setFile(null);
      return;
    }
    setFile(f);
    if (!description.trim()) setDescription(fileNameWithoutExt(f.name));
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

  const canSubmit = !!file && !!category && description.trim().length > 0 && description.trim().length <= DESCRIPTION_MAX && !fileError;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (!canSubmit) return;
    setLoading(true);
    try {
      const formData = new FormData();
      formData.set("file", file!);
      formData.set("case_id", caseId);
      formData.set("category", category);
      if (childId) formData.set("child_id", childId);
      formData.set("description", description.trim());
      formData.set("visibility", visibility);
      if (relatedCommId) formData.set("related_comm_id", relatedCommId);
      if (notifyOtherParent) formData.set("notify_other_parent", "1");
      const res = await fetch("/api/documents/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Upload failed");
      setSuccess(true);
      setFile(null);
      setChildId("");
      setDescription("");
      setRelatedCommId("");
      if (inputRef.current) inputRef.current.value = "";
      setTimeout(() => { setSuccess(false); router.refresh(); }, 2000);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  const commOptions = logEntries.filter((e) => e.external_comm_id).filter((e, i, arr) => arr.findIndex((x) => (x.external_comm_id ?? x.id) === (e.external_comm_id ?? e.id)) === i);
  const descLen = description.length;

  return (
    <Card className="shadow-card border-border rounded-card">
      <CardHeader className="pb-2 px-4 pt-4">
        <CardTitle className="font-heading text-sm md:text-base text-foreground">Add Document</CardTitle>
        <div className="flex gap-2 text-[11px] text-foreground-secondary mt-1">
          <span>1 Upload</span>
          <span aria-hidden>→</span>
          <span>2 Tag</span>
          <span aria-hidden>→</span>
          <span>3 Confirm</span>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0 space-y-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          {submitError && (
            <p className="text-xs text-alert" role="alert">
              {submitError}
            </p>
          )}
          {success && (
            <p className="text-xs text-green-700 bg-green-50 rounded-card px-2 py-1.5" role="status">
              Document added.
            </p>
          )}

          {/* Step 1: File */}
          <div className="space-y-2">
            <Label className="text-xs font-medium">File (required)</Label>
            {!file ? (
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
                    ref={inputRef}
                    type="file"
                    accept={ACCEPT}
                    className="hidden"
                    onChange={(e) => handleFileSelect(e.target.files?.[0] ?? null)}
                  />
                  <p className="text-xs text-foreground-secondary">Drop file or click to browse</p>
                  <p className="text-[11px] text-foreground-secondary mt-1">{ACCEPT_LABEL}, max 25MB</p>
                  <Button type="button" variant="ghost" size="sm" className="mt-2 h-7 text-xs" onClick={() => inputRef.current?.click()}>
                    Choose file
                  </Button>
                </div>
                {fileError && <p className="text-xs text-alert">{fileError}</p>}
              </>
            ) : (
              <div className="rounded-card border border-border bg-background p-2 flex items-center gap-2">
                {file.type.startsWith("image/") ? (
                  <Image className="h-8 w-8 text-foreground-secondary shrink-0" aria-hidden />
                ) : (
                  <FileText className="h-8 w-8 text-foreground-secondary shrink-0" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-foreground truncate" title={file.name}>{file.name}</p>
                  <p className="text-[11px] text-foreground-secondary">{formatSize(file.size)} · {file.type.split("/")[1] || "file"}</p>
                </div>
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs shrink-0" onClick={() => inputRef.current?.click()}>
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

          {/* Step 2: Tag */}
          <div className="space-y-2">
            <Label htmlFor="category" className="text-xs font-medium">Category (required)</Label>
            <select
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              required
              className={cn(
                "flex h-8 w-full rounded-card border border-input bg-background px-2 py-1 text-xs",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              )}
            >
              {DOCUMENT_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          {children.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="child" className="text-xs font-medium">Child (optional)</Label>
              <select
                id="child"
                value={childId}
                onChange={(e) => setChildId(e.target.value)}
                className={cn(
                  "flex h-8 w-full rounded-card border border-input bg-background px-2 py-1 text-xs",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                )}
              >
                <option value="">— Add child (optional)</option>
                {children.map((c) => (
                  <option key={c.id} value={c.id}>{c.first_name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="description" className="text-xs font-medium">Description (required)</Label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, DESCRIPTION_MAX))}
              placeholder='Example: Photo of lunch contents sent with Avery on 2/26/26'
              required
              maxLength={DESCRIPTION_MAX}
              rows={3}
              className={cn(
                "flex w-full rounded-card border border-input bg-background px-3 py-2 text-xs resize-y min-h-[72px]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              )}
            />
            <p className="text-xs text-foreground-secondary">
              <span className={cn(descLen > DESCRIPTION_MAX ? "text-alert" : "")}>{descLen}</span> / {DESCRIPTION_MAX}
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-medium">Who can see this?</Label>
            <div className="inline-flex rounded-card border border-border bg-background-secondary/60 p-0.5 gap-0" role="group" aria-label="Visibility">
              {VISIBILITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  title={opt.tooltip}
                  onClick={() => setVisibility(opt.value)}
                  className={cn(
                    "px-2 py-1.5 text-xs rounded-md transition-colors",
                    visibility === opt.value
                      ? "bg-[#7B9E87] text-white"
                      : "text-foreground-secondary hover:text-foreground"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-foreground-secondary">
              {VISIBILITY_OPTIONS.find((o) => o.value === visibility)?.tooltip}
            </p>
            {(visibility === "family" || visibility === "family_read_only") && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={notifyOtherParent}
                  onChange={(e) => setNotifyOtherParent(e.target.checked)}
                  className="rounded border-border"
                />
                <span className="text-xs text-foreground-secondary">Notify other parent</span>
              </label>
            )}
          </div>

          {commOptions.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="related_comm" className="text-xs font-medium">Related Log Entry (optional)</Label>
              <select
                id="related_comm"
                value={relatedCommId}
                onChange={(e) => setRelatedCommId(e.target.value)}
                className={cn(
                  "flex h-8 w-full rounded-card border border-input bg-background px-2 py-1 text-xs",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                )}
              >
                <option value="">None</option>
                {commOptions.map((e) => (
                  <option key={e.id} value={e.external_comm_id ?? e.id}>
                    {e.external_comm_id ?? `Log ${e.id.slice(0, 8)}`}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Step 3: Confirm */}
          <Button type="submit" disabled={!canSubmit || loading} className="rounded-full h-8 px-4 text-xs w-full">
            {loading ? "Uploading…" : "Add document"}
          </Button>

          <div className="flex items-start gap-2 pt-2 pb-1 text-[11px] text-foreground-secondary border-t border-border">
            <Shield className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden />
            <div className="flex flex-col gap-0.5">
              <span className="flex items-center gap-1.5"><Clock className="h-3 w-3 shrink-0" aria-hidden /> Time-stamped on upload</span>
              <span className="flex items-center gap-1.5"><Shield className="h-3 w-3 shrink-0" aria-hidden /> Access history logged</span>
              <span className="flex items-center gap-1.5"><FileCheck className="h-3 w-3 shrink-0" aria-hidden /> Exportable for court</span>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
