"use client";

import { useState } from "react";
import { jsPDF } from "jspdf";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CalendarEventRow } from "@/components/calendar/calendar-month";

type CalendarView = "month" | "list" | "year";

interface CalendarExportButtonProps {
  view: CalendarView;
  year: number;
  month: number;
  /** Events to include in the PDF (use filtered list when exporting from Month/List view). */
  events: CalendarEventRow[];
  /** Optional note shown in PDF header, e.g. "Filtered: This month · Medical · Conflicts only". */
  filterDescription?: string;
}

const MARGIN = 44;
const HEADER_Y = 32;
const HEADER_FONT_SIZE = 16;
const SUBHEADING_FONT_SIZE = 12;
const BODY_FONT_SIZE = 9;
const CONTENT_START = 100;
const FOOTER_MARGIN = 32;

const COLOR_HEADER = "#3D3D3D";
const COLOR_MUTED = "#6B6B6B";
const COLOR_BORDER = "#E0DED8";
const BG_ALT = "#f5f5f0";
const BG_HEADER = "#f0f0eb";
const SAGE_LIGHT = "#EEF2E9";
const SAGE_DOT = { r: 124, g: 139, b: 110 };

function formatDateLabel(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTimeLabel(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function monthName(year: number, month: number) {
  return new Date(year, month - 1, 1).toLocaleString("en-US", {
    month: "long",
  });
}

function drawPageHeader(
  doc: jsPDF,
  options: { title?: string; showTimestamp?: boolean; filterDescription?: string }
) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const now = new Date();
  const generatedAt = now.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(HEADER_FONT_SIZE);
  doc.setTextColor(COLOR_HEADER);
  doc.text("MyVow Parenting", MARGIN, HEADER_Y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(BODY_FONT_SIZE - 1);
  doc.setTextColor(COLOR_MUTED);
  if (options.showTimestamp !== false) {
    doc.text(`Generated ${generatedAt}`, pageWidth - MARGIN, HEADER_Y, {
      align: "right",
    });
  }

  doc.setDrawColor(COLOR_BORDER);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, HEADER_Y + 8, pageWidth - MARGIN, HEADER_Y + 8);

  let contentBottom = HEADER_Y + 8;
  if (options.title) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(SUBHEADING_FONT_SIZE);
    doc.setTextColor(COLOR_HEADER);
    doc.text(options.title, MARGIN, HEADER_Y + 24);
    doc.setDrawColor(COLOR_BORDER);
    doc.line(MARGIN, HEADER_Y + 32, pageWidth - MARGIN, HEADER_Y + 32);
    contentBottom = HEADER_Y + 32;
  }
  if (options.filterDescription) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(BODY_FONT_SIZE - 2);
    doc.setTextColor(COLOR_MUTED);
    doc.text(`Filtered: ${options.filterDescription}`, MARGIN, contentBottom + 12);
    doc.setDrawColor(COLOR_BORDER);
    doc.line(MARGIN, contentBottom + 18, pageWidth - MARGIN, contentBottom + 18);
  }
}

function drawPageFooter(doc: jsPDF, pageIndex?: number, totalPages?: number) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const footerY = pageHeight - FOOTER_MARGIN;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(BODY_FONT_SIZE - 2);
  doc.setTextColor(COLOR_MUTED);
  doc.text("MyVow Parenting — Confidential", pageWidth / 2, footerY, {
    align: "center",
  });
  if (
    totalPages != null &&
    totalPages > 1 &&
    pageIndex != null &&
    pageIndex >= 1
  ) {
    doc.text(`Page ${pageIndex} of ${totalPages}`, pageWidth - MARGIN, footerY, {
      align: "right",
    });
  }
}

export function CalendarExportButton({
  view,
  year,
  month,
  events,
  filterDescription,
}: CalendarExportButtonProps) {
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("landscape");

  async function handleExport(orient: "portrait" | "landscape") {
    const doc = new jsPDF({
      orientation: orient === "landscape" ? "l" : "p",
      unit: "pt",
      format: "letter",
    });
    const pageWidth = doc.internal.pageSize.getWidth();

    let title = "";
    if (view === "month") {
      title = `${monthName(year, month)} ${year} — Month view`;
    } else if (view === "list") {
      title = `${monthName(year, month)} ${year} — List view`;
    } else {
      title = `${year} — Year overview`;
    }

    drawPageHeader(doc, { title, filterDescription });

    if (view === "month") {
      exportMonth(doc, CONTENT_START, year, month, events);
    } else if (view === "list") {
      exportList(doc, pageWidth, CONTENT_START, events);
    } else {
      exportYear(doc, CONTENT_START, year, events);
    }

    const totalPages = doc.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      drawPageFooter(doc, p, totalPages);
    }

    doc.save(
      view === "month"
        ? `calendar-${year}-${String(month).padStart(2, "0")}.pdf`
        : view === "year"
          ? `calendar-${year}.pdf`
          : `calendar-list-${year}-${String(month).padStart(2, "0")}.pdf`
    );
    setExportModalOpen(false);
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        className="h-8 rounded-full text-xs bg-[#7B9E87] hover:bg-[#6A8A78] text-white"
        onClick={() => setExportModalOpen(true)}
      >
        Export PDF
      </Button>
      {exportModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-3"
          onClick={(e) => {
            if (e.target === e.currentTarget) setExportModalOpen(false);
          }}
        >
          <div
            className="w-full max-w-[340px] rounded-2xl border border-[#E8E4DC] bg-[#FDFBF7] p-4 shadow-card"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-heading text-base font-semibold text-[#3D3D3D]">
              Export PDF
            </h2>
            <p className="mt-1 text-[11px] text-[#8A8A8A]">
              Choose page orientation
            </p>
            <div className="mt-4 inline-flex rounded-full border border-[#E8E4DC] bg-[#F5F3EF] p-0.5">
              <button
                type="button"
                onClick={() => setOrientation("portrait")}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                  orientation === "portrait"
                    ? "bg-white text-[#3D3D3D] shadow-sm border border-[#E8E4DC]"
                    : "text-foreground-secondary hover:text-foreground"
                )}
              >
                Portrait
              </button>
              <button
                type="button"
                onClick={() => setOrientation("landscape")}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                  orientation === "landscape"
                    ? "bg-white text-[#3D3D3D] shadow-sm border border-[#E8E4DC]"
                    : "text-foreground-secondary hover:text-foreground"
                )}
              >
                Landscape
              </button>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-full text-xs"
                onClick={() => setExportModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8 rounded-full text-xs bg-[#7B9E87] hover:bg-[#6A8A78] text-white"
                onClick={() => void handleExport(orientation)}
              >
                Download
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function exportMonth(
  doc: jsPDF,
  startY: number,
  year: number,
  month: number,
  events: CalendarEventRow[]
) {
  const gridLeft = MARGIN;
  const gridRight = doc.internal.pageSize.getWidth() - MARGIN;
  const gridWidth = gridRight - gridLeft;
  const colWidth = gridWidth / 7;
  const headerRowH = 18;
  const cellRowH = 38;
  const dayHeaders = ["S", "M", "T", "W", "T", "F", "S"];

  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const today = new Date();
  const isToday =
    today.getFullYear() === year && today.getMonth() + 1 === month;

  const eventsByDay = new Map<number, CalendarEventRow[]>();
  for (const e of events) {
    const d = new Date(e.start_time);
    if (Number.isNaN(d.getTime())) continue;
    if (d.getFullYear() !== year || d.getMonth() + 1 !== month) continue;
    const day = d.getDate();
    if (!eventsByDay.has(day)) eventsByDay.set(day, []);
    eventsByDay.get(day)!.push(e);
  }

  const [br, bg, bb] = hexToRgb(BG_HEADER);
  doc.setFillColor(br, bg, bb);
  doc.rect(gridLeft, startY, gridWidth, headerRowH, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(BODY_FONT_SIZE);
  doc.setTextColor(COLOR_HEADER);
  dayHeaders.forEach((h, i) => {
    doc.text(h, gridLeft + colWidth * i + colWidth / 2, startY + 12, {
      align: "center",
    });
  });

  const rows = Math.ceil((firstDay + daysInMonth) / 7);
  const gridBottom = startY + headerRowH + rows * cellRowH;

  doc.setDrawColor(COLOR_BORDER);
  doc.setLineWidth(0.4);
  for (let c = 0; c <= 7; c++) {
    doc.line(gridLeft + c * colWidth, startY + headerRowH, gridLeft + c * colWidth, gridBottom);
  }
  for (let r = 0; r <= rows; r++) {
    const y = startY + headerRowH + r * cellRowH;
    doc.line(gridLeft, y, gridRight, y);
  }

  const [sr, sg, sb] = hexToRgb(SAGE_LIGHT);
  let day = 1;
  for (let row = 0; row < rows && day <= daysInMonth; row++) {
    for (let col = 0; col < 7 && day <= daysInMonth; col++) {
      const cellIndex = row * 7 + col;
      if (cellIndex < firstDay) continue;

      const x = gridLeft + colWidth * col;
      const cellTop = startY + headerRowH + row * cellRowH;
      const dayY = cellTop + 12;

      const todayCell = isToday && day === today.getDate();
      if (todayCell) {
        doc.setFillColor(sr, sg, sb);
        doc.rect(x + 1, cellTop + 1, colWidth - 2, cellRowH - 2, "F");
      }

      doc.setFont("helvetica", "bold");
      doc.setFontSize(BODY_FONT_SIZE);
      doc.setTextColor(COLOR_HEADER);
      doc.text(String(day), x + 6, dayY);

      const dayEvents = eventsByDay.get(day) ?? [];
      doc.setFont("helvetica", "normal");
      doc.setFontSize(BODY_FONT_SIZE - 2);
      doc.setTextColor(COLOR_MUTED);
      let eventY = cellTop + 22;
      const maxEvents = 3;
      const maxTitleLen = 28;
      for (const ev of dayEvents.slice(0, maxEvents)) {
        const label = ev.title ?? "(event)";
        const truncated =
          label.length > maxTitleLen ? `${label.slice(0, maxTitleLen - 1)}…` : label;
        doc.text(truncated, x + 5, eventY);
        eventY += 9;
      }

      day += 1;
    }
  }
  doc.setTextColor(COLOR_HEADER);
}

const LIST_COLUMNS = [
  { key: "date", label: "Date", w: 72 },
  { key: "event", label: "Event", w: 140 },
  { key: "category", label: "Category", w: 52 },
  { key: "child", label: "Child", w: 56 },
  { key: "status", label: "Status", w: 48 },
] as const;

function exportList(
  doc: jsPDF,
  pageWidth: number,
  startY: number,
  events: CalendarEventRow[]
) {
  const pageHeight = doc.internal.pageSize.getHeight();
  const bottomMargin = FOOTER_MARGIN + 20;
  const rowH = 20;
  const tableLeft = MARGIN;
  const tableWidth = pageWidth - 2 * MARGIN;

  const sorted = [...events].sort((a, b) =>
    String(a.start_time).localeCompare(String(b.start_time))
  );

  const EVENT_TYPE_LABELS: Record<string, string> = {
    medical: "Medical",
    school: "School",
    extracurricular: "Extracurricular",
    custody_exchange: "Custody",
    therapy: "Therapy",
    other: "Other",
  };
  const STATUS_LABELS: Record<string, string> = {
    scheduled: "Scheduled",
    completed: "Completed",
    no_show: "No-show",
    conflict: "Conflict",
    canceled: "Canceled",
  };

  if (sorted.length === 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(BODY_FONT_SIZE);
    doc.setTextColor(COLOR_MUTED);
    doc.text("No events in this range.", MARGIN, startY);
    return;
  }

  let y = startY;
  const [hr, hg, hb] = hexToRgb(BG_HEADER);
  doc.setFillColor(hr, hg, hb);
  doc.rect(tableLeft, y, tableWidth, rowH, "F");
  doc.setDrawColor(COLOR_BORDER);
  doc.setLineWidth(0.4);
  doc.line(tableLeft, y + rowH, tableLeft + tableWidth, y + rowH);

  let x = tableLeft + 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(BODY_FONT_SIZE);
  doc.setTextColor(COLOR_HEADER);
  for (const col of LIST_COLUMNS) {
    doc.text(col.label, x, y + 14);
    x += col.w;
  }
  y += rowH;

  for (let i = 0; i < sorted.length; i++) {
    const ev = sorted[i];
    if (y > pageHeight - bottomMargin) {
      doc.addPage();
      drawPageHeader(doc, { title: undefined, showTimestamp: true });
      y = CONTENT_START;
    }

    const dateStr = formatDateLabel(ev.start_time);
    const title = (ev.title ?? "(event)").slice(0, 36);
    const categoryKey = ev.event_type ?? "";
    const category =
      categoryKey && EVENT_TYPE_LABELS[categoryKey]
        ? EVENT_TYPE_LABELS[categoryKey]
        : categoryKey || "—";
    const childName = ev.child_name ?? "—";
    const statusKey = ev.status ?? "scheduled";
    const status =
      STATUS_LABELS[statusKey] ?? (statusKey.charAt(0).toUpperCase() + statusKey.slice(1));

    if (i % 2 === 1) {
      const [ar, ag, ab] = hexToRgb(BG_ALT);
      doc.setFillColor(ar, ag, ab);
      doc.rect(tableLeft, y, tableWidth, rowH, "F");
    }

    doc.setDrawColor(COLOR_BORDER);
    doc.line(tableLeft, y, tableLeft + tableWidth, y);
    x = tableLeft + 4;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(BODY_FONT_SIZE - 1);
    doc.setTextColor(COLOR_HEADER);
    doc.text(dateStr, x, y + 14);
    x += LIST_COLUMNS[0].w;
    doc.text(title, x, y + 14);
    x += LIST_COLUMNS[1].w;
    doc.setTextColor(COLOR_MUTED);
    doc.text(category, x, y + 14);
    x += LIST_COLUMNS[2].w;
    doc.text(childName, x, y + 14);
    x += LIST_COLUMNS[3].w;
    doc.text(status, x, y + 14);

    doc.line(tableLeft, y + rowH, tableLeft + tableWidth, y + rowH);
    y += rowH;
  }
  doc.setTextColor(COLOR_HEADER);
}

function exportYear(
  doc: jsPDF,
  startY: number,
  year: number,
  events: CalendarEventRow[]
) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const gridWidth = pageWidth - 2 * MARGIN;
  const colWidth = gridWidth / 3;
  const rowHeight = 96;
  const dayHeaders = ["S", "M", "T", "W", "T", "F", "S"];
  const monthTitleH = 14;
  const dayHeaderH = 10;
  const maxRows = 6;
  const cellH = (rowHeight - monthTitleH - dayHeaderH - 4) / maxRows;

  const eventKeys = new Set<string>();
  for (const e of events) {
    const d = new Date(e.start_time);
    if (Number.isNaN(d.getTime())) continue;
    if (d.getFullYear() !== year) continue;
    eventKeys.add(`${d.getMonth() + 1}-${d.getDate()}`);
  }

  doc.setDrawColor(COLOR_BORDER);
  doc.setLineWidth(0.4);

  for (let m = 1; m <= 12; m++) {
    const col = (m - 1) % 3;
    const row = Math.floor((m - 1) / 3);
    const boxLeft = MARGIN + colWidth * col;
    const boxTop = startY + rowHeight * row;

    doc.rect(boxLeft, boxTop, colWidth, rowHeight, "S");

    const monthShort = new Date(year, m - 1, 1).toLocaleString("en-US", {
      month: "short",
    });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(SUBHEADING_FONT_SIZE - 2);
    doc.setTextColor(COLOR_HEADER);
    doc.text(monthShort, boxLeft + 4, boxTop + 10);

    const gridTop = boxTop + monthTitleH;
    const cellW = colWidth / 7;
    const [hr, hg, hb] = hexToRgb(BG_HEADER);
    doc.setFillColor(hr, hg, hb);
    doc.rect(boxLeft + 1, gridTop, colWidth - 2, dayHeaderH, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(BODY_FONT_SIZE - 3);
    doc.setTextColor(COLOR_MUTED);
    dayHeaders.forEach((h, i) => {
      doc.text(h, boxLeft + cellW * i + cellW / 2, gridTop + dayHeaderH / 2 + 2, {
        align: "center",
      });
    });

    const firstDay = new Date(year, m - 1, 1).getDay();
    const daysInMonth = new Date(year, m, 0).getDate();
    const dayGridStart = gridTop + dayHeaderH;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(BODY_FONT_SIZE - 3);
    doc.setTextColor(COLOR_HEADER);

    let day = 1;
    let rowIdx = 0;
    let colIdx = firstDay;
    while (day <= daysInMonth) {
      const cellX = boxLeft + cellW * colIdx;
      const cellY = dayGridStart + cellH * rowIdx + cellH / 2 + 1;
      doc.text(String(day), cellX + cellW / 2, cellY, { align: "center" });
      if (eventKeys.has(`${m}-${day}`)) {
        doc.setFillColor(SAGE_DOT.r, SAGE_DOT.g, SAGE_DOT.b);
        doc.circle(cellX + cellW / 2, cellY + 3.5, 1.2, "F");
      }
      day += 1;
      colIdx += 1;
      if (colIdx >= 7) {
        colIdx = 0;
        rowIdx += 1;
      }
    }
  }
}

