"use client";

import { useState } from "react";
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
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<string>("other");
  const [childId, setChildId] = useState<string>("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        const uploadRes = await fetch("/api/documents/upload", {
          method: "POST",
          body: formData,
        });
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok) throw new Error(uploadData.message || "Receipt upload failed");
        receiptFileId = uploadData.document_id;
      }
      const res = await fetch("/api/expenses/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          case_id: caseId,
          description: description.trim(),
          amount: amt,
          category,
          child_id: childId || undefined,
          receipt_file_id: receiptFileId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Submit failed");
      setDescription("");
      setAmount("");
      setCategory("other");
      setChildId("");
      setReceiptFile(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  const otherShare = amount && !isNaN(parseFloat(amount))
    ? (parseFloat(amount) * (custodySplitPercent / 100)).toFixed(2)
    : "—";

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="font-heading text-lg">Add expense</CardTitle>
        <CardDescription>
          Split is based on your case custody agreement ({custodySplitPercent}% other parent’s share).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <p className="text-sm text-alert" role="alert">
              {error}
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Pediatrician visit"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="amount">Amount ($)</Label>
            <Input
              id="amount"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="category">Category</Label>
            <select
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={cn(
                "flex h-10 w-full rounded-card border border-input bg-background px-3 py-2 text-sm ring-offset-background",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              )}
            >
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          {children.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="child">Child (optional)</Label>
              <select
                id="child"
                value={childId}
                onChange={(e) => setChildId(e.target.value)}
                className={cn(
                  "flex h-10 w-full rounded-card border border-input bg-background px-3 py-2 text-sm ring-offset-background",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                )}
              >
                <option value="">None</option>
                {children.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.first_name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="receipt">Receipt (optional)</Label>
            <Input
              id="receipt"
              type="file"
              accept="image/*,.pdf"
              onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
            />
          </div>
          {amount && !isNaN(parseFloat(amount)) && (
            <p className="text-sm text-foreground-secondary">
              Other parent’s share ({custodySplitPercent}%): ${otherShare}
            </p>
          )}
          <Button type="submit" disabled={loading} className="rounded-full">
            {loading ? "Submitting…" : "Submit expense"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
