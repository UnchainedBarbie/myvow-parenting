"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { showErrorToast } from "@/components/ui/toaster";

type BehaviorAnalysisReportData = {
  summary: {
    tone_trend: string | null;
    data_points_reviewed: number | string | null;
    date_range: unknown;
  };
  communication_patterns: {
    tone_breakdown: unknown;
    response_patterns: unknown;
    notable_patterns: unknown;
  };
  financial_compliance: {
    outstanding_amount: unknown;
    late_payments: unknown;
    dispute_ratio: unknown;
    patterns: unknown;
  };
  schedule_compliance: {
    total_events: unknown;
    patterns: unknown;
  };
  incident_summary: {
    count: unknown;
    types: unknown;
    recurring_themes: unknown;
  };
  documents_summary: {
    total: unknown;
    by_category: unknown;
  };
  narrative: string;
  recommended_next_steps: string[];
};

type BehaviorAnalysisReport = {
  id: string;
  date_from: string | null;
  date_to: string | null;
  created_at: string;
  report_data: BehaviorAnalysisReportData;
};

type RangePreset = "30" | "90" | "180" | "custom";

function formatDate(date: string | null) {
  if (!date) return "—";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(date: string | null) {
  if (!date) return "—";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatRange(from: string | null, to: string | null) {
  if (!from && !to) return "Full history";
  if (!from) return `Through ${formatDate(to)}`;
  if (!to) return `From ${formatDate(from)}`;
  return `${formatDate(from)} – ${formatDate(to)}`;
}

function computePresetRange(preset: Exclude<RangePreset, "custom">) {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const from = new Date();
  const days = preset === "30" ? 30 : preset === "90" ? 90 : 180;
  from.setDate(from.getDate() - days);
  const fromStr = from.toISOString().slice(0, 10);
  return { from: fromStr, to };
}

function humanizeKey(key: string) {
  return key
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase());
}

function renderValue(value: unknown): JSX.Element {
  if (value == null) {
    return <span className="text-xs text-foreground-secondary">No data</span>;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return <span className="text-sm text-foreground break-words">{String(value)}</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-xs text-foreground-secondary">No data</span>;
    }
    return (
      <ul className="list-disc pl-4 space-y-1 text-sm text-foreground">
        {value.map((item, idx) => (
          // eslint-disable-next-line react/no-array-index-key
          <li key={idx}>{renderValue(item)}</li>
        ))}
      </ul>
    );
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([key]) => !/(_?id|email|phone)$/i.test(key)
    );
    if (entries.length === 0) {
      return <span className="text-xs text-foreground-secondary">No data</span>;
    }
    return (
      <dl className="space-y-1 text-sm">
        {entries.map(([key, val]) => (
          <div key={key} className="flex gap-2">
            <dt className="w-32 shrink-0 text-xs font-medium text-foreground-secondary">
              {humanizeKey(key)}
            </dt>
            <dd className="flex-1">{renderValue(val)}</dd>
          </div>
        ))}
      </dl>
    );
  }

  return <span className="text-sm text-foreground break-words">{String(value)}</span>;
}

function BehaviorAnalysisReportView({
  report,
  onClose,
}: {
  report: BehaviorAnalysisReport;
  onClose: () => void;
}) {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    summary: true,
    communication_patterns: true,
    financial_compliance: true,
    schedule_compliance: true,
    incident_summary: true,
    documents_summary: true,
    narrative: true,
    recommended_next_steps: true,
  });

  const toggle = (id: string) => {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const { report_data: data } = report;

  return (
    <Card className="shadow-card border border-[#E8E4DC] bg-[#FDFBF7]">
      <CardHeader className="border-b border-[#E8E4DC] pb-3 flex flex-row items-start gap-4">
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-[#7C8B6E]" />
            <CardTitle className="font-heading text-lg text-foreground">
              Behavior analysis details
            </CardTitle>
          </div>
          <CardDescription className="text-xs text-foreground-secondary">
            {formatRange(report.date_from, report.date_to)} • Generated {formatDateTime(report.created_at)}
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-full text-xs"
            disabled
          >
            Export as PDF (coming soon)
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8 rounded-full text-xs bg-[#7B9E87] hover:bg-[#6A8A78] text-white"
            onClick={onClose}
          >
            Close
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        <div className="rounded-lg border border-[#E8E4DC] bg-[#F7F3EA] px-3 py-2 text-[11px] text-foreground-secondary">
          This analysis is for personal reflection and preparation only. It is not legal advice.
          Consider sharing it with your attorney or a trusted professional.
        </div>

        <div className="space-y-3">
          {[
            {
              id: "summary",
              title: "Summary",
              content: (
                <div className="space-y-2">
                  <div className="text-sm text-foreground">
                    <span className="font-medium">Tone trend: </span>
                    {data.summary.tone_trend || "Not specified."}
                  </div>
                  <div className="text-sm text-foreground">
                    <span className="font-medium">Data points reviewed: </span>
                    {data.summary.data_points_reviewed ?? "Unknown"}
                  </div>
                  <div className="text-sm text-foreground">
                    <span className="font-medium">Date range considered: </span>
                    {typeof data.summary.date_range === "string"
                      ? data.summary.date_range
                      : renderValue(data.summary.date_range)}
                  </div>
                </div>
              ),
            },
            {
              id: "communication_patterns",
              title: "Communication Patterns",
              content: (
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-medium text-foreground-secondary mb-0.5">
                      Tone breakdown
                    </p>
                    {renderValue(data.communication_patterns.tone_breakdown)}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-foreground-secondary mb-0.5">
                      Response patterns
                    </p>
                    {renderValue(data.communication_patterns.response_patterns)}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-foreground-secondary mb-0.5">
                      Notable patterns
                    </p>
                    {renderValue(data.communication_patterns.notable_patterns)}
                  </div>
                </div>
              ),
            },
            {
              id: "financial_compliance",
              title: "Financial Compliance",
              content: (
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-medium text-foreground-secondary mb-0.5">
                      Outstanding amount
                    </p>
                    {renderValue(data.financial_compliance.outstanding_amount)}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-foreground-secondary mb-0.5">
                      Late payments
                    </p>
                    {renderValue(data.financial_compliance.late_payments)}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-foreground-secondary mb-0.5">
                      Dispute ratio
                    </p>
                    {renderValue(data.financial_compliance.dispute_ratio)}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-foreground-secondary mb-0.5">
                      Patterns
                    </p>
                    {renderValue(data.financial_compliance.patterns)}
                  </div>
                </div>
              ),
            },
            {
              id: "schedule_compliance",
              title: "Schedule Compliance",
              content: (
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-medium text-foreground-secondary mb-0.5">
                      Total events
                    </p>
                    {renderValue(data.schedule_compliance.total_events)}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-foreground-secondary mb-0.5">
                      Patterns
                    </p>
                    {renderValue(data.schedule_compliance.patterns)}
                  </div>
                </div>
              ),
            },
            {
              id: "incident_summary",
              title: "Incident Summary",
              content: (
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-medium text-foreground-secondary mb-0.5">
                      Count
                    </p>
                    {renderValue(data.incident_summary.count)}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-foreground-secondary mb-0.5">
                      Types
                    </p>
                    {renderValue(data.incident_summary.types)}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-foreground-secondary mb-0.5">
                      Recurring themes
                    </p>
                    {renderValue(data.incident_summary.recurring_themes)}
                  </div>
                </div>
              ),
            },
            {
              id: "documents_summary",
              title: "Documents",
              content: (
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-medium text-foreground-secondary mb-0.5">
                      Total documents
                    </p>
                    {renderValue(data.documents_summary.total)}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-foreground-secondary mb-0.5">
                      By category
                    </p>
                    {renderValue(data.documents_summary.by_category)}
                  </div>
                </div>
              ),
            },
            {
              id: "narrative",
              title: "AI Narrative",
              content: (
                <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">
                  {data.narrative}
                </p>
              ),
            },
            {
              id: "recommended_next_steps",
              title: "Recommended Next Steps",
              content: Array.isArray(data.recommended_next_steps) &&
                data.recommended_next_steps.length > 0 ? (
                <ul className="list-disc pl-4 space-y-1 text-sm text-foreground">
                  {data.recommended_next_steps.map((step, idx) => (
                    // eslint-disable-next-line react/no-array-index-key
                    <li key={idx}>{step}</li>
                  ))}
                </ul>
              ) : (
                <span className="text-xs text-foreground-secondary">No specific next steps provided.</span>
              ),
            },
          ].map((section) => (
            <div
              key={section.id}
              className="rounded-lg border border-[#E8E4DC] bg-white overflow-hidden"
            >
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-[#F7F3EA]"
                onClick={() => toggle(section.id)}
              >
                <div className="flex items-center gap-2">
                  {openSections[section.id] ? (
                    <ChevronDown className="h-4 w-4 text-foreground-secondary" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-foreground-secondary" />
                  )}
                  <span className="text-sm font-medium text-foreground">
                    {section.title}
                  </span>
                </div>
              </button>
              {openSections[section.id] && (
                <div className="border-t border-[#E8E4DC] px-3 py-3">
                  {section.content}
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function CoParentBehaviorAnalysis() {
  const [reports, setReports] = useState<BehaviorAnalysisReport[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [activeReport, setActiveReport] = useState<BehaviorAnalysisReport | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [preset, setPreset] = useState<RangePreset>("90");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/reports/behavior-analysis?include=full");
        const data = (await res.json().catch(() => ({}))) as {
          reports?: Array<{
            id: string;
            date_from: string | null;
            date_to: string | null;
            created_at: string;
            report_data?: BehaviorAnalysisReportData;
          }>;
          message?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setListError(data.message ?? "Could not load behavior analyses.");
          return;
        }
        const loaded =
          (data.reports ?? [])
            .filter((r) => r.report_data)
            .map(
              (r) =>
                ({
                  id: r.id,
                  date_from: r.date_from,
                  date_to: r.date_to,
                  created_at: r.created_at,
                  report_data: r.report_data!,
                }) satisfies BehaviorAnalysisReport
            ) ?? [];
        setReports(loaded);
      } finally {
        if (!cancelled) setLoadingList(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleGenerate() {
    setGenerateError(null);

    let date_from: string | null = null;
    let date_to: string | null = null;

    if (preset === "custom") {
      if (!customFrom || !customTo) {
        setGenerateError("Please select both a start and end date.");
        return;
      }
      date_from = customFrom;
      date_to = customTo;
    } else {
      const range = computePresetRange(preset);
      date_from = range.from;
      date_to = range.to;
    }

    if (!date_from || !date_to) {
      setGenerateError("Please provide a valid date range.");
      return;
    }

    setGenerating(true);
    try {
      const res = await fetch("/api/reports/behavior-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date_from, date_to }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        id?: string;
        created_at?: string;
        report_data?: BehaviorAnalysisReportData;
        message?: string;
      };
      if (!res.ok || !data.id || !data.created_at || !data.report_data) {
        const msg = data.message ?? "Could not generate behavior analysis.";
        setGenerateError(msg);
        showErrorToast(msg);
        return;
      }

      const newReport: BehaviorAnalysisReport = {
        id: data.id,
        date_from,
        date_to,
        created_at: data.created_at,
        report_data: data.report_data,
      };

      setReports((prev) => [newReport, ...prev]);
      setActiveReport(newReport);
      setModalOpen(false);
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Could not generate behavior analysis.";
      setGenerateError(msg);
      showErrorToast(msg);
    } finally {
      setGenerating(false);
    }
  }

  const friendlyGenerateError =
    generateError != null && generateError.trim() !== ""
      ? (() => {
          const lower = generateError.toLowerCase();
          if (
            lower.includes("insufficient") ||
            lower.includes("no data") ||
            lower.includes("not enough data")
          ) {
            return
              "No activity found in this date range. Try selecting a longer period or generate the report after logging more messages, expenses, or incidents.";
          }
          return "Unable to generate report right now. Please try again.";
        })()
      : null;

  return (
    <div className="space-y-4">
      <Card className="border border-[#E8E4DC] bg-[#FDFBF7] shadow-sm rounded-xl">
        <CardHeader className="pb-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#EEF2E9] text-[#5B7A52]">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <CardTitle className="font-heading text-base text-[#3D3D3D]">
                Co-Parent Behavior Analysis
              </CardTitle>
              <CardDescription className="mt-1 text-xs text-foreground-secondary">
                AI-generated analysis of communication patterns, financial compliance, and schedule
                consistency.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex-1 space-y-3">
            <p className="text-[11px] text-foreground-secondary md:max-w-md">
              Sage reviews your case history privately and surfaces patterns that may help you prepare
              for difficult conversations or legal proceedings. Only you can see this analysis.
            </p>
            <div className="space-y-2">
              <Label className="text-[11px] text-foreground-secondary">
                Date range
              </Label>
              <div className="flex flex-wrap gap-2">
                {[
                  { id: "30", label: "Last 30 days" },
                  { id: "90", label: "Last 90 days" },
                  { id: "180", label: "Last 180 days" },
                  { id: "custom", label: "Custom range" },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={cn(
                      "rounded-full px-3 py-1.5 text-xs border transition-colors",
                      preset === opt.id
                        ? "border-[#7C8B6E] bg-[#F2F5EF] text-[#5B7A52]"
                        : "border-[#E8E4DC] bg-white text-foreground hover:bg-[#F7F3EA]"
                    )}
                    onClick={() => setPreset(opt.id as RangePreset)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {preset === "custom" && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-[11px] text-foreground-secondary">
                      From
                    </Label>
                    <Input
                      type="date"
                      value={customFrom}
                      onChange={(e) => setCustomFrom(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-foreground-secondary">
                      To
                    </Label>
                    <Input
                      type="date"
                      value={customTo}
                      onChange={(e) => setCustomTo(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="rounded-full bg-[#5B7A52] text-white hover:bg-[#476242] text-xs"
              onClick={() => setModalOpen(true)}
            >
              Generate Analysis
            </Button>
          </div>
        </CardContent>
      </Card>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-3"
          onClick={(e) => {
            if (e.target === e.currentTarget && !generating) {
              setModalOpen(false);
            }
          }}
        >
          <div className="w-full max-w-[420px] rounded-2xl border border-[#E8E4DC] bg-[#FDFBF7] p-4 shadow-card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-heading text-base font-semibold text-[#3D3D3D]">
                  Generate Co-Parent Behavior Analysis
                </h2>
                <p className="mt-1 text-[11px] text-[#8A8A8A]">
                  Choose the period you’d like Sage to review. Longer ranges may take a bit longer.
                </p>
              </div>
            </div>

            {generating ? (
              <div className="mt-6 flex flex-col items-center justify-center gap-3 py-6">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#7B9E87] border-t-transparent" />
                <p className="text-sm text-foreground">
                  Sage is reviewing your history…
                </p>
              </div>
            ) : (
              <>
                <div className="mt-4 space-y-3">
                  <div className="space-y-1">
                    <Label className="text-[11px] text-foreground-secondary">
                      Date range
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { id: "30", label: "Last 30 days" },
                        { id: "90", label: "Last 90 days" },
                        { id: "180", label: "Last 180 days" },
                        { id: "custom", label: "Custom range" },
                      ].map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          className={cn(
                            "rounded-full px-3 py-1.5 text-xs border transition-colors",
                            preset === opt.id
                              ? "border-[#7C8B6E] bg-[#F2F5EF] text-[#5B7A52]"
                              : "border-[#E8E4DC] bg-white text-foreground hover:bg-[#F7F3EA]"
                          )}
                          onClick={() => setPreset(opt.id as RangePreset)}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {preset === "custom" && (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-[11px] text-foreground-secondary">From</Label>
                        <Input
                          type="date"
                          value={customFrom}
                          onChange={(e) => setCustomFrom(e.target.value)}
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-foreground-secondary">To</Label>
                        <Input
                          type="date"
                          value={customTo}
                          onChange={(e) => setCustomTo(e.target.value)}
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>
                  )}

                  {friendlyGenerateError && (
                    <p className="mt-1 text-[11px] text-[#C97B7B]">
                      {friendlyGenerateError}
                    </p>
                  )}
                </div>

                <div className="mt-5 flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-full text-xs"
                    onClick={() => setModalOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 rounded-full text-xs bg-[#5B7A52] hover:bg-[#476242] text-white"
                    onClick={() => void handleGenerate()}
                  >
                    Generate
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {activeReport && (
        <BehaviorAnalysisReportView
          report={activeReport}
          onClose={() => setActiveReport(null)}
        />
      )}
    </div>
  );
}

