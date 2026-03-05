import { jsPDF } from "jspdf";
import { createHash } from "crypto";

const MARGIN = 20;
const LINE_HEIGHT = 6;
const PAGE_HEIGHT = 297;
const PAGE_WIDTH = 210;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
const Y_MAX = PAGE_HEIGHT - MARGIN;

function addHeader(doc: jsPDF, title: string, dateRange: string) {
  doc.setFontSize(14);
  doc.text("MyVow Parenting — Court-Ready Export", MARGIN, MARGIN);
  doc.setFontSize(12);
  doc.text(title, MARGIN, MARGIN + 8);
  doc.setFontSize(10);
  doc.text(dateRange, MARGIN, MARGIN + 14);
}

function addVerificationFooter(doc: jsPDF, verificationHash: string) {
  doc.setFontSize(9);
  doc.text(`Verification hash (SHA-256): ${verificationHash}`, MARGIN, MARGIN + 10);
}

function getBuffer(doc: jsPDF): Buffer {
  const out = doc.output("arraybuffer");
  return Buffer.from(new Uint8Array(out as ArrayBuffer));
}

export type MessageRecord = {
  id: string;
  created_at: string;
  direction: string;
  original_content: string;
  ai_rewritten_content: string | null;
  ai_classification: string | null;
  category: string | null;
  conversation_topic?: string | null;
  flags?: { flag_type: string; description: string | null }[];
};

export async function buildMessageTranscriptPdf(
  messages: MessageRecord[],
  dateRangeStart: string | null,
  dateRangeEnd: string | null
): Promise<{ buffer: Buffer; verificationPayload: string }> {
  const doc = new jsPDF();
  const dateRange =
    dateRangeStart && dateRangeEnd
      ? `${new Date(dateRangeStart).toLocaleDateString()} – ${new Date(dateRangeEnd).toLocaleDateString()}`
      : "All dates";
  addHeader(doc, "Message Transcript (with AI classifications and flags)", dateRange);

  const payloadParts: string[] = [];
  let y = MARGIN + 22;
  doc.setFontSize(10);

  for (const m of messages) {
    if (y > Y_MAX) {
      doc.addPage();
      y = MARGIN;
    }
    payloadParts.push(m.id, m.created_at, m.direction, m.original_content);
    const lines = doc.splitTextToSize(
      `Date: ${new Date(m.created_at).toLocaleString()}`,
      CONTENT_WIDTH
    );
    doc.text(lines, MARGIN, y);
    y += LINE_HEIGHT;
    doc.text(`Direction: ${m.direction}`, MARGIN, y);
    y += LINE_HEIGHT;
    if (m.conversation_topic) {
      doc.text(`Conversation topic: ${m.conversation_topic}`, MARGIN, y);
      y += LINE_HEIGHT;
    }
    const content = (m.ai_rewritten_content ?? m.original_content).slice(0, 200) +
      ((m.ai_rewritten_content ?? m.original_content).length > 200 ? "…" : "");
    const contentLines = doc.splitTextToSize(`Content (mediated): ${content}`, CONTENT_WIDTH);
    doc.text(contentLines, MARGIN, y);
    y += LINE_HEIGHT * contentLines.length + 2;
    if (m.ai_classification) {
      doc.text(`Classification: ${m.ai_classification}`, MARGIN, y);
      y += LINE_HEIGHT;
    }
    if (m.flags?.length) {
      const flagStr = m.flags.map((f) => f.flag_type + (f.description ? ` — ${f.description}` : "")).join("; ");
      const flagLines = doc.splitTextToSize(`Flags: ${flagStr}`, CONTENT_WIDTH);
      doc.text(flagLines, MARGIN, y);
      y += LINE_HEIGHT * flagLines.length;
    }
    y += LINE_HEIGHT;
  }

  const verificationPayload = payloadParts.join("|");
  const hash = createHash("sha256").update(verificationPayload).digest("hex");
  doc.addPage();
  addVerificationFooter(doc, hash);
  return { buffer: getBuffer(doc), verificationPayload };
}

export type ExpenseRecord = {
  id: string;
  created_at: string;
  description: string;
  amount: string;
  category: string;
  status: string;
  amount_owed: string | null;
};

export async function buildExpenseLedgerPdf(
  expenses: ExpenseRecord[],
  dateRangeStart: string | null,
  dateRangeEnd: string | null
): Promise<{ buffer: Buffer; verificationPayload: string }> {
  const doc = new jsPDF();
  const dateRange =
    dateRangeStart && dateRangeEnd
      ? `${new Date(dateRangeStart).toLocaleDateString()} – ${new Date(dateRangeEnd).toLocaleDateString()}`
      : "All dates";
  addHeader(doc, "Expense Ledger", dateRange);

  const payloadParts: string[] = [];
  let y = MARGIN + 22;
  doc.setFontSize(10);

  for (const e of expenses) {
    if (y > Y_MAX) {
      doc.addPage();
      y = MARGIN;
    }
    payloadParts.push(e.id, e.created_at, e.description, e.amount);
    doc.text(
      `${new Date(e.created_at).toLocaleDateString()} | $${e.amount} | ${e.category} | ${e.status}`,
      MARGIN,
      y
    );
    y += LINE_HEIGHT;
    const descLines = doc.splitTextToSize(e.description, CONTENT_WIDTH);
    doc.text(descLines, MARGIN, y);
    y += LINE_HEIGHT * descLines.length + LINE_HEIGHT;
  }

  const verificationPayload = payloadParts.join("|");
  const hash = createHash("sha256").update(verificationPayload).digest("hex");
  doc.addPage();
  addVerificationFooter(doc, hash);
  return { buffer: getBuffer(doc), verificationPayload };
}

export type PatternRecord = {
  id: string;
  flag_type: string;
  occurrence_count: number;
  first_detected_at: string | null;
  last_detected_at: string | null;
  trend: string | null;
  escalation_score: string | null;
};

export async function buildPatternSummaryPdf(
  patterns: PatternRecord[],
  _dateRangeStart: string | null,
  _dateRangeEnd: string | null
): Promise<{ buffer: Buffer; verificationPayload: string }> {
  const doc = new jsPDF();
  addHeader(doc, "Pattern Summary (flag frequencies and trends)", "All time");

  const payloadParts: string[] = [];
  let y = MARGIN + 22;
  doc.setFontSize(10);

  for (const p of patterns) {
    if (y > Y_MAX) {
      doc.addPage();
      y = MARGIN;
    }
    payloadParts.push(p.id, p.flag_type, String(p.occurrence_count));
    doc.text(`Flag type: ${p.flag_type}`, MARGIN, y);
    y += LINE_HEIGHT;
    doc.text(
      `Occurrences: ${p.occurrence_count} | Trend: ${p.trend ?? "—"} | Escalation: ${p.escalation_score ?? "—"}`,
      MARGIN,
      y
    );
    y += LINE_HEIGHT;
    if (p.first_detected_at) {
      doc.text(`First: ${new Date(p.first_detected_at).toLocaleDateString()}`, MARGIN, y);
      y += LINE_HEIGHT;
    }
    if (p.last_detected_at) {
      doc.text(`Last: ${new Date(p.last_detected_at).toLocaleDateString()}`, MARGIN, y);
      y += LINE_HEIGHT;
    }
    y += LINE_HEIGHT;
  }

  const verificationPayload = payloadParts.join("|");
  const hash = createHash("sha256").update(verificationPayload).digest("hex");
  doc.addPage();
  addVerificationFooter(doc, hash);
  return { buffer: getBuffer(doc), verificationPayload };
}

export async function buildFullReportPdf(
  messages: MessageRecord[],
  expenses: ExpenseRecord[],
  patterns: PatternRecord[],
  dateRangeStart: string | null,
  dateRangeEnd: string | null
): Promise<{ buffer: Buffer; verificationPayload: string }> {
  const doc = new jsPDF();
  const dateRange =
    dateRangeStart && dateRangeEnd
      ? `${new Date(dateRangeStart).toLocaleDateString()} – ${new Date(dateRangeEnd).toLocaleDateString()}`
      : "All dates";
  addHeader(doc, "Full Case Report", dateRange);

  const payloadParts: string[] = [];
  let y = MARGIN + 22;

  doc.setFontSize(12);
  doc.text("1. Message Transcript", MARGIN, y);
  y += LINE_HEIGHT + 2;
  doc.setFontSize(10);
  for (const m of messages) {
    if (y > Y_MAX) {
      doc.addPage();
      y = MARGIN;
    }
    payloadParts.push("m", m.id, m.created_at);
    const line = `${new Date(m.created_at).toLocaleString()} [${m.direction}] ${(m.ai_rewritten_content ?? m.original_content).slice(0, 100)}…`;
    const lines = doc.splitTextToSize(line, CONTENT_WIDTH);
    doc.text(lines, MARGIN, y);
    y += LINE_HEIGHT * lines.length;
  }

  y += LINE_HEIGHT;
  doc.setFontSize(12);
  doc.text("2. Expense Ledger", MARGIN, y);
  y += LINE_HEIGHT + 2;
  doc.setFontSize(10);
  for (const e of expenses) {
    if (y > Y_MAX) {
      doc.addPage();
      y = MARGIN;
    }
    payloadParts.push("e", e.id, e.created_at);
    const line = `${new Date(e.created_at).toLocaleDateString()} | $${e.amount} | ${e.description}`;
    const lines = doc.splitTextToSize(line, CONTENT_WIDTH);
    doc.text(lines, MARGIN, y);
    y += LINE_HEIGHT * lines.length;
  }

  y += LINE_HEIGHT;
  doc.setFontSize(12);
  doc.text("3. Pattern Summary", MARGIN, y);
  y += LINE_HEIGHT + 2;
  doc.setFontSize(10);
  for (const p of patterns) {
    if (y > Y_MAX) {
      doc.addPage();
      y = MARGIN;
    }
    payloadParts.push("p", p.id, p.flag_type);
    doc.text(`${p.flag_type}: ${p.occurrence_count} (${p.trend ?? "—"})`, MARGIN, y);
    y += LINE_HEIGHT;
  }

  const verificationPayload = payloadParts.join("|");
  const hash = createHash("sha256").update(verificationPayload).digest("hex");
  doc.addPage();
  addVerificationFooter(doc, hash);
  return { buffer: getBuffer(doc), verificationPayload };
}

export function sha256Buffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function sha256String(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}
