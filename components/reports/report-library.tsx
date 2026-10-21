"use client";

import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import {
  Calendar,
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
import { CommunicationRecordConfig } from "@/components/reports/communication-record-config";

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
      { id: "receipts_zip", label: "Include receipts in the PDF", default: true },
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
      { id: "include_event_files", label: "Include event attachments in the PDF", default: false },
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
      { id: "include_documents_zip", label: "Include document files in the PDF", default: false },
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
        warnings?: string[];
        has_bundle?: boolean;
        preview?: boolean;
      };
      if (!res.ok) {
        showErrorToast(data.message ?? "Report generation failed.");
        return;
      }
      if (data.warnings && data.warnings.length > 0) {
        showErrorToast(data.warnings[0] ?? "Some supporting files could not be included.");
      } else {
        showSuccessToast("Report generated.");
      }
      if (data.export_id && data.preview) {
        if (data.warnings && data.warnings.length > 0) {
          sessionStorage.setItem(`report-warnings:${data.export_id}`, JSON.stringify(data.warnings));
        }
        const preview = window.open(
          `/reports/preview/${data.export_id}${data.has_bundle ? "?bundle=1" : ""}`,
          "_blank"
        );
        if (!preview) {
          showErrorToast("The preview tab was blocked. Allow popups for this site, then generate the report again.");
        }
      } else if (data.export_id) {
        window.open(`/api/reports/download/${data.export_id}`, "_blank");
      } else if (data.download_url) {
        window.open(data.download_url, "_blank");
      }
      router.refresh();
    } finally {
      setGenerating(null);
    }
  }

  const isPrivate = selected === BEHAVIOR.id || selected === "communication_report";

  return (
    <div className="w-full max-w-[900px] space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="select-report" className="text-xs font-medium text-[#3D3D3D]">
          Select Report
        </Label>
        <select
          id="select-report"
          value={selected}
          aria-controls={`report-config-${selected}`}
          onChange={(e) => setSelected(e.target.value as ReportId)}
          className="h-10 w-full rounded-md border border-[#E8E4DC] bg-white px-3 text-sm text-[#3D3D3D] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5B7A52]"
        >
          <optgroup label="For Filing">
            <option value={COMMUNICATION_RECORD.id}>{COMMUNICATION_RECORD.title}</option>
            <option value="expense_report">Expense Report</option>
            <option value="calendar_report">Calendar & Custody Report</option>
            <option value="document_index">Document Index</option>
          </optgroup>
          <optgroup label="Private Analysis">
            <option value={BEHAVIOR.id}>{BEHAVIOR.title}</option>
            <option value="communication_report">Message Analysis</option>
          </optgroup>
        </select>
      </div>

      {isPrivate ? (
        <p className="text-xs leading-relaxed text-foreground-secondary">
          These reports contain Sage&apos;s interpretations and are intended for your personal
          preparation, not as factual communication records.
        </p>
      ) : null}

      {REPORT_IDS.map((id) => {
        const isSelected = selected === id;
        return (
          <div
            key={id}
            id={`report-config-${id}`}
            hidden={!isSelected}
            className={cn(!isSelected && "hidden")}
          >
            <ConfigPanel
              selected={id}
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
        );
      })}
    </div>
  );
}

const REPORT_IDS: ReportId[] = [
  COMMUNICATION_RECORD.id,
  "expense_report",
  "calendar_report",
  "document_index",
  BEHAVIOR.id,
  "communication_report",
];

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

      {selected === COMMUNICATION_RECORD.id ? <CommunicationRecordConfig caseId={caseId} /> : null}

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
