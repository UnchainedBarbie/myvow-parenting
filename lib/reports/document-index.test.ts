import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { documentAuthorizedForViewer, documentCategoryLabel, documentVisibilityLabel } from "@/lib/documents-tab";
import { buildDocumentIndexCsv, prepareDocumentIndex } from "@/lib/reports/document-index";
import { buildDocumentIndexPdf } from "@/lib/reports/document-index-pdf";
import { labelsForSupportingFiles } from "@/lib/reports/evidence-refs";
import {
  appendSupportingFiles,
  dedupeSupportingFiles,
  fitContain,
  uniqueSupportingFiles,
  type SupportingFile,
} from "@/lib/reports/embed-attachments";

assert.equal(documentCategoryLabel("financial"), "Expenses");
assert.equal(documentCategoryLabel("school"), "School");
assert.equal(documentVisibilityLabel("private"), "Just me");
assert.equal(documentVisibilityLabel("parents_only"), "Parents only");
assert.equal(documentVisibilityLabel("family_read_only"), "Family");
assert.equal(
  documentAuthorizedForViewer({ visibility: "private", uploadedBy: "alex" }, { userId: "jordan", role: "parent" }),
  false
);
assert.equal(
  documentAuthorizedForViewer({ visibility: "private", uploadedBy: "alex" }, { userId: "alex", role: "parent" }),
  true
);
assert.equal(
  documentAuthorizedForViewer({ visibility: "parents_only", uploadedBy: "alex" }, { userId: "jordan", role: "parent" }),
  true
);
assert.equal(
  documentAuthorizedForViewer({ visibility: "parents_only", uploadedBy: "alex" }, { userId: "kid", role: "child" }),
  false
);

const prepared = prepareDocumentIndex({
  documents: [
    {
      id: "b",
      documentNumber: 12,
      title: "School note",
      fileName: "note.pdf",
      category: "school",
      childName: "All children",
      createdAt: "2026-01-02T00:00:00.000Z",
      visibility: "family",
      conversations: ["Pickup change"],
      uploadedByName: "Alex Rivera",
      linkedExpenses: ["EXP-010"],
      linkedMessages: [],
      hasStoredFile: false,
    },
    {
      id: "a",
      documentNumber: 4,
      title: "",
      fileName: "scan.png",
      category: "medical",
      childName: "Sam",
      createdAt: "2026-03-01T00:00:00.000Z",
      visibility: "private",
      conversations: [],
      uploadedByName: null,
      linkedExpenses: [],
      linkedMessages: ["Message link stored"],
      hasStoredFile: true,
    },
  ],
  parents: [{ name: "Alex Rivera" }],
  caseLabel: "FAM-100",
  timeZone: "America/Denver",
  generatedAt: new Date("2026-04-01T15:00:00.000Z"),
  options: { documentList: true, linkedConversations: true, includeFiles: false },
  withheldCount: 1,
  fileLines: [],
  linkWarning: null,
});

const table = prepared.document.blocks.find((block) => block.kind === "table");
assert.ok(table && table.kind === "table");
assert.deepEqual(table.headers, [
  "Document ID",
  "Title",
  "Original filename",
  "Category",
  "Child",
  "Upload date",
  "Uploaded by",
  "Visibility",
  "Linked conversations",
  "Linked records",
  "Supporting evidence",
]);
assert.equal(table.widths.reduce((sum, width) => sum + width, 0), 255.4);
assert.equal(table.rows[0][0], "DOC-004");
assert.equal(table.rows[0][1], "scan.png");
assert.equal(table.rows[0][3], "Medical");
assert.equal(table.rows[0][6], "Not recorded");
assert.equal(table.rows[0][7], "Just me");
assert.equal(table.rows[0][8], "No linked conversation stored");
assert.match(table.rows[0][10], /Attachments excluded from this export/);
assert.doesNotMatch(table.rows[0][10], /pp\./);
assert.equal(table.rows[1][0], "DOC-012");
assert.equal(table.rows[1][6], "Alex Rivera");
assert.equal(table.rows[1][8], "Pickup change");
assert.match(table.rows[1][9], /EXP-010/);
assert.match(prepared.document.completeness, /1 document is omitted/);
assert.equal(prepared.includedCount, 2);

const indexCsv = buildDocumentIndexCsv(
  [
    {
      id: "a",
      documentNumber: 4,
      title: "Line one\nLine two, \"quoted\"",
      fileName: "scan.png",
      category: "medical",
      childName: "Sam",
      createdAt: "2026-03-01T00:00:00.000Z",
      visibility: "private",
      conversations: ["Pickup, evening"],
      uploadedByName: null,
      linkedExpenses: ["EXP-010"],
      linkedMessages: ["Message link stored"],
      hasStoredFile: true,
    },
  ],
  "America/Denver"
);
assert.match(
  indexCsv,
  /Document ID,Title,Original filename,Category,Child,Uploaded date,Uploaded by,Visibility,Linked conversations,Linked record IDs,Attachment availability\/status/
);
assert.match(indexCsv, /"Line one\r?\nLine two, ""quoted"""/);
assert.match(indexCsv, /"Pickup, evening"/);
assert.match(indexCsv, /EXP-010; Message link stored/);
assert.match(indexCsv, /Available/);
assert.doesNotMatch(indexCsv, /\bpp?\./);

const pdf = buildDocumentIndexPdf(prepared.document, "FAM-100", prepared.verificationPayload);
assert.match(Buffer.from(pdf.buffer).toString("latin1"), /MediaBox \[0 0 792\.? 612\.?\]/);
assert.ok(pdf.pageCount >= 1);

const wide = fitContain(1000, 100, 720, 400);
assert.equal(wide.width, 720);
assert.equal(wide.height, 72);
const tall = fitContain(100, 1000, 720, 400);
assert.equal(tall.width, 40);
assert.equal(tall.height, 400);

const shared = uniqueSupportingFiles([
  {
    key: "doc-1",
    records: ["EXP-001", "DOC-012"],
    fileName: "receipt.pdf",
    mimeType: "application/pdf",
    bytes: Buffer.from("a"),
    unavailableReason: null,
  },
  {
    key: "doc-1",
    records: ["EXP-004", "DOC-012"],
    fileName: "receipt.pdf",
    mimeType: "application/pdf",
    bytes: Buffer.from("a"),
    unavailableReason: null,
  },
]);
assert.equal(shared.length, 1);
assert.deepEqual(shared[0].records, ["EXP-001", "DOC-012", "EXP-004"]);

const sameBytes = Buffer.from("identical-file-bytes");
const deduped = dedupeSupportingFiles([
  {
    key: "doc-34",
    records: ["DOC-034", "MSG-014"],
    documentLabel: "DOC-034",
    fileName: "availability.pdf",
    mimeType: "application/pdf",
    bytes: sameBytes,
    unavailableReason: null,
  },
  {
    key: "doc-33",
    records: ["DOC-033", "MSG-015"],
    documentLabel: "DOC-033",
    fileName: "availability.pdf",
    mimeType: "application/pdf",
    bytes: Buffer.from("identical-file-bytes"),
    unavailableReason: null,
  },
  {
    key: "doc-10",
    records: ["DOC-010"],
    documentLabel: "DOC-010",
    fileName: "availability.pdf",
    mimeType: "application/pdf",
    bytes: Buffer.from("different-file-bytes"),
    unavailableReason: null,
  },
]);
assert.equal(deduped.length, 2);
assert.deepEqual(deduped[0].records, ["DOC-034", "MSG-014", "DOC-033", "MSG-015"]);
assert.match(deduped[0].documentLabel ?? "", /DOC-034/);
assert.match(deduped[0].documentLabel ?? "", /DOC-033/);
assert.deepEqual(deduped[1].records, ["DOC-010"]);
const sharedPages = labelsForSupportingFiles(
  1,
  deduped.map((file) => ({
    records: file.records,
    pages: 2,
    documentLabel: file.documentLabel ?? null,
    unavailable: false,
    embedded: true,
  }))
);
assert.equal(sharedPages.get("MSG-014"), sharedPages.get("MSG-015"));
assert.match(sharedPages.get("DOC-034") ?? "", /pp\. 2/);
assert.notEqual(sharedPages.get("DOC-034"), sharedPages.get("DOC-010"));

async function main() {
const sourcePdf = await PDFDocument.create();
const first = sourcePdf.addPage([200, 180]);
first.drawText("ORIGINAL-PAGE-ONE", { x: 12, y: 80, size: 12, font: await sourcePdf.embedFont(StandardFonts.TimesRoman) });
sourcePdf.addPage([300, 240]);
const sourceBytes = Buffer.from(await sourcePdf.save());

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const files: SupportingFile[] = [
  {
    key: "doc-1",
    records: ["DOC-012", "EXP-001"],
    fileName: "letter.pdf",
    mimeType: "application/pdf",
    bytes: sourceBytes,
    unavailableReason: null,
  },
  {
    key: "doc-1",
    records: ["EXP-004"],
    fileName: "letter.pdf",
    mimeType: "application/pdf",
    bytes: sourceBytes,
    unavailableReason: null,
  },
  {
    key: "doc-2",
    records: ["DOC-020"],
    fileName: "photo.png",
    mimeType: "image/png",
    bytes: png,
    unavailableReason: null,
  },
  {
    key: "doc-3",
    records: ["EXP-009"],
    fileName: "notes.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    bytes: Buffer.from("original-docx-bytes"),
    unavailableReason: null,
  },
  {
    key: "doc-4",
    records: ["DOC-030"],
    fileName: "missing.pdf",
    mimeType: "application/pdf",
    bytes: null,
    unavailableReason: "The file could not be downloaded.",
  },
];

const base = await PDFDocument.create();
base.addPage([792, 612]);
const appended = await appendSupportingFiles(Buffer.from(await base.save()), files, "documents");
const opened = await PDFDocument.load(appended.pdf);
assert.equal(opened.getPageCount(), 5);
const pages = opened.getPages();
assert.equal(pages[1].getWidth(), 200);
assert.ok(pages[1].getHeight() > 208);
assert.equal(pages[2].getWidth(), 300);
assert.equal(pages[2].getHeight(), 268);
assert.equal(pages[3].getWidth(), 792);
assert.equal(pages[3].getHeight(), 612);
assert.equal(appended.bundle.length, 1);
assert.equal(appended.bundle[0].buffer.toString(), "original-docx-bytes");
assert.match(appended.bundle[0].name, /^documents\/notes\.docx$/);

console.log("document index tests passed");
}

void main();
