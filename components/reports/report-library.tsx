"use client";

import { Fragment, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import {
  Calendar,
  ChevronRight,
  DollarSign,
  FileText,
  MessageSquare,
  ScrollText,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { showErrorToast, showSuccessToast } from "@/components/ui/toaster";
import { CoParentBehaviorAnalysis } from "@/components/reports/coparent-behavior-analysis";

type Preset = "30" | "90" | "180" | "custom";

type DateConfig = {
  preset: Preset;
  start: string;
  end: string;
};

type OptionDef = { id: string; label: string; default: boolean };

type GeneratedReport = {
  id: "communication_report" | "expense_report" | "calendar_report" | "document_index";
  title: string;
  description: string;
  icon: LucideIcon;
  group: "filing" | "private";
  hasDateRange: boolean;
  options: OptionDef[];
  formats: readonly string[];
};

const GENERATED_REPORTS: GeneratedReport[] = [
  {
    id: "expense_report",
    title: "Expense Report",
    description: "Shared expenses, payments, disputes, and balances.",
    icon: DollarSign,
    group: "filing",
    hasDateRange: true,
    options: [
      { id: "all_expenses", label: "All expenses with details", default: true },
      { id: "payment_records", label: "Payment records", default: true },
      { id: "dispute_history", label: "Dispute history", default: true },
      { id: "net_balance", label: "Net balance summary", default: true },
      { id: "receipts_zip", label: "Receipts (attached as separate files in zip)", default: true },
    ],
    formats: ["pdf", "csv"],
  },
  {
    id: "calendar_report",
    title: "Calendar & Custody Report",
    description: "Custody schedules, exchanges, and calendar events.",
    icon: Calendar,
    group: "filing",
    hasDateRange: true,
    options: [
      { id: "custody_schedule", label: "Custody schedule", default: true },
      { id: "schedule_changes", label: "Schedule changes/swaps", default: true },
      { id: "missed_pickups", label: "Missed pickups/dropoffs (if logged)", default: true },
      { id: "events_by_child", label: "Calendar events by child", default: true },
    ],
    formats: ["pdf"],
  },
  {
    id: "document_index",
    title: "Document Index",
    description: "Filed documents, categories, and linked records.",
    icon: FileText,
    group: "filing",
    hasDateRange: false,
    options: [
      { id: "document_list", label: "Document list with categories and dates", default: true },
      { id: "linked_conversations", label: "Linked conversations", default: true },
      { id: "include_documents_zip", label: "Include actual documents (zip bundle)", default: false },
    ],
    formats: ["pdf"],
  },
  {
    id: "communication_report",
    title: "Message Analysis",
    description: "Message timelines, tone classifications, and thread summaries.",
    icon: MessageSquare,
    group: "private",
    hasDateRange: true,
    options: [
      { id: "message_timeline", label: "Message timeline", default: true },
      { id: "tone_classifications", label: "Tone classifications per message", default: false },
      { id: "thread_summaries", label: "Thread summaries", default: false },
    ],
    formats: ["pdf"],
  },
];

const COMMUNICATION_RECORD = {
  id: "communication_record",
  title: "Communication Record",
  description: "Messages exchanged between parents, without Sage analysis.",
  icon: ScrollText,
} as const;

const BEHAVIOR = {
  id: "behavior_analysis",
  title: "Co-Parent Behavior Analysis",
  description:
    "Sage's analysis of communication patterns, financial compliance, and schedule consistency.",
  icon: Sparkles,
} as const;

type ReportId =
  | typeof COMMUNICATION_RECORD.id
  | typeof BEHAVIOR.id
  | GeneratedReport["id"];

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

function rangeFor(preset: Exclude<Preset, "custom">): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  const days = preset === "30" ? 30 : preset === "90" ? 90 : 180;
  start.setDate(start.getDate() - days);
  return { start: isoDay(start), end: isoDay(end) };
}

function initialDates(): Record<string, DateConfig> {
  const base = rangeFor("90");
  const config: DateConfig = { preset: "90", ...base };
  return {
    communication_report: { ...config },
    expense_report: { ...config },
    calendar_report: { ...config },
  };
}

const PRESETS: { id: Preset; label: string }[] = [
  { id: "30", label: "Last 30 days" },
  { id: "90", label: "Last 90 days" },
  { id: "180", label: "Last 180 days" },
  { id: "custom", label: "Custom range" },
];

export function ReportLibrary({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [selected, setSelected] = useState<ReportId>(COMMUNICATION_RECORD.id);
  const [generating, setGenerating] = useState<string | null>(null);
  const [dates, setDates] = useState(initialDates);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, Record<string, boolean>>>({});
  const [format, setFormat] = useState<Record<string, string>>({});

  const generatedById = useMemo(
    () => new Map(GENERATED_REPORTS.map((report) => [report.id, report])),
    []
  );

  function datesFor(reportId: string): DateConfig {
    return dates[reportId] ?? { preset: "90", ...rangeFor("90") };
  }

  function setPreset(reportId: string, preset: Preset) {
    setDates((prev) => {
      const current = prev[reportId] ?? { preset: "90", ...rangeFor("90") };
      if (preset === "custom") return { ...prev, [reportId]: { ...current, preset } };
      return { ...prev, [reportId]: { preset, ...rangeFor(preset) } };
    });
  }

  function setDateField(reportId: string, field: "start" | "end", value: string) {
    setDates((prev) => {
      const current = prev[reportId] ?? { preset: "90" as Preset, ...rangeFor("90") };
      return { ...prev, [reportId]: { ...current, preset: "custom", [field]: value } };
    });
  }

  function isOptionChecked(reportId: string, optionId: string, defaultValue: boolean) {
    const stored = selectedOptions[reportId]?.[optionId];
    return stored === undefined ? defaultValue : stored;
  }

  function setOption(reportId: string, optionId: string, value: boolean) {
    setSelectedOptions((prev) => ({
      ...prev,
      [reportId]: { ...(prev[reportId] ?? {}), [optionId]: value },
    }));
  }

  function getFormat(reportId: string, formats: readonly string[]) {
    return format[reportId] ?? formats[0];
  }

  async function handleGenerate(report: GeneratedReport) {
    setGenerating(report.id);
    try {
      const range = report.hasDateRange ? datesFor(report.id) : null;
      const res = await fetch("/api/reports/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          case_id: caseId,
          report_type: report.id,
          format: getFormat(report.id, report.formats),
          date_range_start: range?.start,
          date_range_end: range?.end,
          options: report.options.reduce(
            (acc, opt) => {
              acc[opt.id] = isOptionChecked(report.id, opt.id, opt.default);
              return acc;
            },
            {} as Record<string, boolean>
          ),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        export_id?: string;
        download_url?: string;
        message?: string;
      };
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

  const rows: { kind: "heading" | "note" | "report"; id: string; order: number }[] = [
    { kind: "heading", id: "filing", order: 10 },
    { kind: "report", id: COMMUNICATION_RECORD.id, order: 20 },
    { kind: "report", id: "expense_report", order: 30 },
    { kind: "report", id: "calendar_report", order: 40 },
    { kind: "report", id: "document_index", order: 50 },
    { kind: "heading", id: "private", order: 60 },
    { kind: "note", id: "private-note", order: 70 },
    { kind: "report", id: BEHAVIOR.id, order: 80 },
    { kind: "report", id: "communication_report", order: 90 },
  ];
  return (
    <>
      <style>{`
        @media (min-width: 1024px) {
          .report-library {
            display: grid;
            grid-template-columns: minmax(17rem, 22rem) minmax(0, 1fr);
            column-gap: 1.75rem;
            row-gap: 0.25rem;
            align-items: start;
          }
          .report-library .lib-row,
          .report-library .lib-panel { order: 0 !important; }
          .report-library .lib-row { grid-column: 1; }
          .report-library .lib-panel {
            grid-column: 2;
            grid-row: 1 / span 16;
          }
        }
      `}</style>
      <div className="report-library flex flex-col gap-1">
      <nav aria-label="Report library" className="contents">
        {rows.map((row) => {
          if (row.kind === "heading") {
            return (
              <h2
                key={row.id}
                style={{ order: row.order }}
                className={cn(
                  "lib-row font-heading px-1 text-sm font-semibold text-foreground",
                  row.id === "private" ? "mt-5" : "mt-0"
                )}
              >
                {row.id === "filing" ? "For filing" : "Private analysis"}
              </h2>
            );
          }
          if (row.kind === "note") {
            return (
              <p
                key={row.id}
                style={{ order: row.order }}
                className="lib-row mb-1 px-1 text-xs leading-relaxed text-foreground-secondary"
              >
                These reports contain Sage&apos;s interpretations and are intended for your personal
                preparation, not as factual communication records.
              </p>
            );
          }
          const meta = reportMeta(row.id);
          const Icon = meta.icon;
          const isSelected = selected === row.id;
          const panelId = `report-config-${row.id}`;
          return (
            <Fragment key={row.id}>
              <button
                type="button"
                style={{ order: row.order }}
                aria-pressed={isSelected}
                aria-expanded={isSelected}
                aria-controls={panelId}
                onClick={() => setSelected(row.id as ReportId)}
                className={cn(
                  "lib-row flex w-full items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5B7A52]",
                  isSelected
                    ? "border-[#C5D1BC] bg-[#F2F5EF]"
                    : "border-transparent hover:bg-[#F7F3EA]"
                )}
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#5B7A52]" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-[#3D3D3D]">{meta.title}</span>
                  <span className="mt-0.5 block text-xs leading-snug text-foreground-secondary">
                    {meta.description}
                  </span>
                </span>
                <ChevronRight
                  className={cn(
                    "mt-0.5 h-4 w-4 shrink-0 text-[#8A8A8A] transition-transform",
                    isSelected && "rotate-90 text-[#5B7A52] lg:rotate-0"
                  )}
                  aria-hidden
                />
              </button>
              <div
                id={panelId}
                style={{ order: row.order + 1 }}
                hidden={!isSelected}
                className={cn("lib-panel min-w-0 pt-2 lg:pt-0", !isSelected && "hidden")}
              >
                <ConfigPanel
                  selected={row.id as ReportId}
                  caseId={caseId}
                  generatedById={generatedById}
                  datesFor={datesFor}
                  setPreset={setPreset}
                  setDateField={setDateField}
                  isOptionChecked={isOptionChecked}
                  setOption={setOption}
                  getFormat={getFormat}
                  setFormat={setFormat}
                  generating={generating}
                  onGenerate={(report) => void handleGenerate(report)}
                />
              </div>
            </Fragment>
          );
        })}
      </nav>
    </div>
    </>
  );
}

function reportMeta(id: string): { title: string; description: string; icon: LucideIcon } {
  if (id === COMMUNICATION_RECORD.id) return COMMUNICATION_RECORD;
  if (id === BEHAVIOR.id) return BEHAVIOR;
  const report = GENERATED_REPORTS.find((item) => item.id === id);
  return report ?? COMMUNICATION_RECORD;
}

function ConfigPanel({
  selected,
  caseId,
  generatedById,
  datesFor,
  setPreset,
  setDateField,
  isOptionChecked,
  setOption,
  getFormat,
  setFormat,
  generating,
  onGenerate,
}: {
  selected: ReportId;
  caseId: string;
  generatedById: Map<GeneratedReport["id"], GeneratedReport>;
  datesFor: (reportId: string) => DateConfig;
  setPreset: (reportId: string, preset: Preset) => void;
  setDateField: (reportId: string, field: "start" | "end", value: string) => void;
  isOptionChecked: (reportId: string, optionId: string, defaultValue: boolean) => boolean;
  setOption: (reportId: string, optionId: string, value: boolean) => void;
  getFormat: (reportId: string, formats: readonly string[]) => string;
  setFormat: Dispatch<SetStateAction<Record<string, string>>>;
  generating: string | null;
  onGenerate: (report: GeneratedReport) => void;
}) {
  const meta = reportMeta(selected);
  const Icon = meta.icon;
  const generated = generatedById.get(selected as GeneratedReport["id"]);
  const titleId = `report-config-title-${selected}`;

  return (
    <section
      aria-labelledby={titleId}
      className="rounded-xl border border-[#E8E4DC] bg-[#FDFBF7] p-4 sm:p-5"
    >
      <header className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#EEF2E9] text-[#5B7A52]">
          <Icon className="h-4 w-4" aria-hidden />
        </div>
        <div className="min-w-0">
          <h3 id={titleId} className="font-heading text-base font-semibold text-[#3D3D3D]">
            {meta.title}
          </h3>
          <p className="mt-1 text-sm leading-snug text-foreground-secondary">{meta.description}</p>
        </div>
      </header>

      {selected === COMMUNICATION_RECORD.id ? (
        <div className="mt-5 space-y-4">
          <p className="text-sm leading-relaxed text-foreground-secondary">
            This opens the communication record for the case. It lists messages exchanged between
            the parents and does not include Sage analysis. You can review it and print or save it
            from that page.
          </p>
          <a
            href={`/cases/${caseId}/record`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center justify-center rounded-full bg-[#5B7A52] px-5 text-sm text-white hover:bg-[#476242] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5B7A52]"
          >
            View Record
          </a>
        </div>
      ) : null}

      {selected === BEHAVIOR.id ? (
        <div className="mt-5">
          <CoParentBehaviorAnalysis embedded />
        </div>
      ) : null}

      {generated ? (
        <GeneratedConfig
          report={generated}
          dates={generated.hasDateRange ? datesFor(generated.id) : null}
          setPreset={setPreset}
          setDateField={setDateField}
          isOptionChecked={isOptionChecked}
          setOption={setOption}
          format={getFormat(generated.id, generated.formats)}
          formats={generated.formats}
          onFormat={(value) => setFormat((prev) => ({ ...prev, [generated.id]: value }))}
          generating={generating === generated.id}
          disabled={generating !== null}
          onGenerate={() => onGenerate(generated)}
        />
      ) : null}
    </section>
  );
}

function GeneratedConfig({
  report,
  dates,
  setPreset,
  setDateField,
  isOptionChecked,
  setOption,
  format,
  formats,
  onFormat,
  generating,
  disabled,
  onGenerate,
}: {
  report: GeneratedReport;
  dates: DateConfig | null;
  setPreset: (reportId: string, preset: Preset) => void;
  setDateField: (reportId: string, field: "start" | "end", value: string) => void;
  isOptionChecked: (reportId: string, optionId: string, defaultValue: boolean) => boolean;
  setOption: (reportId: string, optionId: string, value: boolean) => void;
  format: string;
  formats: readonly string[];
  onFormat: (value: string) => void;
  generating: boolean;
  disabled: boolean;
  onGenerate: () => void;
}) {
  return (
    <div className="mt-5 space-y-5">
      {dates ? (
        <div className="space-y-2">
          <Label className="text-xs font-medium text-[#3D3D3D]">Date range</Label>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Date range">
            {PRESETS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                aria-pressed={dates.preset === opt.id}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs transition-colors",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5B7A52]",
                  dates.preset === opt.id
                    ? "border-[#7C8B6E] bg-[#F2F5EF] text-[#5B7A52]"
                    : "border-[#E8E4DC] bg-white text-foreground hover:bg-[#F7F3EA]"
                )}
                onClick={() => setPreset(report.id, opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor={`${report.id}-from`} className="text-[11px] text-foreground-secondary">
                From
              </Label>
              <input
                id={`${report.id}-from`}
                type="date"
                value={dates.start}
                onChange={(e) => setDateField(report.id, "start", e.target.value)}
                className="h-9 w-full rounded-md border border-[#E8E4DC] bg-white px-2 text-sm text-[#3D3D3D]"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${report.id}-to`} className="text-[11px] text-foreground-secondary">
                To
              </Label>
              <input
                id={`${report.id}-to`}
                type="date"
                value={dates.end}
                onChange={(e) => setDateField(report.id, "end", e.target.value)}
                className="h-9 w-full rounded-md border border-[#E8E4DC] bg-white px-2 text-sm text-[#3D3D3D]"
              />
            </div>
          </div>
        </div>
      ) : null}

      {report.options.length > 0 ? (
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-[#3D3D3D]">Include</legend>
          <ul className="space-y-2">
            {report.options.map((opt) => {
              const inputId = `${report.id}-${opt.id}`;
              return (
                <li key={opt.id} className="flex items-start gap-2">
                  <input
                    id={inputId}
                    type="checkbox"
                    checked={isOptionChecked(report.id, opt.id, opt.default)}
                    onChange={(e) => setOption(report.id, opt.id, e.target.checked)}
                    className="mt-0.5 h-3.5 w-3.5 rounded border-[#E8E4DC] text-[#5B7A52] focus:ring-[#5B7A52]"
                  />
                  <label htmlFor={inputId} className="text-sm text-foreground">
                    {opt.label}
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ) : null}

      <div className="space-y-1">
        <Label htmlFor={`${report.id}-format`} className="text-xs font-medium text-[#3D3D3D]">
          Export
        </Label>
        <select
          id={`${report.id}-format`}
          value={format}
          onChange={(e) => onFormat(e.target.value)}
          className="h-9 rounded-md border border-[#E8E4DC] bg-white px-2 text-sm text-[#3D3D3D]"
        >
          {formats.map((item) => (
            <option key={item} value={item}>
              {item.toUpperCase()}
            </option>
          ))}
        </select>
      </div>

      <Button
        type="button"
        size="sm"
        className="rounded-full bg-[#5B7A52] px-5 text-white hover:bg-[#476242]"
        disabled={disabled}
        aria-busy={generating}
        onClick={onGenerate}
      >
        {generating ? "Generating report…" : "Generate Report"}
      </Button>
    </div>
  );
}
