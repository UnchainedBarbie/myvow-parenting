"use client";

import { useEffect, useMemo, useState } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { RECORD_CATEGORIES } from "@/lib/record/record-categories";

type DatePreset = "all" | "30" | "90" | "180" | "custom";
type ReportLayout = "table" | "transcript";

type ConversationOption = { id: string; subject: string };

const LAYOUTS: { id: ReportLayout; label: string }[] = [
  { id: "table", label: "Chronological Table" },
  { id: "transcript", label: "Conversation Transcript" },
];

const DATE_PRESETS: { id: DatePreset; label: string }[] = [
  { id: "all", label: "All time" },
  { id: "30", label: "Last 30 days" },
  { id: "90", label: "Last 90 days" },
  { id: "180", label: "Last 180 days" },
  { id: "custom", label: "Custom range" },
];

const fieldClass =
  "h-9 w-full rounded-md border border-[#E8E4DC] bg-white px-2 text-sm text-[#3D3D3D] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5B7A52]";

export function CommunicationRecordConfig({ caseId }: { caseId: string }) {
  const [preset, setPreset] = useState<DatePreset>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [category, setCategory] = useState("all");
  const [conversationId, setConversationId] = useState("all");
  const [direction, setDirection] = useState("all");
  const [search, setSearch] = useState("");
  const [attachmentsOnly, setAttachmentsOnly] = useState(false);
  const [layout, setLayout] = useState<ReportLayout>("table");
  const [includeFiles, setIncludeFiles] = useState(true);
  const [exportFormat, setExportFormat] = useState<"pdf" | "csv">("pdf");
  const [busy, setBusy] = useState<"pdf" | "csv" | null>(null);
  const [downloadError, setDownloadError] = useState("");
  const [conversations, setConversations] = useState<ConversationOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/messages/conversations")
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as {
          conversations?: { id?: string; subject?: string | null }[];
        };
      })
      .then((data) => {
        if (cancelled || !data) return;
        const options = (data.conversations ?? [])
          .map((conversation) => ({
            id: conversation.id ?? "",
            subject: conversation.subject?.trim() || "Untitled conversation",
          }))
          .filter((conversation) => conversation.id)
          .sort((a, b) => a.subject.localeCompare(b.subject) || a.id.localeCompare(b.id));
        setConversations(options);
      })
      .catch(() => {
        if (!cancelled) setConversations([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const customReady = preset !== "custom" || (from !== "" && to !== "");

  function localRange(days: number) {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    const iso = (date: Date) => date.toISOString().slice(0, 10);
    return { start: iso(start), end: iso(end) };
  }

  function choosePreset(next: DatePreset) {
    setPreset(next);
    if (next === "all") {
      setFrom("");
      setTo("");
      return;
    }
    if (next === "custom") return;
    const days = next === "30" ? 30 : next === "90" ? 90 : 180;
    const range = localRange(days);
    setFrom(range.start);
    setTo(range.end);
  }

  const filterParams = useMemo(() => {
    const params = new URLSearchParams();
    if (preset !== "all") params.set("range", preset);
    if (preset === "custom") {
      if (from) params.set("from", from);
      if (to) params.set("to", to);
    }
    if (category !== "all") params.set("category", category);
    if (conversationId !== "all") params.set("conversation", conversationId);
    if (direction !== "all") params.set("direction", direction);
    const query = search.trim();
    if (query) params.set("q", query);
    if (attachmentsOnly) params.set("attachments", "1");
    return params;
  }, [attachmentsOnly, category, conversationId, direction, from, preset, search, to]);

  const href = useMemo(() => {
    const qs = filterParams.toString();
    return `/cases/${caseId}/record${qs ? `?${qs}` : ""}`;
  }, [caseId, filterParams]);

  async function download(format: "pdf" | "csv") {
    if (!customReady || busy) return;
    setBusy(format);
    setDownloadError("");
    try {
      const params = new URLSearchParams(filterParams);
      params.set("case_id", caseId);
      params.set("format", format);
      params.set("layout", layout);
      params.set("include_attachments", format === "pdf" && includeFiles ? "1" : "0");
      if (format === "pdf") params.set("store", "1");
      const response = await fetch(`/api/reports/communication-record?${params.toString()}`);
      if (!response.ok) {
        setDownloadError("The export could not be created.");
        return;
      }
      if (format === "pdf") {
        const data = (await response.json().catch(() => ({}))) as {
          export_id?: string;
          warnings?: string[];
          has_bundle?: boolean;
        };
        if (!data.export_id) {
          setDownloadError("The export could not be created.");
          return;
        }
        if (data.warnings && data.warnings.length > 0) {
          sessionStorage.setItem(`report-warnings:${data.export_id}`, JSON.stringify(data.warnings));
          setDownloadError(data.warnings[0] ?? "Some supporting files could not be included.");
        }
        const preview = window.open(
          `/reports/preview/${data.export_id}${data.has_bundle ? "?bundle=1" : ""}`,
          "_blank"
        );
        if (!preview) {
          setDownloadError("The preview tab was blocked. Allow popups for this site, then generate the report again.");
        }
        return;
      }
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = match?.[1] || "Communication-Record.csv";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      setDownloadError("The export could not be created.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-5 space-y-4">
      <div className="space-y-2">
        <Label className="text-xs font-medium text-[#3D3D3D]">Report layout</Label>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Report layout">
          {LAYOUTS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={layout === option.id}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs transition-colors",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5B7A52]",
                layout === option.id
                  ? "border-[#7C8B6E] bg-[#F2F5EF] text-[#5B7A52]"
                  : "border-[#E8E4DC] bg-white text-foreground hover:bg-[#F7F3EA]"
              )}
              onClick={() => setLayout(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs font-medium text-[#3D3D3D]">Date range</Label>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Date range">
          {DATE_PRESETS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={preset === option.id}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs transition-colors",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5B7A52]",
                preset === option.id
                  ? "border-[#7C8B6E] bg-[#F2F5EF] text-[#5B7A52]"
                  : "border-[#E8E4DC] bg-white text-foreground hover:bg-[#F7F3EA]"
              )}
                onClick={() => choosePreset(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="record-from" className="text-[11px] text-foreground-secondary">
              From
            </Label>
            <input
              id="record-from"
              type="date"
              value={from}
              onChange={(event) => {
                setPreset("custom");
                setFrom(event.target.value);
              }}
              className={fieldClass}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="record-to" className="text-[11px] text-foreground-secondary">
              To
            </Label>
            <input
              id="record-to"
              type="date"
              value={to}
              onChange={(event) => {
                setPreset("custom");
                setTo(event.target.value);
              }}
              className={fieldClass}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="record-category" className="text-xs font-medium text-[#3D3D3D]">
            Category
          </Label>
          <select
            id="record-category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className={fieldClass}
          >
            <option value="all">All Categories</option>
            {RECORD_CATEGORIES.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="record-conversation" className="text-xs font-medium text-[#3D3D3D]">
            Subject / Conversation
          </Label>
          <select
            id="record-conversation"
            value={conversationId}
            onChange={(event) => setConversationId(event.target.value)}
            className={fieldClass}
          >
            <option value="all">All Conversations</option>
            {conversations.map((conversation) => (
              <option key={conversation.id} value={conversation.id}>
                {conversation.subject}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="record-direction" className="text-xs font-medium text-[#3D3D3D]">
            Direction
          </Label>
          <select
            id="record-direction"
            value={direction}
            onChange={(event) => setDirection(event.target.value)}
            className={fieldClass}
          >
            <option value="all">All Messages</option>
            <option value="sent">Sent by Me</option>
            <option value="received">Received from Co-Parent</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="record-search" className="text-xs font-medium text-[#3D3D3D]">
            Search Messages
          </Label>
          <input
            id="record-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Keyword"
            className={fieldClass}
          />
        </div>
      </div>

      <label htmlFor="record-attachments" className="flex items-start gap-2 text-sm text-foreground">
        <input
          id="record-attachments"
          type="checkbox"
          checked={attachmentsOnly}
          onChange={(event) => setAttachmentsOnly(event.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 rounded border-[#E8E4DC] text-[#5B7A52] focus:ring-[#5B7A52]"
        />
        Only messages with attachments
      </label>

      <div className="space-y-1">
        <label
          htmlFor="record-include-files"
          className={`flex items-start gap-2 text-sm ${exportFormat === "csv" ? "cursor-not-allowed text-[#9A9A9A]" : "text-foreground"}`}
        >
          <input
            id="record-include-files"
            type="checkbox"
            checked={exportFormat === "csv" ? false : includeFiles}
            disabled={exportFormat === "csv"}
            onChange={(event) => {
              if (exportFormat === "csv") return;
              setIncludeFiles(event.target.checked);
            }}
            className={`mt-0.5 h-3.5 w-3.5 rounded border-[#E8E4DC] text-[#5B7A52] focus:ring-[#5B7A52] ${exportFormat === "csv" ? "cursor-not-allowed opacity-40" : ""}`}
          />
          Include attachment files in the PDF
        </label>
        {exportFormat === "csv" ? (
          <p className="text-xs text-[#6B6B6B]">Attachments are available in PDF exports only.</p>
        ) : null}
      </div>

      <div className="space-y-1">
        <Label htmlFor="record-format" className="text-xs font-medium text-[#3D3D3D]">
          Export format
        </Label>
        <select
          id="record-format"
          value={exportFormat}
          onChange={(event) => setExportFormat(event.target.value === "csv" ? "csv" : "pdf")}
          className="h-9 rounded-md border border-[#E8E4DC] bg-white px-2 text-sm text-[#3D3D3D]"
        >
          <option value="pdf">PDF</option>
          <option value="csv">CSV</option>
        </select>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!customReady || busy !== null}
          onClick={() => void download(exportFormat)}
          className="inline-flex h-9 items-center justify-center rounded-full bg-[#5B7A52] px-5 text-sm text-white hover:bg-[#476242] disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5B7A52]"
        >
          {busy !== null ? "Generating report…" : "Generate Report"}
        </button>
        {customReady ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center justify-center rounded-full border border-[#5B7A52] bg-white px-5 text-sm text-[#5B7A52] hover:bg-[#F2F5EF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5B7A52]"
          >
            View Record
          </a>
        ) : (
          <button
            type="button"
            disabled
            className="inline-flex h-9 items-center justify-center rounded-full border border-[#5B7A52] bg-white px-5 text-sm text-[#5B7A52] opacity-50"
          >
            View Record
          </button>
        )}
      </div>
      {downloadError ? <p className="text-sm text-[#8C3A3A]">{downloadError}</p> : null}
    </div>
  );
}
