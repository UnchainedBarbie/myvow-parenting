import { documentDownloadAccess } from "@/lib/documents-tab";
import { documentExtension } from "@/lib/documents-files";
import { extractDocument, type ExtractionResult } from "@/lib/documents/extract-document";
import { buildObservationFromChat } from "@/lib/sage/observation-builder";
import type { ProcessObservationResult } from "@/lib/sage/process-observation";
import { requestsDocumentAnalysis, type AnalysisTurn } from "@/lib/sage/document-read";
import { answerDocumentQuestion, localDocumentReply, type ReasonPacket } from "@/lib/sage/document-reason";
import type { CommunicationBrief } from "@/lib/sage/communication-reading";

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
  /** Loads the message this file arrived with, seen from the receiving parent. Called for the chosen file only. */
  loadBrief?: () => Promise<CommunicationBrief | null>;
};

export type AnalysisViewer = { userId: string; role: string | null | undefined };

const SHEET_EXT = new Set(["xlsx", "xls", "csv"]);

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
  recentTurns?: AnalysisTurn[];
  reason?: (packet: ReasonPacket) => Promise<string | null>;
}): Promise<{ reply: string; fileName: string } | null> {
  const inReach = input.files.length > 0;
  const turns = input.recentTurns ?? [];
  if (!requestsDocumentAnalysis(input.message, inReach, turns)) return null;
  const resolved = resolveForTurn(input.message, input.files, turns);
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
  const communication = file.loadBrief ? await file.loadBrief().catch(() => null) : null;
  const reply = await answerDocumentQuestion({
    question: input.message,
    fileName: file.fileName,
    extracted,
    reason: input.reason,
    communication: communication ?? undefined,
  });
  return { reply, fileName: file.fileName };
}

export function composeAnalysisReply(fileName: string, extracted: ExtractionResult): string {
  return localDocumentReply(fileName ? `Summarize ${fileName}` : "Summarize this file.", fileName, extracted);
}

function resolveForTurn(
  message: string,
  files: AnalysisFile[],
  turns: AnalysisTurn[]
): { status: "one"; file: AnalysisFile } | { status: "choose"; files: AnalysisFile[] } | { status: "none" } {
  if (files.some((file) => mentionsFile(message, file.fileName))) {
    return resolveAnalysisFile(message, files);
  }
  const prior = priorReadFile(files, turns);
  if (prior) return { status: "one", file: prior };
  return resolveAnalysisFile(message, files);
}

function priorReadFile(files: AnalysisFile[], turns: AnalysisTurn[]): AnalysisFile | null {
  const sage = [...turns].reverse().find((turn) => turn.role === "sage" && /\bI read\b/i.test(turn.text));
  if (!sage) return null;
  const hits = files.filter((file) => mentionsFile(sage.text, file.fileName));
  return hits.length === 1 ? hits[0] : null;
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
