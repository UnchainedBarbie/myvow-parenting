import { jsPDF } from "jspdf";
import { sha256String } from "@/lib/reports/build-pdf";
import { linkTargetPage, type ReportLink } from "@/lib/reports/evidence-refs";
import type { DocumentIndexDocument, DocumentIndexTable } from "@/lib/reports/document-index";

const PAGE_W = 279.4;
const PAGE_H = 215.9;
const MARGIN = 12;
const BOTTOM = PAGE_H - 14;
const CONTENT_W = PAGE_W - MARGIN * 2;

type Cursor = { doc: jsPDF; y: number; links: ReportLink[] };

function newPage(cursor: Cursor, caseLabel: string) {
  cursor.doc.addPage();
  cursor.doc.setFont("times", "normal");
  cursor.doc.setFontSize(8);
  cursor.doc.setTextColor(68, 68, 68);
  cursor.doc.text("Document Index", MARGIN, 12);
  cursor.doc.text(caseLabel, PAGE_W - MARGIN, 12, { align: "right" });
  cursor.doc.setDrawColor(34, 34, 34);
  cursor.doc.setLineWidth(0.2);
  cursor.doc.line(MARGIN, 14, PAGE_W - MARGIN, 14);
  cursor.y = 20;
}

function ensure(cursor: Cursor, height: number, caseLabel: string) {
  if (cursor.y + height <= BOTTOM) return;
  newPage(cursor, caseLabel);
}

function wrap(doc: jsPDF, text: string, width: number): string[] {
  const source = text.trim() ? text : " ";
  const lines: string[] = [];
  for (const part of source.split("\n")) {
    const wrapped = doc.splitTextToSize(part || " ", width) as string[];
    lines.push(...(wrapped.length > 0 ? wrapped : [" "]));
  }
  return lines;
}

function writeLines(
  cursor: Cursor,
  lines: string[],
  x: number,
  size: number,
  style: "normal" | "bold",
  color: [number, number, number],
  caseLabel: string
) {
  const leading = size * 0.42;
  cursor.doc.setFont("times", style);
  cursor.doc.setFontSize(size);
  cursor.doc.setTextColor(...color);
  for (const line of lines) {
    ensure(cursor, leading, caseLabel);
    cursor.doc.text(line, x, cursor.y);
    cursor.y += leading;
  }
}

function sectionTitle(cursor: Cursor, title: string, caseLabel: string) {
  ensure(cursor, 16, caseLabel);
  cursor.y += 4;
  cursor.doc.setFont("times", "bold");
  cursor.doc.setFontSize(13);
  cursor.doc.setTextColor(17, 17, 17);
  cursor.doc.text(title, MARGIN, cursor.y);
  cursor.y += 2;
  cursor.doc.setDrawColor(34, 34, 34);
  cursor.doc.setLineWidth(0.3);
  cursor.doc.line(MARGIN, cursor.y, PAGE_W - MARGIN, cursor.y);
  cursor.y += 5;
}

function drawTable(cursor: Cursor, table: DocumentIndexTable, caseLabel: string) {
  sectionTitle(cursor, table.title, caseLabel);
  if (table.intro) {
    writeLines(cursor, wrap(cursor.doc, table.intro, CONTENT_W), MARGIN, 9, "normal", [34, 34, 34], caseLabel);
    cursor.y += 2;
  }
  if (table.rows.length === 0) {
    writeLines(cursor, wrap(cursor.doc, table.empty, CONTENT_W), MARGIN, 10, "normal", [22, 22, 22], caseLabel);
    return;
  }
  const widths = table.widths;
  const drawHeader = () => {
    cursor.doc.setFont("times", "bold");
    cursor.doc.setFontSize(8);
    const headerLines = table.headers.map((header, index) => wrap(cursor.doc, header, widths[index] - 2));
    const height = Math.max(...headerLines.map((lines) => lines.length)) * 3.4 + 2;
    ensure(cursor, height + 8, caseLabel);
    cursor.doc.setFillColor(247, 243, 234);
    cursor.doc.rect(MARGIN, cursor.y - 3.2, CONTENT_W, height, "F");
    let x = MARGIN + 1;
    cursor.doc.setFont("times", "bold");
    cursor.doc.setFontSize(8);
    cursor.doc.setTextColor(34, 34, 34);
    headerLines.forEach((lines, index) => {
      lines.forEach((line, lineIndex) => {
        cursor.doc.text(line, x, cursor.y + lineIndex * 3.4);
      });
      x += widths[index];
    });
    cursor.y += height;
  };
  drawHeader();
  table.rows.forEach((row, rowIndex) => {
    cursor.doc.setFont("times", "normal");
    cursor.doc.setFontSize(8);
    const cellLines = row.map((cell, index) => wrap(cursor.doc, cell, widths[index] - 2));
    const rowHeight = Math.max(...cellLines.map((lines) => lines.length)) * 3.4 + 2.4;
    if (cursor.y + Math.min(rowHeight, 24) > BOTTOM) {
      newPage(cursor, caseLabel);
      drawHeader();
    }
    paintRow(cursor, cellLines, widths, rowHeight, rowIndex % 2 === 1, caseLabel, drawHeader);
  });
}

function paintRow(
  cursor: Cursor,
  cellLines: string[][],
  widths: number[],
  rowHeight: number,
  shaded: boolean,
  caseLabel: string,
  drawHeader: () => void
) {
  const available = BOTTOM - cursor.y;
  const sliceHeight = Math.min(rowHeight, available);
  if (shaded) {
    cursor.doc.setFillColor(252, 251, 248);
    cursor.doc.rect(MARGIN, cursor.y - 3.2, CONTENT_W, sliceHeight, "F");
  }
  let x = MARGIN + 1;
  cursor.doc.setFont("times", "normal");
  cursor.doc.setFontSize(8);
  cursor.doc.setTextColor(22, 22, 22);
  const lineBudget = Math.max(1, Math.floor((sliceHeight - 1) / 3.4));
  const rest: string[][] = cellLines.map(() => []);
  cellLines.forEach((lines, index) => {
    const visible = lines.slice(0, lineBudget);
    rest[index] = lines.slice(lineBudget);
    visible.forEach((line, lineIndex) => {
      const y = cursor.y + lineIndex * 3.4;
      cursor.doc.text(line, x, y);
      const target = linkTargetPage(line);
      if (target) {
        cursor.links.push({
          page: cursor.doc.getCurrentPageInfo().pageNumber,
          x,
          y: y - 2.6,
          w: Math.max(widths[index] - 2, 8),
          h: 3.2,
          target,
        });
      }
    });
    x += widths[index];
  });
  cursor.doc.setDrawColor(213, 213, 213);
  cursor.doc.setLineWidth(0.15);
  cursor.doc.line(MARGIN, cursor.y - 3.2 + sliceHeight, PAGE_W - MARGIN, cursor.y - 3.2 + sliceHeight);
  cursor.y += sliceHeight;
  if (rest.some((lines) => lines.length > 0)) {
    newPage(cursor, caseLabel);
    drawHeader();
    const nextHeight = Math.max(...rest.map((lines) => Math.max(lines.length, 1))) * 3.4 + 2.4;
    paintRow(cursor, rest, widths, nextHeight, shaded, caseLabel, drawHeader);
  }
}

export function buildDocumentIndexPdf(
  report: DocumentIndexDocument,
  caseLabel: string,
  verificationPayload: string
): { buffer: Buffer; verificationHash: string; pageCount: number; links: ReportLink[]; pageHeightMm: number } {
  const doc = new jsPDF({ unit: "mm", format: "letter", orientation: "landscape" });
  const cursor: Cursor = { doc, y: MARGIN, links: [] };
  doc.setProperties({ title: "Document Index", subject: "MyVow Parenting document index" });

  doc.setFont("times", "normal");
  doc.setFontSize(8);
  doc.setTextColor(74, 74, 74);
  doc.text("MYVOW PARENTING", MARGIN, cursor.y);
  cursor.y += 8;
  doc.setFont("times", "bold");
  doc.setFontSize(20);
  doc.setTextColor(17, 17, 17);
  doc.text("Document Index", MARGIN, cursor.y);
  cursor.y += 3;
  doc.setDrawColor(34, 34, 34);
  doc.setLineWidth(0.4);
  doc.line(MARGIN, cursor.y, PAGE_W - MARGIN, cursor.y);
  cursor.y += 6;

  for (const fact of report.facts) {
    const labelWidth = 28;
    doc.setFont("times", "normal");
    doc.setFontSize(10);
    const valueLines = wrap(doc, fact.value, CONTENT_W - labelWidth);
    const height = Math.max(valueLines.length, 1) * 4.2 + 1.5;
    ensure(cursor, height, caseLabel);
    doc.setFont("times", "bold");
    doc.setFontSize(8);
    doc.setTextColor(58, 58, 58);
    doc.text(fact.label.toUpperCase(), MARGIN, cursor.y);
    doc.setFont("times", "normal");
    doc.setFontSize(10);
    doc.setTextColor(22, 22, 22);
    valueLines.forEach((line, index) => {
      doc.text(line, MARGIN + labelWidth, cursor.y + index * 4.2);
    });
    cursor.y += height;
    doc.setDrawColor(213, 213, 213);
    doc.setLineWidth(0.15);
    doc.line(MARGIN, cursor.y - 1.2, PAGE_W - MARGIN, cursor.y - 1.2);
  }

  for (const block of report.blocks) {
    if (block.kind === "lines") {
      sectionTitle(cursor, block.title, caseLabel);
      for (const line of block.lines) {
        writeLines(cursor, wrap(doc, line, CONTENT_W), MARGIN, 10, "normal", [22, 22, 22], caseLabel);
        cursor.y += 1.6;
      }
      continue;
    }
    drawTable(cursor, block, caseLabel);
  }

  sectionTitle(cursor, "Completeness", caseLabel);
  writeLines(cursor, wrap(doc, report.completeness, CONTENT_W), MARGIN, 10, "normal", [22, 22, 22], caseLabel);

  const hash = sha256String(verificationPayload);
  sectionTitle(cursor, "Verification", caseLabel);
  writeLines(
    cursor,
    wrap(doc, report.verificationExplanation, CONTENT_W),
    MARGIN,
    9,
    "normal",
    [34, 34, 34],
    caseLabel
  );
  cursor.y += 2;
  writeLines(cursor, ["SHA-256"], MARGIN, 8, "bold", [58, 58, 58], caseLabel);
  writeLines(cursor, [hash], MARGIN, 8, "normal", [22, 22, 22], caseLabel);

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setFont("times", "normal");
    doc.setFontSize(8);
    doc.setTextColor(68, 68, 68);
    doc.text("Document Index", MARGIN, PAGE_H - 7);
    doc.text(caseLabel, PAGE_W / 2, PAGE_H - 7, { align: "center" });
    doc.text(`Page ${page}`, PAGE_W - MARGIN, PAGE_H - 7, { align: "right" });
  }

  const out = doc.output("arraybuffer");
  return {
    buffer: Buffer.from(new Uint8Array(out as ArrayBuffer)),
    verificationHash: hash,
    pageCount: pages,
    links: cursor.links,
    pageHeightMm: PAGE_H,
  };
}
