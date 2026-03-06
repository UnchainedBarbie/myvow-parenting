"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { MessageSquare, DollarSign, Calendar, FileText, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { showErrorToast, showSuccessToast } from "@/components/ui/toaster";

const REPORT_TYPES = [
  {
    id: "communication_report",
    title: "Communication Report",
    description: "Complete message history with tone classifications and thread summaries",
    icon: MessageSquare,
    hasDateRange: true,
    filters: ["child", "topic"] as const,
    options: [
      { id: "message_timeline", label: "Message timeline", default: true },
      { id: "tone_classifications", label: "Tone classifications per message", default: true },
      { id: "thread_summaries", label: "Thread summaries", default: true },
      { id: "structured_pause", label: "Structured pause events", default: true },
      { id: "personal_flags", label: "Personal flags (opt-in, private by default)", default: false },
    ],
    formats: ["pdf", "excel"] as const,
  },
  {
    id: "expense_report",
    title: "Expense Report",
    description: "Shared expenses, payment history, and balances",
    icon: DollarSign,
    hasDateRange: true,
    filters: ["child", "category", "status"] as const,
    options: [
      { id: "all_expenses", label: "All expenses with details", default: true },
      { id: "payment_records", label: "Payment records", default: true },
      { id: "dispute_history", label: "Dispute history", default: true },
      { id: "net_balance", label: "Net balance summary", default: true },
      { id: "receipts_zip", label: "Receipts (attached as separate files in zip)", default: true },
    ],
    formats: ["pdf", "excel", "csv"] as const,
  },
  {
    id: "calendar_report",
    title: "Calendar & Custody Report",
    description: "Custody schedule, exchanges, and calendar events",
    icon: Calendar,
    hasDateRange: true,
    filters: [] as const,
    options: [
      { id: "custody_schedule", label: "Custody schedule", default: true },
      { id: "schedule_changes", label: "Schedule changes/swaps", default: true },
      { id: "missed_pickups", label: "Missed pickups/dropoffs (if logged)", default: true },
      { id: "events_by_child", label: "Calendar events by child", default: true },
    ],
    formats: ["pdf", "excel"] as const,
  },
  {
    id: "document_index",
    title: "Document Index",
    description: "Index of all uploaded documents with metadata",
    icon: FileText,
    hasDateRange: false,
    filters: [] as const,
    options: [
      { id: "document_list", label: "Document list with categories and dates", default: true },
      { id: "linked_conversations", label: "Linked conversations", default: true },
      { id: "include_documents_zip", label: "Include actual documents (zip bundle)", default: false },
    ],
    formats: ["pdf", "excel"] as const,
  },
  {
    id: "interaction_log",
    title: "Interaction Log",
    description: "Documented interactions from Sage, with timestamps and linked messages when available",
    icon: FileText,
    hasDateRange: true,
    filters: [] as const,
    options: [
      { id: "sage_documented", label: "Documented interactions from Sage", default: true },
      { id: "timestamps_and_notes", label: "Timestamps and session notes", default: true },
      { id: "linked_messages", label: "Linked messages (if any)", default: true },
    ],
    formats: ["pdf", "excel"] as const,
  },
  {
    id: "full_case_report",
    title: "Full Case Report",
    description: "Comprehensive report combining all sections above",
    icon: BookOpen,
    hasDateRange: true,
    filters: [] as const,
    options: [] as { id: string; label: string; default: boolean }[],
    formats: ["pdf"] as const,
  },
] as const;

function defaultEndDate() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function defaultStartDate() {
  const d = new Date();
  d.setDate(d.getDate() - 90);
  return d.toISOString().slice(0, 10);
}

interface ReportsHubProps {
  caseId: string;
  children: { id: string; first_name: string }[];
}

export function ReportsHub({ caseId, children }: ReportsHubProps) {
  const router = useRouter();
  const [generating, setGenerating] = useState<string | null>(null);
  const [dateStart, setDateStart] = useState(defaultStartDate);
  const [dateEnd, setDateEnd] = useState(defaultEndDate);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, Record<string, boolean>>>({});
  const [format, setFormat] = useState<Record<string, string>>({});

  function getOptionKey(reportId: string, optionId: string) {
    return `${reportId}:${optionId}`;
  }

  function isOptionChecked(reportId: string, optionId: string, defaultValue: boolean): boolean {
    const key = getOptionKey(reportId, optionId);
    if (selectedOptions[reportId]?.[optionId] !== undefined) {
      return selectedOptions[reportId][optionId];
    }
    return defaultValue;
  }

  function setOption(reportId: string, optionId: string, value: boolean) {
    setSelectedOptions((prev) => ({
      ...prev,
      [reportId]: {
        ...(prev[reportId] ?? {}),
        [optionId]: value,
      },
    }));
  }

  function getFormat(reportId: string, formats: readonly string[]) {
    return format[reportId] ?? formats[0];
  }

  async function handleGenerate(reportType: (typeof REPORT_TYPES)[number]) {
    setGenerating(reportType.id);
    try {
      const res = await fetch("/api/reports/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          case_id: caseId,
          report_type: reportType.id,
          format: getFormat(reportType.id, reportType.formats),
          date_range_start: reportType.hasDateRange ? dateStart : undefined,
          date_range_end: reportType.hasDateRange ? dateEnd : undefined,
          options: reportType.options.reduce(
            (acc, opt) => {
              acc[opt.id] = isOptionChecked(reportType.id, opt.id, opt.default);
              return acc;
            },
            {} as Record<string, boolean>
          ),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { export_id?: string; download_url?: string; message?: string };
      if (!res.ok) {
        showErrorToast(data.message ?? "Report generation failed.");
        return;
      }
      showSuccessToast("Report generated.");
      if (data.export_id) {
        window.open(`/api/reports/download/${data.export_id}`, "_blank");
      } else if (data.download_url) {
        window.open(data.download_url, "_blank");
      }
      router.refresh();
    } finally {
      setGenerating(null);
    }
  }

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      {REPORT_TYPES.map((report) => {
        const Icon = report.icon;
        return (
          <Card
            key={report.id}
            className={cn(
              "border border-[#E8E4DC] bg-[#FDFBF7] shadow-sm",
              "rounded-xl overflow-hidden",
              "flex flex-col h-full"
            )}
          >
            <CardHeader className="pb-2">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#EEF2E9] text-[#5B7A52]">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <CardTitle className="font-heading text-base text-[#3D3D3D]">
                    {report.title}
                  </CardTitle>
                  <CardDescription className="mt-1 text-xs text-foreground-secondary">
                    {report.description}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0 flex flex-col h-full">
              <div className="flex-1 space-y-4">
                {report.hasDateRange && (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[11px] text-foreground-secondary">From</Label>
                      <input
                        type="date"
                        value={dateStart}
                        onChange={(e) => setDateStart(e.target.value)}
                        className="h-8 w-full rounded-md border border-[#E8E4DC] bg-white px-2 text-xs text-[#3D3D3D]"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-foreground-secondary">To</Label>
                      <input
                        type="date"
                        value={dateEnd}
                        onChange={(e) => setDateEnd(e.target.value)}
                        className="h-8 w-full rounded-md border border-[#E8E4DC] bg-white px-2 text-xs text-[#3D3D3D]"
                      />
                    </div>
                  </div>
                )}

                {report.options.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-[11px] text-foreground-secondary">Include</Label>
                    <ul className="space-y-1.5">
                      {report.options.map((opt) => (
                        <li key={opt.id} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id={`${report.id}-${opt.id}`}
                            checked={isOptionChecked(report.id, opt.id, opt.default)}
                            onChange={(e) => setOption(report.id, opt.id, e.target.checked)}
                            className="h-3.5 w-3.5 rounded border-[#E8E4DC] text-[#5B7A52] focus:ring-[#5B7A52]"
                          />
                          <label
                            htmlFor={`${report.id}-${opt.id}`}
                            className="text-xs text-foreground cursor-pointer"
                          >
                            {opt.label}
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <Label className="text-[11px] text-foreground-secondary shrink-0">Export as</Label>
                  <select
                    value={getFormat(report.id, report.formats)}
                    onChange={(e) => setFormat((prev) => ({ ...prev, [report.id]: e.target.value }))}
                    className="h-8 rounded-md border border-[#E8E4DC] bg-white px-2 text-xs text-[#3D3D3D]"
                  >
                    {report.formats.map((f) => (
                      <option key={f} value={f}>
                        {f.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="w-full">
                <Button
                  type="button"
                  size="sm"
                  className="w-full rounded-full bg-[#5B7A52] text-white hover:bg-[#476242] text-xs"
                  disabled={generating !== null}
                  onClick={() => void handleGenerate(report)}
                >
                  {generating === report.id ? "Generating report…" : "Generate Report"}
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
