import assert from "node:assert/strict";
import { unreadDocumentClassification, runClassify } from "@/lib/ai-classify";
import { documentAuthorizedForViewer } from "@/lib/documents-tab";
import {
  DOCUMENT_MAX_BYTES,
  documentBytesProblem,
  documentCanBeRead,
  documentFileProblem,
  documentPreviewNote,
  documentStoredContentType,
  originalDocumentName,
  XLSX_MIME,
} from "@/lib/documents-files";
import { processChatAttachment } from "@/lib/sage/process-chat-attachment";

const today = new Date("2026-10-21T18:00:00Z");
const timezone = "America/Denver";

function bytesOf(parts: Array<number[] | string>): Uint8Array {
  const chunks = parts.map((part) =>
    typeof part === "string" ? Uint8Array.from(part, (char) => char.charCodeAt(0)) : Uint8Array.from(part)
  );
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

const pdf = bytesOf([[0x25, 0x50, 0x44, 0x46, 0x2d], "1.4"]);
const png = bytesOf([[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]]);
const jpeg = bytesOf([[0xff, 0xd8, 0xff, 0xe0], "JFIF"]);
const webp = bytesOf(["RIFF", [0, 0, 0, 0], "WEBP"]);
const docx = bytesOf([[0x50, 0x4b, 0x03, 0x04], "word/document.xml"]);
const xlsx = bytesOf([[0x50, 0x4b, 0x03, 0x04], "xl/workbook.xml"]);
const macroDocx = bytesOf([[0x50, 0x4b, 0x03, 0x04], "word/vbaProject.bin"]);
const ole = bytesOf([[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], "WordDocument"]);
const oleMacro = bytesOf([[0xd0, 0xcf, 0x11, 0xe0], "_VBA_PROJECT_CUR"]);
const csv = bytesOf(["date,amount\n2026-01-01,12.00\n"]);
const text = bytesOf(["Occupational therapy notes for the evaluation."]);
const html = bytesOf(["<html><script>alert(1)</script></html>"]);
const executable = bytesOf([[0x4d, 0x5a], "program"]);

const supported = [
  ["evaluation.pdf", "application/pdf", pdf],
  ["photo.png", "image/png", png],
  ["photo.jpg", "image/jpeg", jpeg],
  ["photo.jpeg", "", jpeg],
  ["photo.webp", "image/webp", webp],
  ["letter.doc", "application/msword", ole],
  ["letter.docx", "", docx],
  ["budget.xls", "application/vnd.ms-excel", ole],
  ["budget.xlsx", XLSX_MIME, xlsx],
  ["budget.csv", "text/csv", csv],
  ["notes.txt", "text/plain", text],
] as const;

for (const [name, mime, body] of supported) {
  assert.equal(documentFileProblem(name, mime, body.byteLength), null, name);
  assert.equal(documentBytesProblem(name, mime, body.byteLength, body), null, name);
  assert.equal(documentStoredContentType(name, body)?.length ? true : false, true, name);
}

assert.equal(documentFileProblem("setup.exe", "application/pdf", 20)?.includes("isn't supported"), true);
assert.equal(documentFileProblem("sheet.docm", "", 20)?.includes("isn't supported"), true);
assert.equal(documentFileProblem("budget.xlsx", "image/png", xlsx.byteLength)?.includes("does not match"), true);
assert.equal(documentBytesProblem("evaluation.pdf", "application/pdf", executable.byteLength, executable)?.includes("program"), true);
assert.equal(documentBytesProblem("evaluation.pdf", "application/pdf", png.byteLength, png)?.includes("don't match"), true);
assert.equal(documentBytesProblem("letter.docx", "", macroDocx.byteLength, macroDocx)?.includes("Macro"), true);
assert.equal(documentBytesProblem("budget.xls", "", oleMacro.byteLength, oleMacro)?.includes("Macro"), true);
assert.equal(documentBytesProblem("notes.csv", "text/csv", html.byteLength, html)?.includes("program"), true);
assert.equal(documentBytesProblem("empty.txt", "text/plain", 0, new Uint8Array())?.includes("empty"), true);
assert.equal(
  documentFileProblem("huge.pdf", "application/pdf", DOCUMENT_MAX_BYTES + 1)?.includes("25MB"),
  true
);

assert.equal(originalDocumentName("C:\\Users\\parent\\Ashley OT Evaluation.xlsx"), "Ashley OT Evaluation.xlsx");
assert.equal(documentStoredContentType("Ashley OT Evaluation.xlsx", xlsx), XLSX_MIME);
assert.equal(documentCanBeRead("budget.xlsx", XLSX_MIME), false);
assert.equal(documentCanBeRead("letter.docx", ""), false);
assert.equal(documentCanBeRead("notes.csv", "text/csv"), false);
assert.equal(documentCanBeRead("notes.txt", "text/plain"), false);
assert.equal(documentCanBeRead("evaluation.pdf", "application/pdf"), true);
assert.equal(documentCanBeRead("photo.png", "image/png"), true);
assert.equal(documentPreviewNote("budget.xlsx", XLSX_MIME)?.includes("Download"), true);
assert.equal(documentPreviewNote("notes.csv", "text/csv")?.includes("Download"), true);
assert.equal(documentPreviewNote("notes.txt", "text/plain")?.includes("Download"), true);
assert.equal(documentPreviewNote("letter.docx", "")?.includes("Download"), true);
assert.equal(documentPreviewNote("photo.png", "image/png"), null);
assert.equal(documentPreviewNote("evaluation.pdf", "application/pdf"), null);

assert.equal(
  documentAuthorizedForViewer(
    { visibility: "private", uploadedBy: "parent-a" },
    { userId: "parent-b", role: "parent" }
  ),
  false
);
assert.equal(
  documentAuthorizedForViewer(
    { visibility: "private", uploadedBy: "parent-a" },
    { userId: "parent-a", role: "parent" }
  ),
  true
);
assert.equal(
  documentAuthorizedForViewer(
    { visibility: "parents_only", uploadedBy: "parent-a" },
    { userId: "child-1", role: "child" }
  ),
  false
);
assert.equal(
  documentAuthorizedForViewer(
    { visibility: "parents_only", uploadedBy: "parent-a" },
    { userId: "parent-b", role: "parent" }
  ),
  true
);

async function main() {
  const unread = await runClassify(Buffer.from(xlsx), "application/vnd.ms-excel", "Ashley OT Evaluation.xlsx");
  assert.equal(unread.contentsRead, false);
  assert.equal(unread.type, "document");
  assert.equal(unread.amount, null);
  assert.equal(unread.vendor, null);
  assert.equal(unread.start_time, null);
  assert.deepEqual(unread, unreadDocumentClassification("Ashley OT Evaluation.xlsx"));

  const saved = await processChatAttachment({
    caseId: "case-1",
    timezone,
    caption: "",
    classify: { ...unreadDocumentClassification("Ashley OT Evaluation.xlsx"), type: "expense", confidence: 0 },
    attachment: {
      document_id: "doc-sheet",
      file_name: "Ashley OT Evaluation.xlsx",
      url: "/api/documents/doc-sheet/download",
    },
    children: [{ id: "child-ashley", name: "Ashley" }],
    today,
  });
  assert.equal(saved.kind, "document");
  assert.match(saved.reply, /haven't read its contents/);
  assert.equal(saved.result?.plan.proposals.length, 1);
  const proposal = saved.result?.plan.proposals[0];
  assert.equal(proposal?.type, "log_document");
  assert.equal(proposal?.requires_approval, true);
  assert.equal(proposal?.attached_file_name, "Ashley OT Evaluation.xlsx");
  assert.equal(proposal?.attached_document_id, "doc-sheet");
  assert.equal(proposal?.attached_file_url, "/api/documents/doc-sheet/download");
  assert.equal(saved.result?.plan.proposals.some((item) => item.type === "log_expense" || item.type === "calendar_update"), false);

  console.log("documents-files tests passed");
}

main();
