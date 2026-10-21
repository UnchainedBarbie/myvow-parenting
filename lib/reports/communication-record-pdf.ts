import { jsPDF } from "jspdf";
import { sha256String } from "@/lib/reports/build-pdf";
import {
  dateCell,
  directionLabel,
  evidenceLines,
  type CommunicationRecordModel,
  type CommunicationRow,
  type EvidenceRef,
} from "@/lib/reports/communication-record";

const TABLE_W = 279.4;
const TABLE_H = 215.9;
const PORT_W = 215.9;
const PORT_H = 279.4;

export type PdfLink = {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  target: number;
};

export type LedgerPdf = {
  buffer: Buffer;
  pageCount: number;
  links: PdfLink[];
  pageHeightMm: number;
};

type Geom = { pageW: number; pageH: number; margin: number; bottom: number; contentW: number };
type DrawnLine = { text: string; targetPage: number | null };
type Cursor = { doc: jsPDF; y: number; links: PdfLink[]; geom: Geom; caseLabel: string };

function geometry(orientation: "landscape" | "portrait"): Geom {
  const pageW = orientation === "landscape" ? TABLE_W : PORT_W;
  const pageH = orientation === "landscape" ? TABLE_H : PORT_H;
  const margin = orientation === "landscape" ? 12 : 19;
  return { pageW, pageH, margin, bottom: pageH - 14, contentW: pageW - margin * 2 };
}

function currentPage(doc: jsPDF): number {
  const info = doc.getCurrentPageInfo?.();
  if (info && typeof info.pageNumber === "number") return info.pageNumber;
  return doc.getNumberOfPages();
}

function newPage(cursor: Cursor) {
  const { geom, caseLabel } = cursor;
  cursor.doc.addPage();
  cursor.doc.setFont("times", "normal");
  cursor.doc.setFontSize(8);
  cursor.doc.setTextColor(68, 68, 68);
  cursor.doc.text("Communication Record", geom.margin, 12);
  cursor.doc.text(caseLabel, geom.pageW - geom.margin, 12, { align: "right" });
  cursor.doc.setDrawColor(34, 34, 34);
  cursor.doc.setLineWidth(0.2);
  cursor.doc.line(geom.margin, 14, geom.pageW - geom.margin, 14);
  cursor.y = 20;
}

function ensure(cursor: Cursor, height: number) {
  if (cursor.y + height <= cursor.geom.bottom) return;
  newPage(cursor);
}

function wrapExact(doc: jsPDF, text: string, width: number): string[] {
  if (text.length === 0) return [" "];
  const lines: string[] = [];
  for (const part of text.split(/\r\n|\n|\r/)) {
    if (part.length === 0) {
      lines.push(" ");
      continue;
    }
    const wrapped = doc.splitTextToSize(part, width) as string[];
    lines.push(...(wrapped.length > 0 ? wrapped : [" "]));
  }
  return lines.length > 0 ? lines : [" "];
}

function plainLines(doc: jsPDF, text: string, width: number): DrawnLine[] {
  return wrapExact(doc, text, width).map((line) => ({ text: line, targetPage: null }));
}

function writeLines(
  cursor: Cursor,
  lines: DrawnLine[],
  x: number,
  size: number,
  style: "normal" | "bold",
  color: [number, number, number]
) {
  const leading = size * 0.42;
  cursor.doc.setFont("times", style);
  cursor.doc.setFontSize(size);
  cursor.doc.setTextColor(...color);
  for (const line of lines) {
    ensure(cursor, leading);
    cursor.doc.text(line.text, x, cursor.y);
    if (line.targetPage) {
      cursor.links.push({
        page: currentPage(cursor.doc),
        x,
        y: cursor.y - size * 0.3,
        w: Math.max(cursor.doc.getTextWidth(line.text), 8),
        h: leading,
        target: line.targetPage,
      });
    }
    cursor.y += leading;
  }
}

function sectionTitle(cursor: Cursor, title: string) {
  ensure(cursor, 16);
  cursor.y += 4;
  cursor.doc.setFont("times", "bold");
  cursor.doc.setFontSize(13);
  cursor.doc.setTextColor(17, 17, 17);
  cursor.doc.text(title, cursor.geom.margin, cursor.y);
  cursor.y += 2;
  cursor.doc.setDrawColor(34, 34, 34);
  cursor.doc.setLineWidth(0.3);
  cursor.doc.line(cursor.geom.margin, cursor.y, cursor.geom.pageW - cursor.geom.margin, cursor.y);
  cursor.y += 5;
}

function drawFacts(cursor: Cursor, facts: { label: string; value: string }[]) {
  const labelWidth = cursor.geom.pageW > 250 ? 36 : 32;
  for (const fact of facts) {
    cursor.doc.setFont("times", "normal");
    cursor.doc.setFontSize(10);
    const valueLines = wrapExact(cursor.doc, fact.value, cursor.geom.contentW - labelWidth);
    const height = Math.max(valueLines.length, 1) * 4.2 + 3.2;
    ensure(cursor, height);
    cursor.doc.setFont("times", "bold");
    cursor.doc.setFontSize(8);
    cursor.doc.setTextColor(58, 58, 58);
    cursor.doc.text(fact.label.toUpperCase(), cursor.geom.margin, cursor.y);
    cursor.doc.setFont("times", "normal");
    cursor.doc.setFontSize(10);
    cursor.doc.setTextColor(22, 22, 22);
    valueLines.forEach((line, index) => {
      cursor.doc.text(line, cursor.geom.margin + labelWidth, cursor.y + index * 4.2);
    });
    cursor.y += height;
  }
  cursor.y += 1;
  cursor.doc.setDrawColor(34, 34, 34);
  cursor.doc.setLineWidth(0.3);
  cursor.doc.line(cursor.geom.margin, cursor.y, cursor.geom.pageW - cursor.geom.margin, cursor.y);
  cursor.y += 6;
}

function openDocument(
  model: CommunicationRecordModel,
  orientation: "landscape" | "portrait",
  title: string
): Cursor {
  const geom = geometry(orientation);
  const doc = new jsPDF({ unit: "mm", format: "letter", orientation });
  doc.setProperties({ title, subject: "MyVow Parenting communication record" });
  const cursor: Cursor = { doc, y: geom.margin, links: [], geom, caseLabel: model.caseLabel };
  doc.setFont("times", "normal");
  doc.setFontSize(8);
  doc.setTextColor(74, 74, 74);
  doc.text("MYVOW PARENTING", geom.margin, cursor.y);
  cursor.y += 8;
  doc.setFont("times", "bold");
  doc.setFontSize(orientation === "landscape" ? 18 : 20);
  doc.setTextColor(17, 17, 17);
  doc.text(title, geom.margin, cursor.y);
  cursor.y += 3;
  doc.setDrawColor(34, 34, 34);
  doc.setLineWidth(0.4);
  doc.line(geom.margin, cursor.y, geom.pageW - geom.margin, cursor.y);
  cursor.y += 6;
  return cursor;
}

function finish(cursor: Cursor, verification: string, explanation: string): LedgerPdf {
  sectionTitle(cursor, "Verification");
  writeLines(
    cursor,
    plainLines(cursor.doc, explanation, cursor.geom.contentW),
    cursor.geom.margin,
    9,
    "normal",
    [34, 34, 34]
  );
  cursor.y += 2;
  const hash = sha256String(verification);
  writeLines(cursor, [{ text: "SHA-256", targetPage: null }], cursor.geom.margin, 8, "bold", [58, 58, 58]);
  writeLines(cursor, [{ text: hash, targetPage: null }], cursor.geom.margin, 8, "normal", [22, 22, 22]);

  const pages = cursor.doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    cursor.doc.setPage(page);
    cursor.doc.setFont("times", "normal");
    cursor.doc.setFontSize(8);
    cursor.doc.setTextColor(68, 68, 68);
    cursor.doc.text("Communication Record", cursor.geom.margin, cursor.geom.pageH - 7);
    cursor.doc.text(cursor.caseLabel, cursor.geom.pageW / 2, cursor.geom.pageH - 7, { align: "center" });
    cursor.doc.text(`Page ${page}`, cursor.geom.pageW - cursor.geom.margin, cursor.geom.pageH - 7, { align: "right" });
  }
  const out = cursor.doc.output("arraybuffer");
  return {
    buffer: Buffer.from(new Uint8Array(out as ArrayBuffer)),
    pageCount: pages,
    links: cursor.links,
    pageHeightMm: cursor.geom.pageH,
  };
}

function sharedFacts(
  model: CommunicationRecordModel,
  layout: string,
  includeAttachments: boolean
): { label: string; value: string }[] {
  const filterText =
    model.filterLines.length > 0
      ? model.filterLines.map((line) => `${line.label}: ${line.value}`).join("\n")
      : "None";
  return [
    { label: "Case", value: model.caseLabel },
    { label: "Parties", value: model.parties.length > 0 ? model.parties.join("\n") : "No parties stored" },
    { label: "Timezone", value: model.timezone },
    { label: "Reporting period", value: model.reportingPeriod },
    { label: "Messages shown", value: model.messageSpan },
    { label: "Generated", value: model.generatedLabel },
    { label: "Layout", value: layout },
    {
      label: "Attachments",
      value: includeAttachments
        ? "Included after the message ledger. Page numbers refer to this PDF. The record hash does not cover attachment file bytes."
        : "Attachments excluded from this export. Document IDs are listed without page numbers.",
    },
    { label: "Filters", value: filterText },
  ];
}

function paintRow(
  cursor: Cursor,
  cellLines: DrawnLine[][],
  widths: number[],
  rowHeight: number,
  shaded: boolean,
  drawHeader: () => void
) {
  const available = cursor.geom.bottom - cursor.y;
  const sliceHeight = Math.min(rowHeight, available);
  if (shaded) {
    cursor.doc.setFillColor(252, 251, 248);
    cursor.doc.rect(cursor.geom.margin, cursor.y - 3.2, cursor.geom.contentW, sliceHeight, "F");
  }
  let x = cursor.geom.margin + 1;
  cursor.doc.setFont("times", "normal");
  cursor.doc.setFontSize(8);
  cursor.doc.setTextColor(22, 22, 22);
  const lineBudget = Math.max(1, Math.floor((sliceHeight - 1) / 3.4));
  const rest: DrawnLine[][] = cellLines.map(() => []);
  const page = currentPage(cursor.doc);
  cellLines.forEach((lines, index) => {
    const visible = lines.slice(0, lineBudget);
    rest[index] = lines.slice(lineBudget);
    visible.forEach((line, lineIndex) => {
      const y = cursor.y + lineIndex * 3.4;
      cursor.doc.text(line.text, x, y);
      if (line.targetPage) {
        cursor.links.push({
          page,
          x,
          y: y - 2.6,
          w: Math.max(widths[index] - 2, 8),
          h: 3.2,
          target: line.targetPage,
        });
      }
    });
    x += widths[index];
  });
  cursor.doc.setDrawColor(213, 213, 213);
  cursor.doc.setLineWidth(0.15);
  cursor.doc.line(
    cursor.geom.margin,
    cursor.y - 3.2 + sliceHeight,
    cursor.geom.pageW - cursor.geom.margin,
    cursor.y - 3.2 + sliceHeight
  );
  cursor.y += sliceHeight;
  if (rest.some((lines) => lines.length > 0)) {
    for (const index of [0, 1, 2]) {
      if (rest[index]?.length === 0 && cellLines[index]?.[0]) {
        rest[index] = [{ text: cellLines[index][0].text, targetPage: null }];
      }
    }
    newPage(cursor);
    drawHeader();
    const nextHeight = Math.max(...rest.map((lines) => Math.max(lines.length, 1))) * 3.4 + 2.4;
    paintRow(cursor, rest, widths, nextHeight, shaded, drawHeader);
  }
}

function drawLedger(
  cursor: Cursor,
  headers: string[],
  widths: number[],
  rows: DrawnLine[][][]
) {
  const drawHeader = () => {
    cursor.doc.setFont("times", "bold");
    cursor.doc.setFontSize(8);
    const headerLines = headers.map((header, index) => wrapExact(cursor.doc, header, widths[index] - 2));
    const height = Math.max(...headerLines.map((lines) => lines.length)) * 3.4 + 2;
    ensure(cursor, height + 8);
    cursor.doc.setFillColor(247, 243, 234);
    cursor.doc.rect(cursor.geom.margin, cursor.y - 3.2, cursor.geom.contentW, height, "F");
    let x = cursor.geom.margin + 1;
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
  rows.forEach((row, rowIndex) => {
    cursor.doc.setFont("times", "normal");
    cursor.doc.setFontSize(8);
    const rowHeight = Math.max(...row.map((lines) => Math.max(lines.length, 1))) * 3.4 + 2.4;
    if (cursor.y + Math.min(rowHeight, 24) > cursor.geom.bottom) {
      newPage(cursor);
      drawHeader();
    }
    paintRow(cursor, row, widths, rowHeight, rowIndex % 2 === 1, drawHeader);
  });
}

function tableRow(
  doc: jsPDF,
  row: CommunicationRow,
  widths: number[],
  evidence: Map<string, EvidenceRef[]> | null,
  timeZone: string
): DrawnLine[][] {
  doc.setFont("times", "normal");
  doc.setFontSize(8);
  const cells = [
    row.number,
    dateCell(row, timeZone),
    row.sender,
    row.recipient,
    row.subject,
    row.body,
  ];
  const lines = cells.map((cell, index) => plainLines(doc, cell, widths[index] - 2));
  const evidenceWidth = widths[widths.length - 1] - 2;
  const evidenceCells = evidenceLines(row, evidence).flatMap((line) => {
    const wrapped = wrapExact(doc, line.text, evidenceWidth);
    return wrapped.map((text, index) => ({
      text,
      targetPage: index === 0 ? line.targetPage : null,
    }));
  });
  lines.push(evidenceCells);
  return lines;
}

const TABLE_NOTE =
  "Messages are listed oldest to newest across conversations. Message numbers are the case chronology, including messages left out of this export. Recorded time is the stored message timestamp. Delivered time is shown only when a delivery timestamp is stored. A recorded time is not a delivery confirmation. Message text is the original wording.";

export function buildChronologicalPdf(
  model: CommunicationRecordModel,
  evidence: Map<string, EvidenceRef[]> | null,
  verification: string
): LedgerPdf {
  const includeAttachments = evidence != null;
  const cursor = openDocument(model, "landscape", "Communication Record");
  drawFacts(cursor, sharedFacts(model, "Chronological table", includeAttachments));
  if (model.categoryNotice) {
    cursor.y += 2;
    writeLines(
      cursor,
      plainLines(cursor.doc, model.categoryNotice, cursor.geom.contentW),
      cursor.geom.margin,
      9,
      "normal",
      [34, 34, 34]
    );
  }
  sectionTitle(cursor, "Message ledger");
  writeLines(cursor, plainLines(cursor.doc, TABLE_NOTE, cursor.geom.contentW), cursor.geom.margin, 9, "normal", [34, 34, 34]);
  cursor.y += 2;
  writeLines(
    cursor,
    plainLines(cursor.doc, model.completeness, cursor.geom.contentW),
    cursor.geom.margin,
    9,
    "normal",
    [22, 22, 22]
  );
  cursor.y += 3;

  const widths = [20, 32, 42, 42, 28, 47.4, 44];
  const headers = ["Message ID", "Date & Time", "From", "To", "Subject", "Message", "Supporting evidence"];

  if (model.rows.length === 0) {
    writeLines(
      cursor,
      plainLines(cursor.doc, "No messages are included in this export.", cursor.geom.contentW),
      cursor.geom.margin,
      10,
      "normal",
      [22, 22, 22]
    );
  } else {
    const rows = model.rows.map((row) => tableRow(cursor.doc, row, widths, evidence, model.timezone));
    drawLedger(cursor, headers, widths, rows);
  }

  return finish(
    cursor,
    verification,
    "This fingerprint covers the message identifiers, timestamps, parties, subjects, original wording, and attachment identifiers in this export. It does not cover attachment file bytes. It is not an independent certification."
  );
}

function transcriptMessage(cursor: Cursor, row: CommunicationRow, evidence: Map<string, EvidenceRef[]> | null) {
  const who = row.transcriptWho || directionLabel(row.direction);
  ensure(cursor, 32);
  cursor.doc.setFont("times", "bold");
  cursor.doc.setFontSize(11);
  cursor.doc.setTextColor(17, 17, 17);
  const id = `Message ${row.number}`;
  const idWidth = cursor.doc.getTextWidth(id);
  const whoLines = wrapExact(cursor.doc, who, cursor.geom.contentW - idWidth - 4);
  whoLines.forEach((line, index) => {
    ensure(cursor, 5);
    cursor.doc.text(line, cursor.geom.margin, cursor.y);
    if (index === 0) {
      cursor.doc.setFont("times", "normal");
      cursor.doc.setFontSize(8);
      cursor.doc.text(id, cursor.geom.pageW - cursor.geom.margin, cursor.y, { align: "right" });
      cursor.doc.setFont("times", "bold");
      cursor.doc.setFontSize(11);
    }
    cursor.y += 4.6;
  });
  writeLines(
    cursor,
    plainLines(cursor.doc, `Message time: ${row.recordedLabel}`, cursor.geom.contentW),
    cursor.geom.margin,
    8,
    "normal",
    [51, 51, 51]
  );
  writeLines(
    cursor,
    plainLines(cursor.doc, `To: ${row.recipient}`, cursor.geom.contentW),
    cursor.geom.margin,
    8,
    "normal",
    [51, 51, 51]
  );
  for (const line of row.deliveryLines) {
    writeLines(cursor, plainLines(cursor.doc, line, cursor.geom.contentW), cursor.geom.margin, 8, "normal", [51, 51, 51]);
  }
  cursor.y += 1.5;
  cursor.doc.setFont("times", "normal");
  cursor.doc.setFontSize(11);
  writeLines(
    cursor,
    plainLines(cursor.doc, row.transcriptText, cursor.geom.contentW),
    cursor.geom.margin,
    11,
    "normal",
    [22, 22, 22]
  );
  if (row.transcriptOmitted) {
    writeLines(
      cursor,
      plainLines(cursor.doc, "[Signature and confidentiality notice omitted]", cursor.geom.contentW),
      cursor.geom.margin,
      9,
      "normal",
      [51, 51, 51]
    );
  }
  if (row.attachments.length > 0) {
    writeLines(
      cursor,
      plainLines(
        cursor.doc,
        `Attachments: ${row.attachments.map((attachment) => attachment.label).join("; ")}`,
        cursor.geom.contentW
      ),
      cursor.geom.margin,
      8,
      "normal",
      [51, 51, 51]
    );
  }
  for (const line of evidenceLines(row, evidence)) {
    writeLines(
      cursor,
      [{ text: `Supporting evidence: ${line.text}`, targetPage: line.targetPage }],
      cursor.geom.margin,
      8,
      "normal",
      [22, 22, 22]
    );
  }
  cursor.y += 1;
  cursor.doc.setDrawColor(208, 208, 208);
  cursor.doc.setLineWidth(0.2);
  cursor.doc.line(cursor.geom.margin, cursor.y, cursor.geom.pageW - cursor.geom.margin, cursor.y);
  cursor.y += 4;
}

export function buildTranscriptPdf(
  model: CommunicationRecordModel,
  evidence: Map<string, EvidenceRef[]> | null,
  verification: string
): LedgerPdf {
  const includeAttachments = evidence != null;
  const cursor = openDocument(model, "portrait", "Communication Record");
  drawFacts(cursor, sharedFacts(model, "Conversation transcript", includeAttachments));
  cursor.y += 2;
  writeLines(
    cursor,
    plainLines(
      cursor.doc,
      "Grouped by conversation, earliest conversation first. Message numbers reflect chronological position in this case as of the generation time above.",
      cursor.geom.contentW
    ),
    cursor.geom.margin,
    9,
    "normal",
    [34, 34, 34]
  );
  if (model.categoryNotice) {
    cursor.y += 2;
    writeLines(
      cursor,
      plainLines(cursor.doc, model.categoryNotice, cursor.geom.contentW),
      cursor.geom.margin,
      9,
      "normal",
      [34, 34, 34]
    );
  }
  cursor.y += 2;
  writeLines(
    cursor,
    plainLines(cursor.doc, model.completeness, cursor.geom.contentW),
    cursor.geom.margin,
    9,
    "normal",
    [22, 22, 22]
  );

  if (model.threads.length === 0) {
    cursor.y += 4;
    writeLines(
      cursor,
      plainLines(cursor.doc, "No messages are included in this export.", cursor.geom.contentW),
      cursor.geom.margin,
      11,
      "normal",
      [22, 22, 22]
    );
  }
  for (const thread of model.threads) {
    sectionTitle(cursor, thread.heading);
    for (const row of thread.rows) transcriptMessage(cursor, row, evidence);
  }

  return finish(
    cursor,
    verification,
    "This fingerprint covers the message identifiers, timestamps, parties, subjects, transcript text, and attachment identifiers in this export. It does not cover attachment file bytes. It is not an independent certification. The conversation transcript follows the on-screen record, including omission of a detected signature block. The chronological table and CSV keep the complete original wording."
  );
}
