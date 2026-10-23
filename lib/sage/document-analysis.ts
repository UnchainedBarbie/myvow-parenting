import { documentDownloadAccess } from "@/lib/documents-tab";
import { documentExtension } from "@/lib/documents-files";
import {
  extractDocument,
  type ExtractionResult,
  type SheetTable,
} from "@/lib/documents/extract-document";
import { buildObservationFromChat } from "@/lib/sage/observation-builder";
import type { ProcessObservationResult } from "@/lib/sage/process-observation";
import { requestsDocumentAnalysis } from "@/lib/sage/document-read";

export type AnalysisOrigin = "current" | "incoming" | "session" | "library";

export type AnalysisFile = {
  id: string;
  fileName: string;
  origin: AnalysisOrigin;
  messageId: string | null;
  caseId: string;
  visibility: string | null;
  uploadedBy: string | null;
  status: string | null;
  linkedOnCase: boolean;
};

export type AnalysisViewer = { userId: string; role: string | null | undefined };

const SHEET_EXT = new Set(["xlsx", "xls", "csv"]);
const PERSON_HEADERS = /doctor|pediatrician|provider|physician|^name$/i;
const PRACTICE_HEADERS = /practice|clinic|office/i;
const COMPARE_HEADERS = /accepting|insurance|phone|distance|rating|notes|address|specialty/i;
const MISSING_TOPICS = ["qualifications", "reviews", "availability"];

export function resolveAnalysisFile(
  message: string,
  files: AnalysisFile[]
): { status: "one"; file: AnalysisFile } | { status: "choose"; files: AnalysisFile[] } | { status: "none" } {
  const named = files.filter((file) => mentionsFile(message, file.fileName));
  const namedPick = pickGroup(named, message);
  if (namedPick) return namedPick;

  for (const origin of ["current", "incoming", "session"] as const) {
    const group = files.filter((file) => file.origin === origin);
    const picked = pickGroup(group, message);
    if (picked) return picked;
  }
  if (files.length === 1) return { status: "one", file: files[0] };
  const hint = typeHint(message);
  if (hint !== "any") {
    const hinted = files.filter((file) => matchesHint(file.fileName, hint));
    if (hinted.length === 1) return { status: "one", file: hinted[0] };
    if (hinted.length > 1) return { status: "choose", files: hinted };
  }
  return { status: "none" };
}

export function analysisAccess(
  file: AnalysisFile,
  viewer: AnalysisViewer,
  caseId: string
): "ok" | "denied" {
  if (file.caseId !== caseId) return "denied";
  const link = file.linkedOnCase ? "same_case" : "none";
  const access = documentDownloadAccess({
    found: true,
    status: file.status,
    visibility: file.visibility,
    uploadedBy: file.uploadedBy,
    viewerId: viewer.userId,
    viewerRole: viewer.role ?? null,
    viewerIsMember: true,
    link,
  });
  return access === "ok" ? "ok" : "denied";
}

export async function performDocumentAnalysis(input: {
  message: string;
  files: AnalysisFile[];
  viewer: AnalysisViewer;
  caseId: string;
  loadBytes: (file: AnalysisFile) => Promise<Buffer | null>;
  extractPdf?: (buffer: Buffer) => Promise<string>;
}): Promise<{ reply: string; fileName: string } | null> {
  const inReach = input.files.length > 0;
  if (!requestsDocumentAnalysis(input.message, inReach)) return null;
  const resolved = resolveAnalysisFile(input.message, input.files);
  if (resolved.status === "none") {
    return { reply: "Which file should I read? Name the document and I'll use only that file.", fileName: "" };
  }
  if (resolved.status === "choose") {
    const names = resolved.files.map((file) => file.fileName).join(", ");
    return { reply: `Which file do you mean? I see ${names}.`, fileName: "" };
  }
  const file = resolved.file;
  if (analysisAccess(file, input.viewer, input.caseId) !== "ok") {
    return { reply: "You don't have access to that file. I didn't read it.", fileName: file.fileName };
  }
  if (documentExtension(file.fileName) === "doc") {
    return {
      reply: `${file.fileName} is stored. Legacy Word .doc files can't be extracted safely, so I haven't read its contents.`,
      fileName: file.fileName,
    };
  }
  const bytes = await input.loadBytes(file);
  if (!bytes || bytes.length === 0) {
    return {
      reply: `${file.fileName} is stored, but I couldn't open it. I didn't treat it as missing.`,
      fileName: file.fileName,
    };
  }
  const extracted = await extractDocument(bytes, file.fileName, { extractPdf: input.extractPdf });
  return { reply: composeAnalysisReply(file.fileName, extracted), fileName: file.fileName };
}

export function composeAnalysisReply(fileName: string, extracted: ExtractionResult): string {
  if (!extracted.ok) {
    return `${fileName} is stored. ${extracted.reason}`;
  }
  const lead = `I read ${fileName}. This uses only that file. I did not look up anything outside it.`;
  if (extracted.kind === "text") {
    const limit = extracted.truncated
      ? ` The extracted text was cut at the length limit, so this is not the entire ${extracted.label.toLowerCase()}.`
      : "";
    return `${lead}${limit}\n\n${extracted.label} (data only):\n${extracted.text}\n\nI didn't send this, file it, or change any records.`;
  }
  const parts = [lead];
  if (extracted.macrosIgnored) parts.push("Macros in the workbook were not run.");
  for (const sheet of extracted.sheets) parts.push(sheetSection(sheet));
  if (extracted.unreadSheets.length > 0) {
    parts.push(
      `These sheets were not read because the workbook is past the sheet limit: ${extracted.unreadSheets.join(", ")}.`
    );
  }
  const formulas = extracted.sheets.reduce((sum, sheet) => sum + sheet.formulasNotRun, 0);
  const links = extracted.sheets.reduce((sum, sheet) => sum + sheet.externalLinksSkipped, 0);
  if (formulas > 0 || links > 0) {
    parts.push(
      `I did not run ${formulas} formula${formulas === 1 ? "" : "s"} or open ${links} external link${links === 1 ? "" : "s"}.`
    );
  }
  parts.push(assessment(extracted.sheets));
  parts.push("I didn't send this, file it, or change any records.");
  return parts.filter(Boolean).join("\n\n");
}

export function analysisObservationResult(
  reply: string,
  fileName: string,
  sourceId?: string
): ProcessObservationResult {
  const observation = buildObservationFromChat(fileName || "document", { id: sourceId });
  return {
    observation,
    interpretation: {
      intent: {
        item_type: "document_summary",
        domain: "general",
        summary: fileName ? `Read ${fileName}` : "Read a document",
        evidence_excerpt: fileName || "document",
        tool_name: null,
        action_required: false,
        action_type: null,
        urgency: "normal",
        confidence: 1,
      },
      entities: {
        children: [],
        people: [],
        dates: [],
        amounts: [],
        merchants: [],
        providers: [],
        documents: fileName ? [{ name: fileName }] : [],
      },
      reasoning: { signals: ["explicit document read"] },
    },
    child_ids: [],
    unresolved_children: [],
    resolved_dates: [],
    plan: {
      status: "no_action",
      reasoning: "The parent asked Sage to read a document. Nothing was filed or sent.",
      proposals: [],
    },
  };
}

function sheetSection(sheet: SheetTable): string {
  const lines = [`Sheet "${sheet.name}"`];
  if (sheet.headers.length > 0) lines.push(`Columns: ${sheet.headers.join(", ")}`);
  for (const row of sheet.rows) {
    const pairs = sheet.headers.map((header, index) => `${header}: ${row.cells[index] ?? ""}`);
    lines.push(`Row ${row.row}: ${pairs.join("; ")}`);
  }
  if (sheet.omittedRows > 0 || sheet.omittedCols > 0) {
    lines.push(
      `This is not the whole sheet. ${sheet.name} has ${sheet.totalRows} rows and ${sheet.totalCols} columns. ${sheet.omittedRows} rows and ${sheet.omittedCols} columns were left out.`
    );
  }
  return lines.join("\n");
}

function assessment(sheets: SheetTable[]): string {
  const names: string[] = [];
  const practices: string[] = [];
  const compared: string[] = [];
  const missing = new Set(MISSING_TOPICS);
  for (const sheet of sheets) {
    sheet.headers.forEach((header, index) => {
      const bucket = PERSON_HEADERS.test(header) ? names : PRACTICE_HEADERS.test(header) ? practices : null;
      if (bucket) {
        for (const row of sheet.rows) {
          const value = (row.cells[index] ?? "").trim();
          if (value) bucket.push(`${value} (Sheet "${sheet.name}", row ${row.row})`);
        }
      }
      if (COMPARE_HEADERS.test(header)) missing.delete(header.toLowerCase());
      if (/qualif|credential|board|review|rating|availab|accepting/i.test(header)) {
        if (/qualif|credential|board/i.test(header)) missing.delete("qualifications");
        if (/review|rating/i.test(header)) missing.delete("reviews");
        if (/availab|accepting/i.test(header)) missing.delete("availability");
      }
    });
    for (const row of sheet.rows) {
      const bits = sheet.headers
        .map((header, index) =>
          COMPARE_HEADERS.test(header) && (row.cells[index] ?? "").trim()
            ? `${header} ${row.cells[index]}`
            : ""
        )
        .filter(Boolean);
      if (bits.length > 0) {
        const who = nameOnRow(sheet, row.cells) || `row ${row.row}`;
        compared.push(`${who}: ${bits.join(", ")}`);
      }
    }
  }
  const lines: string[] = [];
  if (names.length > 0) lines.push(`Names in the file: ${names.join("; ")}.`);
  if (practices.length > 0) lines.push(`Practices in the file: ${practices.join("; ")}.`);
  if (compared.length > 0) lines.push(`What the sheet actually gives to compare: ${compared.join("; ")}.`);
  if (missing.size > 0) {
    lines.push(
      `The file does not include ${[...missing].join(", ")}. I can't rank the options on those, and I didn't invent them.`
    );
  }
  if (lines.length === 0) lines.push("I can only describe the cells above. I didn't add facts that aren't in the file.");
  return lines.join(" ");
}

function nameOnRow(sheet: SheetTable, cells: string[]): string {
  const index = sheet.headers.findIndex((header) => PERSON_HEADERS.test(header) || PRACTICE_HEADERS.test(header));
  if (index < 0) return "";
  return (cells[index] ?? "").trim();
}

function pickGroup(
  files: AnalysisFile[],
  message: string
): { status: "one"; file: AnalysisFile } | { status: "choose"; files: AnalysisFile[] } | null {
  if (files.length === 0) return null;
  const hint = typeHint(message);
  const pool = hint === "any" ? files : files.filter((file) => matchesHint(file.fileName, hint));
  if (pool.length === 0) return null;
  if (pool.length === 1) return { status: "one", file: pool[0] };
  return { status: "choose", files: pool };
}

function mentionsFile(message: string, fileName: string): boolean {
  const name = fileName.trim().toLowerCase();
  if (name.length > 2 && message.toLowerCase().includes(name)) return true;
  const stem = name.replace(/\.[a-z0-9]+$/, "");
  return stem.length > 3 && message.toLowerCase().includes(stem);
}

function typeHint(message: string): "sheet" | "pdf" | "doc" | "any" {
  if (/\b(spreadsheet|workbook|excel|xlsx|xls|csv|sheet)\b/i.test(message)) return "sheet";
  if (/\bpdf\b/i.test(message)) return "pdf";
  if (/\b(word|docx|doc)\b/i.test(message)) return "doc";
  return "any";
}

function matchesHint(fileName: string, hint: "sheet" | "pdf" | "doc"): boolean {
  const ext = documentExtension(fileName);
  if (hint === "sheet") return SHEET_EXT.has(ext);
  if (hint === "pdf") return ext === "pdf";
  return ext === "doc" || ext === "docx";
}
