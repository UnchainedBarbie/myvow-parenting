"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { FileText, Image, Trash2, Camera, Sparkles } from "lucide-react";
import { ChildMultiSelect } from "@/components/documents/child-multi-select";

const EXPENSE_CATEGORIES = [
  { value: "medical", label: "Medical" },
  { value: "dental", label: "Dental" },
  { value: "therapy", label: "Therapy" },
  { value: "school", label: "School" },
  { value: "extracurricular", label: "Extracurricular" },
  { value: "clothing", label: "Clothing" },
  { value: "childcare", label: "Childcare" },
  { value: "transportation", label: "Transportation" },
  { value: "other", label: "Other" },
] as const;

const EXPENSE_CATEGORY_VALUES = new Set(EXPENSE_CATEGORIES.map((c) => c.value));

const VISIBILITY_OPTIONS = [
  { value: "parents_only", label: "Parents only" },
  { value: "private", label: "Just me" },
] as const;

const ACCEPT = "image/*,.pdf,application/pdf";
const ACCEPT_LABEL = "PDF, JPG, PNG";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Map AI category to expense form category (e.g. education -> school). */
function mapCategory(aiCategory: string | null): string {
  if (!aiCategory) return "other";
  const lower = aiCategory.toLowerCase();
  if (lower === "education") return "school";
  return EXPENSE_CATEGORY_VALUES.has(lower) ? lower : "other";
}

type Child = { id: string; first_name: string };

interface ExpenseFormProps {
  caseId: string;
  children: Child[];
  custodySplitPercent: number;
}

export function ExpenseForm({
  caseId,
  children,
  custodySplitPercent,
}: ExpenseFormProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [incurredDate, setIncurredDate] = useState("");
  const [category, setCategory] = useState<string>("other");
  const [categoryDescription, setCategoryDescription] = useState("");
  const [selectedChildIds, setSelectedChildIds] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<string>("parents_only");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [classifyLoading, setClassifyLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [descriptionTouched, setDescriptionTouched] = useState(false);
  const [amountTouched, setAmountTouched] = useState(false);
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [childTouched, setChildTouched] = useState(false);
  const [descriptionSuggested, setDescriptionSuggested] = useState(false);
  const [amountSuggested, setAmountSuggested] = useState(false);
  const [categorySuggested, setCategorySuggested] = useState(false);
  const [childSuggested, setChildSuggested] = useState(false);

  function handleDrag(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(e.type === "dragenter" || e.type === "dragover");
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelect(file);
  }

  async function handleFileSelect(file: File | null) {
    setFileError(null);
    if (!file) {
      setReceiptFile(null);
      setDescriptionSuggested(false);
      setAmountSuggested(false);
      setCategorySuggested(false);
      setChildSuggested(false);
      return;
    }
    const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"];
    if (!allowed.some((t) => file.type === t || file.type.startsWith("image/"))) {
      setFileError(`Accepted: ${ACCEPT_LABEL}.`);
      return;
    }
    setReceiptFile(file);
    setClassifyLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const res = await fetch("/api/expenses/extract-receipt", {
        method: "POST",
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { message?: string }).message ||
            "Couldn't read receipt. Please fill in manually."
        );
      }
      const payload = data as {
        description: string | null;
        amount: number | null;
        date: string | null;
        merchant: string | null;
        category: string | null;
      };
      if (!descriptionTouched && payload.description) {
        setDescription(payload.description);
        setDescriptionSuggested(true);
      }
      if (
        !amountTouched &&
        payload.amount != null &&
        Number.isFinite(payload.amount)
      ) {
        setAmount(String(payload.amount));
        setAmountSuggested(true);
      }
      if (!categoryTouched && payload.category) {
        setCategory(mapCategory(payload.category));
        setCategorySuggested(true);
      }
      if (!incurredDate && payload.date) {
        setIncurredDate(payload.date);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't read receipt. Please fill in manually."
      );
    } finally {
      setClassifyLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const amt = parseFloat(amount);
    if (!description.trim() || isNaN(amt) || amt <= 0) {
      setError("Please enter a description and a valid amount.");
      return;
    }
    setLoading(true);
    try {
      let receiptFileId: string | undefined;
      if (receiptFile) {
        const formData = new FormData();
        formData.set("file", receiptFile);
        formData.set("case_id", caseId);
        formData.set("category", "financial");
        // Use the expense description as the document title/description for the receipt
        const descTrimmed = description.trim();
        const fallbackTitle = receiptFile.name || "Receipt";
        const title = (descTrimmed || fallbackTitle).slice(0, 120);
        formData.set("title", title);
        formData.set("description", descTrimmed || fallbackTitle);
        formData.set("visibility", visibility);
        const uploadRes = await fetch("/api/documents/upload", {
          method: "POST",
          body: formData,
        });
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok) throw new Error(uploadData.message || "Receipt upload failed");
        receiptFileId = uploadData.document_id;
      }
      const childId = selectedChildIds.length > 0 ? selectedChildIds[0] : undefined;
      const res = await fetch("/api/expenses/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          case_id: caseId,
          description: description.trim(),
          amount: amt,
          category,
          ...(category === "other" && categoryDescription.trim() ? { category_description: categoryDescription.trim() } : {}),
          incurred_date: incurredDate || undefined,
          child_id: childId || undefined,
          receipt_file_id: receiptFileId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Submit failed");
      setDescription("");
      setAmount("");
      setIncurredDate("");
      setCategory("other");
      setCategoryDescription("");
      setSelectedChildIds([]);
      setVisibility("parents_only");
      setReceiptFile(null);
      setDescriptionSuggested(false);
      setAmountSuggested(false);
      setCategorySuggested(false);
      setChildSuggested(false);
      setDescriptionTouched(false);
      setAmountTouched(false);
      setCategoryTouched(false);
      setChildTouched(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  const otherShare =
    amount && !isNaN(parseFloat(amount))
      ? (parseFloat(amount) * (custodySplitPercent / 100)).toFixed(2)
      : "—";

  return (
    <Card className="shadow-card border-border rounded-card">
      <CardHeader className="pb-2 px-4 pt-4">
        <CardTitle className="font-heading text-lg text-foreground">Add expense</CardTitle>
        <p className="text-[11px] text-foreground-secondary mt-0.5">
          Split based on case custody ({custodySplitPercent}% other parent’s share).
        </p>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <p className="text-xs text-alert" role="alert">
              {error}
            </p>
          )}
          <div className="space-y-2">
            {!receiptFile ? (
              <>
                <div
                  onDragEnter={handleDrag}
                  onDragLeave={handleDrag}
                  onDragOver={handleDrag}
                  onDrop={handleDrop}
                  className={cn(
                    "rounded-card border border-dashed transition-colors flex flex-col items-center justify-center min-h-[80px] py-6 px-4 text-center",
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
                  <p className="text-sm text-foreground-secondary">
                    Drop file or click to browse
                  </p>
                  <p className="text-[11px] text-foreground-secondary mt-1">
                    {classifyLoading ? "Reading receipt…" : ACCEPT_LABEL}
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs rounded-full"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Choose file
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs rounded-full gap-1.5"
                      onClick={() => cameraInputRef.current?.click()}
                      disabled={classifyLoading}
                    >
                      <Camera className="h-3.5 w-3.5" aria-hidden />
                      {classifyLoading ? "Analyzing…" : "Take photo"}
                    </Button>
                  </div>
                </div>
                {fileError && <p className="text-xs text-alert">{fileError}</p>}
              </>
            ) : (
              <div className="rounded-card border border-border bg-background p-2 flex items-center gap-2">
                {receiptFile.type.startsWith("image/") ? (
                  <Image className="h-8 w-8 text-foreground-secondary shrink-0" aria-hidden />
                ) : (
                  <FileText className="h-8 w-8 text-foreground-secondary shrink-0" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-foreground truncate" title={receiptFile.name}>
                    {receiptFile.name}
                  </p>
                  <p className="text-[11px] text-foreground-secondary">
                    {classifyLoading
                      ? "Reading receipt…"
                      : `${formatSize(receiptFile.size)} · ${
                          receiptFile.type.split("/")[1] || "file"
                        }`}
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
          {(descriptionSuggested || amountSuggested || categorySuggested || childSuggested) && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Sparkles className="h-3 w-3" />
              Fields auto-filled from your receipt. Review before saving.
            </p>
          )}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="exp-description" className="text-xs font-medium">
                Description
              </Label>
              {descriptionSuggested && (
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Sparkles className="h-3 w-3" />
                  AI-suggested
                </span>
              )}
            </div>
            <input
              id="exp-description"
              type="text"
              value={description}
              onChange={(e) => {
                setDescriptionTouched(true);
                setDescriptionSuggested(false);
                setDescription(e.target.value);
              }}
              placeholder="e.g. Pediatrician visit"
              required
              className={cn(
                "flex h-8 w-full rounded-card border border-input bg-background px-3 py-1 text-xs",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              )}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="exp-amount" className="text-xs font-medium">
                Amount
              </Label>
              {amountSuggested && (
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Sparkles className="h-3 w-3" />
                  AI-suggested
                </span>
              )}
            </div>
            <div className="flex h-8 w-full rounded-card border border-input bg-background overflow-hidden focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
              <span className="flex items-center pl-3 text-xs text-foreground-secondary">$</span>
              <input
                id="exp-amount"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => {
                  setAmountTouched(true);
                  setAmountSuggested(false);
                  setAmount(e.target.value);
                }}
                placeholder="0.00"
                required
                className="flex-1 min-w-0 h-full px-2 py-1 text-xs bg-transparent border-0 focus:outline-none"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="exp-date" className="text-xs font-medium">
              Date incurred
            </Label>
            <input
              id="exp-date"
              type="date"
              value={incurredDate}
              onChange={(e) => setIncurredDate(e.target.value)}
              className={cn(
                "flex h-8 w-full rounded-card border border-input bg-background px-2 py-1 text-xs",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              )}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="exp-category" className="text-xs font-medium">
                Category
              </Label>
              {categorySuggested && (
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Sparkles className="h-3 w-3" />
                  AI-suggested
                </span>
              )}
            </div>
            <select
              id="exp-category"
              value={category}
              onChange={(e) => {
                const next = e.target.value;
                setCategoryTouched(true);
                setCategorySuggested(false);
                setCategory(next);
                if (next !== "other") setCategoryDescription("");
              }}
              className={cn(
                "flex h-8 w-full rounded-card border border-input bg-background px-2 py-1 text-xs",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              )}
            >
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            {category === "other" && (
              <div className="space-y-2 pt-1">
                <Label htmlFor="exp-category-desc" className="text-xs font-medium">
                  Category description
                </Label>
                <input
                  id="exp-category-desc"
                  type="text"
                  value={categoryDescription}
                  onChange={(e) => setCategoryDescription(e.target.value.slice(0, 100))}
                  placeholder="e.g., School supplies, Birthday party"
                  maxLength={100}
                  className={cn(
                    "flex h-8 w-full rounded-card border border-input bg-background px-2 py-1 text-xs",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  )}
                />
              </div>
            )}
          </div>
          {children.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium">Child</Label>
                {childSuggested && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Sparkles className="h-3 w-3" />
                    AI-suggested
                  </span>
                )}
              </div>
              <ChildMultiSelect
                children={children}
                value={selectedChildIds}
                onChange={(ids) => {
                  setChildTouched(true);
                  setChildSuggested(false);
                  setSelectedChildIds(ids);
                }}
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="exp-visibility" className="text-xs font-medium">
              Who can see this?
            </Label>
            <select
              id="exp-visibility"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value)}
              className={cn(
                "flex h-8 w-full rounded-card border border-input bg-background px-2 py-1 text-xs",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              )}
            >
              {VISIBILITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          {amount && !isNaN(parseFloat(amount)) && (
            <p className="text-xs text-foreground-secondary">
              Other parent’s share ({custodySplitPercent}%): ${otherShare}
            </p>
          )}
          <Button
            type="submit"
            disabled={loading}
            className="rounded-full h-8 text-xs bg-[#7B9E87] hover:bg-[#6A8A78] text-white"
          >
            {loading ? "Submitting…" : "Submit expense"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
