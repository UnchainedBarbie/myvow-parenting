"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const TYPE_LABELS: Record<string, string> = {
  messages: "Message transcript",
  expenses: "Expense ledger",
  patterns: "Pattern summary",
  full_report: "Full case report",
  communication_report: "Communication Report",
  expense_report: "Expense Report",
  calendar_report: "Calendar & Custody Report",
  document_index: "Document Index",
  full_case_report: "Full Case Report",
};

export type ExportRow = {
  id: string;
  export_type: string;
  date_range_start: string | null;
  date_range_end: string | null;
  file_path: string | null;
  verification_hash: string | null;
  record_count: number | null;
  created_at: string;
};

interface ExportListProps {
  exports: ExportRow[];
}

function formatDate(createdAt: string) {
  return new Date(createdAt).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatRange(start: string | null, end: string | null) {
  if (!start && !end) return "All dates";
  if (!start) return `Through ${end ? new Date(end).toLocaleDateString() : "—"}`;
  if (!end) return `From ${new Date(start).toLocaleDateString()}`;
  return `${new Date(start).toLocaleDateString()} – ${new Date(end).toLocaleDateString()}`;
}

export function ExportList({ exports: exportList }: ExportListProps) {
  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="font-heading text-lg">Previous Reports</CardTitle>
      </CardHeader>
      <CardContent>
        {exportList.length === 0 ? (
          <p className="text-sm text-foreground-secondary py-6">
            No exports yet. Generate one above.
          </p>
        ) : (
          <ul className="space-y-3">
            {exportList.map((row) => (
              <li
                key={row.id}
                className={cn(
                  "rounded-card border border-border bg-background-secondary/50 p-4 shadow-card"
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-foreground">
                      {TYPE_LABELS[row.export_type] ?? row.export_type}
                    </p>
                    <p className="text-sm text-foreground-secondary mt-0.5">
                      {formatRange(row.date_range_start, row.date_range_end)}
                      {" · "}
                      {formatDate(row.created_at)}
                    </p>
                    {row.record_count != null && (
                      <p className="text-xs text-foreground-secondary mt-1">
                        {row.record_count} records
                        {row.verification_hash && (
                          <> · Hash: {row.verification_hash.slice(0, 16)}…</>
                        )}
                      </p>
                    )}
                  </div>
                  {row.file_path && (
                    <a
                      href={`/api/reports/download/${row.id}`}
                      download
                      className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-light hover:bg-primary-dark"
                    >
                      Download
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
