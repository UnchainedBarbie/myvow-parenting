import type { SupabaseClient } from "@supabase/supabase-js";
import { analysisAccess, type AnalysisFile, type AnalysisViewer } from "@/lib/sage/document-analysis";
import { requestsDocumentAnalysis, type AnalysisTurn } from "@/lib/sage/document-read";
import { isMessageId } from "@/lib/sage/original-message";

type Admin = SupabaseClient;

type DocRow = {
  id: string;
  case_id: string;
  file_name: string | null;
  title: string | null;
  visibility: string | null;
  uploaded_by: string | null;
  status: string | null;
  storage_path: string | null;
};

/**
 * File names and relationships for an explicit read.
 * Returns null when this turn is not a read, and does not download bytes either way
 * until the chosen file is authorized.
 */
export async function prepareAnalysisRead(
  admin: Admin,
  input: {
    message: string;
    caseId: string;
    userId: string;
    role: string | null;
    sessionId: string | null;
    currentDocumentId: string | null;
    recentTurns?: AnalysisTurn[];
  }
): Promise<{ files: AnalysisFile[]; loadBytes: (file: AnalysisFile) => Promise<Buffer | null> } | null> {
  if (!requestsDocumentAnalysis(input.message, true, input.recentTurns ?? [])) return null;
  const viewer: AnalysisViewer = { userId: input.userId, role: input.role };
  const session = input.sessionId ? await sessionLinks(admin, input.sessionId, input.userId) : { messageIds: [], texts: [] };
  const linked = await linksForMessages(admin, session.messageIds);
  const docs = await caseDocuments(admin, input.caseId, [
    ...linked.keys(),
    ...(input.currentDocumentId ? [input.currentDocumentId] : []),
  ]);
  const files: AnalysisFile[] = [];
  for (const doc of docs) {
    const messageId = linked.get(doc.id) ?? null;
    const origin = originFor(doc, input.currentDocumentId, messageId, session.texts);
    const file: AnalysisFile = {
      id: doc.id,
      fileName: (doc.file_name || doc.title || "document").trim(),
      origin,
      messageId,
      caseId: doc.case_id,
      visibility: doc.visibility,
      uploadedBy: doc.uploaded_by,
      status: doc.status,
      linkedOnCase: messageId != null,
    };
    files.push(file);
  }
  const paths = new Map(docs.map((doc) => [doc.id, (doc.storage_path ?? "").trim()]));
  return {
    files,
    loadBytes: async (file) => {
      if (analysisAccess(file, viewer, input.caseId) !== "ok") return null;
      const path = paths.get(file.id) ?? "";
      if (!path) return null;
      const { data, error } = await admin.storage.from("documents").download(path);
      if (error || !data) return null;
      return Buffer.from(await data.arrayBuffer());
    },
  };
}

function originFor(
  doc: DocRow,
  currentId: string | null,
  messageId: string | null,
  texts: string[]
): AnalysisFile["origin"] {
  if (currentId && doc.id === currentId) return "current";
  if (messageId) return "incoming";
  const name = (doc.file_name ?? "").trim().toLowerCase();
  const stem = name.replace(/\.[a-z0-9]+$/, "");
  const generic = new Set(["review", "file", "document", "spreadsheet", "report", "attachment", "sheet"]);
  if (stem.length > 3 && !generic.has(stem) && texts.some((text) => text.toLowerCase().includes(stem))) {
    return "session";
  }
  return "library";
}

async function sessionLinks(
  admin: Admin,
  sessionId: string,
  userId: string
): Promise<{ messageIds: string[]; texts: string[] }> {
  const selected = await admin
    .from("sage_journal_messages")
    .select("role, content, source_message_id")
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);
  const rows = selected.error && /source_message_id/i.test(selected.error.message ?? "")
    ? (
        await admin
          .from("sage_journal_messages")
          .select("role, content")
          .eq("session_id", sessionId)
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(20)
      ).data
    : selected.data;
  const messageIds: string[] = [];
  const texts: string[] = [];
  for (const row of rows ?? []) {
    const source = (row as { source_message_id?: string | null }).source_message_id;
    if (isMessageId(source) && !messageIds.includes(source as string)) messageIds.push(source as string);
    if ((row as { role?: string }).role === "user") {
      const content = ((row as { content?: string | null }).content ?? "").trim();
      if (content) texts.push(content);
    }
  }
  return { messageIds, texts };
}

async function linksForMessages(admin: Admin, messageIds: string[]): Promise<Map<string, string>> {
  const links = new Map<string, string>();
  if (messageIds.length === 0) return links;
  const { data } = await admin
    .from("message_documents")
    .select("message_id, document_id")
    .in("message_id", messageIds);
  for (const row of data ?? []) {
    const documentId = (row as { document_id?: string }).document_id;
    const messageId = (row as { message_id?: string }).message_id;
    if (documentId && messageId && !links.has(documentId)) links.set(documentId, messageId);
  }
  return links;
}

async function caseDocuments(admin: Admin, caseId: string, extraIds: string[]): Promise<DocRow[]> {
  const columns = "id, case_id, file_name, title, visibility, uploaded_by, status, storage_path";
  const { data, error } = await admin
    .from("documents")
    .select(columns)
    .eq("case_id", caseId)
    .in("status", ["active", "pending"])
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(40);
  const rows = error || !data ? [] : (data as DocRow[]);
  const have = new Set(rows.map((row) => row.id));
  const missing = [...new Set(extraIds.filter((id) => id && !have.has(id)))];
  if (missing.length === 0) return rows;
  const extra = await admin.from("documents").select(columns).eq("case_id", caseId).in("id", missing);
  for (const row of (extra.data ?? []) as DocRow[]) {
    if (!have.has(row.id)) rows.push(row);
  }
  return rows;
}
