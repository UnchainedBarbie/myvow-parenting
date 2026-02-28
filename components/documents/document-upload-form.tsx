"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

const DOCUMENT_CATEGORIES = [
  { value: "school", label: "School" },
  { value: "medical", label: "Medical" },
  { value: "therapy", label: "Therapy" },
  { value: "financial", label: "Financial" },
  { value: "communication", label: "Communication" },
  { value: "incident", label: "Incident" },
  { value: "legal", label: "Legal" },
  { value: "other", label: "Other" },
] as const;

const VISIBILITY_OPTIONS = [
  { value: "private", label: "Private (only me)" },
  { value: "shared", label: "Shared" },
  { value: "shared_ai_review", label: "Shared + AI review" },
] as const;

const DESCRIPTION_MAX = 250;
const ACCEPT = "image/*,.pdf,application/pdf";

type Child = { id: string; first_name: string };
type LogEntry = { id: string; external_comm_id: string | null; created_at: string };

interface DocumentUploadFormProps {
  caseId: string;
  children: Child[];
  logEntries?: LogEntry[];
}

export function DocumentUploadForm({ caseId, children, logEntries = [] }: DocumentUploadFormProps) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState<string>("other");
  const [childId, setChildId] = useState<string>("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<string>("private");
  const [relatedCommId, setRelatedCommId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
    if (f && (f.type.startsWith("image/") || f.type === "application/pdf")) setFile(f);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file) {
      setError("Please select a file.");
      return;
    }
    if (!description.trim()) {
      setError("Description is required.");
      return;
    }
    if (description.trim().length > DESCRIPTION_MAX) {
      setError(`Description must be ${DESCRIPTION_MAX} characters or fewer.`);
      return;
    }
    setLoading(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("case_id", caseId);
      formData.set("category", category);
      if (childId) formData.set("child_id", childId);
      formData.set("description", description.trim());
      formData.set("visibility", visibility);
      if (relatedCommId) formData.set("related_comm_id", relatedCommId);
      const res = await fetch("/api/documents/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Upload failed");
      setFile(null);
      setChildId("");
      setDescription("");
      setRelatedCommId("");
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  const commOptions = logEntries.filter((e) => e.external_comm_id).filter((e, i, arr) => arr.findIndex((x) => (x.external_comm_id ?? x.id) === (e.external_comm_id ?? e.id)) === i);
  const descLen = description.length;

  return (
    <Card className="shadow-card border-border rounded-card">
      <CardHeader className="pb-2">
        <CardTitle className="font-heading text-lg text-foreground">Add Document</CardTitle>
        <CardDescription className="text-sm text-foreground-secondary">
          Secure, time-stamped documentation. Court-export ready.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <p className="text-sm text-alert" role="alert">
              {error}
            </p>
          )}

          <div className="space-y-2">
            <Label className="text-xs font-medium">File</Label>
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              className={cn(
                "rounded-card border border-dashed transition-colors flex flex-col items-center justify-center min-h-[100px] py-4 px-4 text-center",
                dragActive ? "border-primary bg-primary/5" : "border-border bg-background-secondary/30",
                file && "border-solid border-border bg-background"
              )}
            >
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              {file ? (
                <p className="text-sm text-foreground">{file.name}</p>
              ) : (
                <p className="text-sm text-foreground-secondary">Drag and drop a file here, or click to browse</p>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-2 text-xs"
                onClick={() => inputRef.current?.click()}
              >
                {file ? "Change file" : "Choose file"}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="category" className="text-xs font-medium">Category (required)</Label>
            <select
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              required
              className={cn(
                "flex h-9 w-full rounded-card border border-border bg-background px-3 py-2 text-sm",
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
                  "flex h-9 w-full rounded-card border border-border bg-background px-3 py-2 text-sm",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                )}
              >
                <option value="">None</option>
                {children.map((c) => (
                  <option key={c.id} value={c.id}>{c.first_name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="description" className="text-xs font-medium">Description (required, {DESCRIPTION_MAX} char max)</Label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, DESCRIPTION_MAX))}
              placeholder="Brief description for court-export context"
              required
              maxLength={DESCRIPTION_MAX}
              rows={3}
              className={cn(
                "flex w-full rounded-card border border-border bg-background px-3 py-2 text-sm resize-y",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              )}
            />
            <p className="text-[11px] text-foreground-secondary">{descLen}/{DESCRIPTION_MAX}</p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-medium">Visibility (required)</Label>
            <div className="flex flex-wrap gap-2">
              {VISIBILITY_OPTIONS.map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="visibility"
                    value={opt.value}
                    checked={visibility === opt.value}
                    onChange={() => setVisibility(opt.value)}
                    className="rounded-full border-border text-primary focus:ring-ring"
                  />
                  <span className="text-sm text-foreground-secondary">{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          {commOptions.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="related_comm" className="text-xs font-medium">Related Log Entry (optional)</Label>
              <select
                id="related_comm"
                value={relatedCommId}
                onChange={(e) => setRelatedCommId(e.target.value)}
                className={cn(
                  "flex h-9 w-full rounded-card border border-border bg-background px-3 py-2 text-sm",
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

          <Button type="submit" disabled={loading} className="rounded-full">
            {loading ? "Uploading…" : "Add document"}
          </Button>

          <div className="pt-1 text-[11px] text-foreground-secondary space-y-0.5">
            <p>✓ Time-stamped on upload</p>
            <p>✓ Access history logged</p>
            <p>✓ Exportable for court</p>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
