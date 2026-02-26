"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const EXPORT_TYPES = [
  { value: "messages", label: "Message transcript (with AI classifications and flags)" },
  { value: "expenses", label: "Expense ledger" },
  { value: "patterns", label: "Pattern summary (flag frequencies and trends)" },
  { value: "full_report", label: "Full case report (everything)" },
];

interface ExportFormProps {
  caseId: string;
}

export function ExportForm({ caseId }: ExportFormProps) {
  const router = useRouter();
  const [exportType, setExportType] = useState("messages");
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ exportId: string; recordCount: number } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const res = await fetch("/api/reports/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          case_id: caseId,
          export_type: exportType,
          date_range_start: dateStart || undefined,
          date_range_end: dateEnd || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Export failed");
      setSuccess({ exportId: data.export_id, recordCount: data.record_count ?? 0 });
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
        <CardTitle className="font-heading text-lg">Generate court-ready PDF</CardTitle>
        <CardDescription>
          Each export is recorded in the audit trail and includes a verification hash.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="text-sm text-alert" role="alert">{error}</p>}
          {success && (
            <p className="text-sm text-success">
              Export ready.{" "}
              <a href={`/api/reports/download/${success.exportId}`} download className="underline">
                Download PDF
              </a>{" "}
              ({success.recordCount} records)
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="export_type">Report type</Label>
            <select
              id="export_type"
              value={exportType}
              onChange={(e) => setExportType(e.target.value)}
              className={cn(
                "flex h-10 w-full rounded-card border border-input bg-background px-3 py-2 text-sm",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              )}
            >
              {EXPORT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="date_start">Date range start (optional)</Label>
              <Input id="date_start" type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="date_end">Date range end (optional)</Label>
              <Input id="date_end" type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} />
            </div>
          </div>
          <Button type="submit" disabled={loading} className="rounded-full">
            {loading ? "Generating…" : "Generate PDF"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
