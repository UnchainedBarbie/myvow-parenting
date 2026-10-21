"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { FileText, Image, Trash2, Camera, Sparkles } from "lucide-react";
import { ChildMultiSelect } from "@/components/documents/child-multi-select";
import { mapExpenseCategoryFromClassify } from "@/lib/expenses-share";

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

type Child = { id: string; first_name: string; date_of_birth?: string | null };

function compareChildrenByAge(
  a: { first_name?: string | null; date_of_birth?: string | null },
  b: { first_name?: string | null; date_of_birth?: string | null }
) {
  const dobA = a.date_of_birth?.trim() ?? "";
  const dobB = b.date_of_birth?.trim() ?? "";
  const hasA = dobA.length > 0;
  const hasB = dobB.length > 0;
  if (hasA && hasB) {
    if (dobA !== dobB) return dobA < dobB ? -1 : 1;
  } else if (hasA !== hasB) {
    return hasA ? -1 : 1;
  }
  return (a.first_name ?? "").localeCompare(b.first_name ?? "", undefined, {
    sensitivity: "base",
  });
}

export type ExpenseAttachedFile = {
  document_id: string;
  file_name: string;
  url?: string;
};

export type ExpenseFormInitialValues = {
  description?: string;
  amount?: number | string;
  incurredDate?: string;
  category?: string;
  categoryDescription?: string;
  childId?: string;
  childIds?: string[];
  visibility?: string;
  /** Already-stored vault file — shown as attached; not re-uploaded on submit. */
  attachedFile?: ExpenseAttachedFile | null;
  /** Sharing sentence from the case rules, shown before save. */
  splitReview?: string;
  paidBy?: "self" | "coparent";
  sharingMode?: "personal" | "shared" | "choose" | "ask_percent";
  sharingIntent?: "personal" | "shared" | "unspecified";
  statedPercent?: number | null;
  notifyCoparent?: boolean;
};

interface ExpenseFormProps {
  caseId: string;
  children: Child[];
  custodySplitPercent?: number;
  initialValues?: ExpenseFormInitialValues | null;
  onSuccess?: (expenseId: string) => void | Promise<void>;
  /** Omit CardHeader when embedded in another modal that already has a title. */
  hideHeader?: boolean;
}

export function ExpenseForm({
  caseId,
  children,
  initialValues,
  onSuccess,
  hideHeader = false,
}: ExpenseFormProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const childrenByAge = useMemo(
    () => [...children].sort(compareChildrenByAge),
    [children]
  );
  const [description, setDescription] = useState(
    () => initialValues?.description?.slice(0, 80) ?? ""
  );
  const [amount, setAmount] = useState(() =>
    initialValues?.amount != null && initialValues.amount !== ""
      ? String(initialValues.amount)
      : ""
  );
  const [incurredDate, setIncurredDate] = useState(
    () => initialValues?.incurredDate ?? ""
  );
  const [category, setCategory] = useState<string>(
    () => initialValues?.category ?? "other"
  );
  const [categoryDescription, setCategoryDescription] = useState(
    () => initialValues?.categoryDescription?.slice(0, 100) ?? ""
  );
  const [selectedChildIds, setSelectedChildIds] = useState<string[]>(() =>
    initialValues?.childIds?.length
      ? initialValues.childIds
      : initialValues?.childId
        ? [initialValues.childId]
        : []
  );
  const [visibility, setVisibility] = useState<string>(
    () => initialValues?.visibility ?? "parents_only"
  );
  const [paidBy, setPaidBy] = useState<"self" | "coparent">(
    () => (initialValues?.paidBy === "coparent" ? "coparent" : "self")
  );
  const [sharingMode, setSharingMode] = useState(initialValues?.sharingMode ?? null);
  const [sharingChoice, setSharingChoice] = useState<"personal" | "shared" | null>(() => {
    if (initialValues?.sharingMode === "personal") return "personal";
    if (initialValues?.sharingMode === "shared" || initialValues?.sharingMode === "ask_percent") {
      return "shared";
    }
    return null;
  });
  const [choiceTouched, setChoiceTouched] = useState(false);
  const [statedPercent, setStatedPercent] = useState(
    () => (initialValues?.statedPercent != null ? String(initialValues.statedPercent) : "")
  );
  const [ruleApplied, setRuleApplied] = useState(
    () => initialValues?.sharingMode === "shared" && initialValues.statedPercent == null
  );
  const [sharingReview, setSharingReview] = useState(() => initialValues?.splitReview ?? "");
  const [notifyTouched, setNotifyTouched] = useState(() => initialValues?.notifyCoparent != null);
  const [notifyCoparent, setNotifyCoparent] = useState(() => initialValues?.notifyCoparent === true);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [storedReceipt, setStoredReceipt] = useState<ExpenseAttachedFile | null>(
    () => initialValues?.attachedFile ?? null
  );
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

  useEffect(() => {
    if (!initialValues) return;
    if (initialValues.description != null) {
      setDescription(initialValues.description.slice(0, 80));
    }
    if (initialValues.amount != null && initialValues.amount !== "") {
      setAmount(String(initialValues.amount));
    }
    if (initialValues.incurredDate != null) {
      setIncurredDate(initialValues.incurredDate);
    }
    if (initialValues.category != null) {
      setCategory(initialValues.category);
    }
    if (initialValues.categoryDescription != null) {
      setCategoryDescription(initialValues.categoryDescription.slice(0, 100));
    }
    if (initialValues.childIds?.length) {
      setSelectedChildIds(initialValues.childIds);
    } else if (initialValues.childId) {
      setSelectedChildIds([initialValues.childId]);
    }
    if (initialValues.visibility != null) {
      setVisibility(initialValues.visibility);
    }
    setPaidBy(initialValues.paidBy === "coparent" ? "coparent" : "self");
    if (initialValues.sharingMode) setSharingMode(initialValues.sharingMode);
    if (initialValues.sharingMode === "personal") setSharingChoice("personal");
    else if (initialValues.sharingMode === "shared" || initialValues.sharingMode === "ask_percent") {
      setSharingChoice("shared");
    }
    if (initialValues.statedPercent != null) setStatedPercent(String(initialValues.statedPercent));
    if (initialValues.splitReview) setSharingReview(initialValues.splitReview);
    if (initialValues.notifyCoparent != null) {
      setNotifyCoparent(initialValues.notifyCoparent);
      setNotifyTouched(true);
    }
    if (initialValues.attachedFile?.document_id) {
      setStoredReceipt(initialValues.attachedFile);
      setReceiptFile(null);
    }
  }, [initialValues]);

  useEffect(() => {
    const amt = Number(amount);
    if (!caseId || !Number.isFinite(amt) || amt <= 0 || !category) return;
    const matchesInitial =
      initialValues?.category === category && Number(initialValues?.amount) === amt;
    const intent =
      choiceTouched && sharingChoice
        ? sharingChoice
        : matchesInitial && initialValues?.sharingIntent
          ? initialValues.sharingIntent
          : "unspecified";
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch("/api/expenses/sharing-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          case_id: caseId,
          amount: amt,
          category,
          child_id: selectedChildIds[0] ?? null,
          sharing_intent: intent,
          stated_percent: statedPercent.trim() ? Number(statedPercent) : null,
          paid_by: paidBy,
          notify_coparent: notifyTouched ? notifyCoparent : null,
        }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: {
          mode?: "personal" | "shared" | "choose" | "ask_percent";
          notifyCoparent?: boolean;
          ruleApplied?: boolean;
          review?: string;
        } | null) => {
          if (!data?.mode) return;
          setSharingMode(data.mode);
          setRuleApplied(data.ruleApplied === true);
          if (data.review) setSharingReview(data.review);
          if (!choiceTouched) {
            if (data.mode === "personal") setSharingChoice("personal");
            else if (data.mode === "shared" || data.mode === "ask_percent") setSharingChoice("shared");
            else setSharingChoice(null);
          }
          if (!notifyTouched) setNotifyCoparent(data.notifyCoparent === true);
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    amount,
    caseId,
    category,
    choiceTouched,
    initialValues?.amount,
    initialValues?.category,
    initialValues?.sharingIntent,
    notifyCoparent,
    notifyTouched,
    paidBy,
    selectedChildIds,
    sharingChoice,
    statedPercent,
  ]);

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
      setStoredReceipt(null);
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
    setStoredReceipt(null);
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
        const truncated = payload.description.slice(0, 80);
        setDescription(truncated);
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
        setCategory(mapExpenseCategoryFromClassify(payload.category ?? ""));
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
    if (sharingMode === "choose" && !sharingChoice) {
      setError("Choose Personal log or Shared expense.");
      return;
    }
    if (sharingMode === "ask_percent" && !statedPercent.trim()) {
      setError("Enter the percentage the other parent should pay.");
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
        const title = (descTrimmed || fallbackTitle).slice(0, 80);
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
      } else if (storedReceipt?.document_id) {
        // Already in the documents vault from chat attach — do not re-upload.
        receiptFileId = storedReceipt.document_id;
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
          child_ids: selectedChildIds,
          receipt_file_id: receiptFileId,
          ...(notifyTouched ? { notify_coparent: notifyCoparent } : {}),
          paid_by: paidBy,
          sharing_intent: sharingChoice ?? undefined,
          ...(statedPercent.trim() ? { stated_percent: Number(statedPercent) } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Submit failed");
      const expenseId = data.expense_id as string | undefined;
      if (onSuccess && expenseId) {
        await onSuccess(expenseId);
        return;
      }
      setDescription("");
      setAmount("");
      setIncurredDate("");
      setCategory("other");
      setCategoryDescription("");
      setSelectedChildIds([]);
      setVisibility("parents_only");
      setNotifyCoparent(false);
      setReceiptFile(null);
      setStoredReceipt(null);
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

  return (
    <Card className="shadow-card border-border rounded-card">
      {!hideHeader && (
        <CardHeader className="pb-2 px-4 pt-4">
          <CardTitle className="font-heading text-lg text-foreground">Add expense</CardTitle>
          <p className="text-[11px] text-foreground-secondary mt-0.5">
            Allocation is based on your parenting plan.
          </p>
        </CardHeader>
      )}
      <CardContent className={cn("px-4 pb-4 space-y-4", hideHeader ? "pt-4" : "")}>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <p className="text-xs text-alert" role="alert">
              {error}
            </p>
          )}
          <div className="space-y-2">
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
            {receiptFile ? (
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
            ) : storedReceipt ? (
              <div className="rounded-card border border-border bg-background p-2 flex items-center gap-2">
                <FileText className="h-8 w-8 text-foreground-secondary shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p
                    className="text-xs text-foreground truncate"
                    title={storedReceipt.file_name}
                  >
                    {storedReceipt.file_name}
                  </p>
                  <p className="text-[11px] text-foreground-secondary">
                    Already attached
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
                  onClick={() => setStoredReceipt(null)}
                  className="p-1.5 rounded hover:bg-muted text-foreground-secondary"
                  aria-label="Remove attached file"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ) : (
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
              </>
            )}
            {fileError && <p className="text-xs text-alert">{fileError}</p>}
          </div>
          {(descriptionSuggested || amountSuggested || categorySuggested || childSuggested) && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Sparkles className="h-3 w-3" />
              Fields auto-filled from your receipt. Review before saving.
            </p>
          )}
          <div className="space-y-1.5">
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
              maxLength={80}
              className={cn(
                "flex h-8 w-full rounded-card border border-input bg-background px-3 py-1 text-xs",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              )}
            />
            <div className="text-[10px] text-muted-foreground text-right">
              {description.length}/80
            </div>
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
                children={childrenByAge}
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
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-foreground">Sharing</legend>
            {sharingReview ? (
              <p className="text-xs text-foreground-secondary">{sharingReview}</p>
            ) : (
              <p className="text-xs text-foreground-secondary">
                Choose a personal log, or a shared expense that uses this case&apos;s rules.
              </p>
            )}
            <label className="flex items-start gap-2 text-xs text-foreground">
              <input
                type="radio"
                name="expense-sharing"
                className="mt-0.5"
                checked={sharingChoice === "personal"}
                onChange={() => {
                  setChoiceTouched(true);
                  setSharingChoice("personal");
                  if (!notifyTouched) setNotifyCoparent(false);
                }}
              />
              <span>Personal log</span>
            </label>
            <label className="flex items-start gap-2 text-xs text-foreground">
              <input
                type="radio"
                name="expense-sharing"
                className="mt-0.5"
                checked={sharingChoice === "shared"}
                onChange={() => {
                  setChoiceTouched(true);
                  setSharingChoice("shared");
                  if (!notifyTouched) setNotifyCoparent(true);
                }}
              />
              <span>Shared expense</span>
            </label>
            {sharingChoice === "shared" && !ruleApplied ? (
              <div className="space-y-1">
                <Label htmlFor="exp-share-percent" className="text-xs font-medium">
                  Other parent&apos;s percentage
                </Label>
                <input
                  id="exp-share-percent"
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={statedPercent}
                  onChange={(e) => setStatedPercent(e.target.value)}
                  placeholder="50"
                  className={cn(
                    "flex h-8 w-full rounded-card border border-input bg-background px-2 py-1 text-xs",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  )}
                />
              </div>
            ) : null}
          </fieldset>
          <label className="flex items-start gap-2 text-xs text-foreground">
            <input
              type="checkbox"
              className="mt-0.5 rounded border-border"
              checked={notifyCoparent}
              onChange={(e) => {
                setNotifyTouched(true);
                setNotifyCoparent(e.target.checked);
              }}
            />
            <span>
              Notify co-parent about this expense
              <span className="block text-[11px] text-foreground-secondary">
                Checked for a shared expense. A personal log leaves this off.
                Saving asks them to respond in the ledger. No email is sent.
              </span>
            </span>
          </label>
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
