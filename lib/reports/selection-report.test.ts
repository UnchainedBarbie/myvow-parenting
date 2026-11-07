import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { buildDocumentIndexCsv, documentIndexOptions, prepareDocumentIndex, type DocumentIndexSource } from "@/lib/reports/document-index";
import { buildDocumentIndexPdf } from "@/lib/reports/document-index-pdf";
import { dedupeSupportingFiles, type SupportingFile } from "@/lib/reports/embed-attachments";
import { assembleLabeledPdf } from "@/lib/reports/evidence-refs";
import { buildExpenseReportCsv, prepareExpenseReport, type ExpenseReportSource } from "@/lib/reports/expense-report";
import { buildExpenseReportPdf } from "@/lib/reports/expense-report-pdf";
import { expenseReportOptions } from "@/lib/reports/expense-report-load";
import { missingSelectedIds, recordsForSelection } from "@/lib/reports/selection-access";
import {
  packageSelectionDownload,
  selectionDocumentOptions,
  selectionExpenseOptions,
  selectionFailureMessage,
} from "@/lib/reports/selection-report";

const parents = [
  { userId: "alex", name: "Alex Rivera" },
  { userId: "jordan", name: "Jordan Lee" },
];

function expense(partial: Partial<ExpenseReportSource> & Pick<ExpenseReportSource, "id">): ExpenseReportSource {
  return {
    expenseNumber: 1,
    createdAt: "2026-10-10T18:00:00.000Z",
    incurredDate: "2026-10-10",
    description: "Expense",
    category: "medical",
    categoryDescription: null,
    amount: 0,
    submittedBy: "alex",
    amountOwed: null,
    otherParentShare: null,
    otherParentPercent: null,
    splitLabel: null,
    allocationStatus: "pending",
    status: "submitted",
    disputeReason: null,
    approvedBy: null,
    approvedAt: null,
    resolvedAt: null,
    paidAt: null,
    paymentMethod: null,
    paymentReference: null,
    paymentNotes: null,
    receiptName: null,
    receiptDocumentNumber: null,
    childName: "Sam",
    ...partial,
  };
}

function document(partial: Partial<DocumentIndexSource> & Pick<DocumentIndexSource, "id">): DocumentIndexSource {
  return {
    documentNumber: 1,
    title: "Document",
    fileName: "file.pdf",
    category: "medical",
    childName: "Sam",
    createdAt: "2026-10-10T18:00:00.000Z",
    visibility: "family",
    conversations: [],
    uploadedByName: "Alex Rivera",
    linkedExpenses: [],
    linkedMessages: [],
    hasStoredFile: true,
    description: null,
    ...partial,
  };
}

const ledger = [
  expense({ id: "e1", expenseNumber: 1, description: "Cleats", amount: 80, amountOwed: 40, otherParentShare: 40, status: "resolved" }),
  expense({ id: "e2", expenseNumber: 2, description: "Copay", amount: 20, amountOwed: 10, otherParentShare: 10, status: "paid", paidAt: "2026-10-11T18:00:00.000Z" }),
  expense({ id: "e3", expenseNumber: 3, description: "Unselected camp", amount: 500, amountOwed: 250, otherParentShare: 250, status: "resolved" }),
  expense({ id: "e4", expenseNumber: 4, description: "Tuition", amount: 30, amountOwed: 15, otherParentShare: 15, status: "submitted" }),
  expense({ id: "e5", expenseNumber: 5, description: "Uniform", amount: 45, amountOwed: 0, otherParentShare: 0, status: "logged" }),
  expense({ id: "e6", expenseNumber: 6, description: "Hidden by filter", amount: 12, amountOwed: 6, otherParentShare: 6, status: "resolved" }),
];

const selectedIds = ["e1", "e2", "e4", "e5", "e6"];
const selected = recordsForSelection(ledger, selectedIds);
assert.equal(selected.length, 5);
assert.deepEqual(selected.map((row) => row.id), selectedIds);
assert.equal(selected.some((row) => row.id === "e3"), false);
assert.deepEqual(missingSelectedIds(ledger, ["e1", "private-other"]), ["private-other"]);
assert.deepEqual(recordsForSelection(ledger, ["e1"]), [ledger[0]]);

const one = prepareExpenseReport({
  expenses: recordsForSelection(ledger, ["e2"]),
  parents,
  caseLabel: "FAM-100",
  timeZone: "America/Denver",
  dateStart: null,
  dateEnd: null,
  generatedAt: new Date("2026-11-04T16:00:00.000Z"),
  viewerId: "alex",
  viewerName: "Alex Rivera",
  options: selectionExpenseOptions({ summary: true, details: true, files: true }),
  receiptLines: ["EXP-002 — copay.jpg — not available. No receipt is stored. It is not included in the download bundle."],
  scope: "selected",
});
assert.equal(one.includedCount, 1);
assert.match(one.document.completeness, /1 selected expense record/);
assert.match(JSON.stringify(one.document), /Copay/);
assert.doesNotMatch(JSON.stringify(one.document), /Cleats|Unselected camp/);
const paidSummary = one.document.blocks.find((block) => block.kind === "lines" && block.title === "Summary");
assert.equal(paidSummary?.kind, "lines");
if (paidSummary?.kind === "lines") {
  assert.match(paidSummary.lines.join(" "), /selected expenses only/);
  assert.match(paidSummary.lines.join(" "), /counts as paid in full/);
  assert.match(paidSummary.lines.join(" "), /You are all settled/);
  assert.doesNotMatch(paidSummary.lines.join(" "), /\$10\.00/);
}

const many = prepareExpenseReport({
  expenses: selected,
  parents,
  caseLabel: "FAM-100",
  timeZone: "America/Denver",
  dateStart: null,
  dateEnd: null,
  generatedAt: new Date("2026-11-04T16:00:00.000Z"),
  viewerId: "alex",
  viewerName: "Alex Rivera",
  options: selectionExpenseOptions({ summary: true, details: true, files: false }),
  receiptLines: [],
  scope: "selected",
});
assert.equal(many.includedCount, 5);
const table = many.document.blocks.find((block) => block.kind === "table" && block.title === "Selected expenses");
assert.equal(table?.kind, "table");
if (table?.kind === "table") {
  assert.deepEqual(
    table.rows.map((row) => row[0]),
    ["EXP-006", "EXP-005", "EXP-004", "EXP-002", "EXP-001"]
  );
  assert.equal(table.rows.some((row) => row.join(" ").includes("Unselected camp")), false);
}
const summary = many.document.blocks.find((block) => block.kind === "lines" && block.title === "Summary");
assert.equal(summary?.kind, "lines");
if (summary?.kind === "lines") {
  assert.match(summary.lines.join("\n"), /Agreed outstanding[\s\S]*They owe you: \$46\.00/);
  assert.match(summary.lines.join("\n"), /Claimed, awaiting response[\s\S]*They owe you: \$15\.00/);
  assert.doesNotMatch(summary.lines.join("\n"), /\$61\.00/);
  assert.doesNotMatch(summary.lines.join(" "), /\$250\.00|Unselected/);
}
assert.equal(many.document.blocks.some((block) => block.kind === "lines" && block.title === "Receipt files"), false);
const csv = buildExpenseReportCsv(many.document);
assert.match(csv, /^Section,Field,Value/);
assert.match(csv, /EXP-001/);
assert.doesNotMatch(csv, /Unselected camp/);

const noFiles = prepareExpenseReport({
  expenses: [expense({ id: "bare", expenseNumber: 8, description: "No receipt", receiptFileId: null })],
  parents,
  caseLabel: "FAM-100",
  timeZone: "America/Denver",
  dateStart: null,
  dateEnd: null,
  generatedAt: new Date("2026-11-04T16:00:00.000Z"),
  viewerId: "alex",
  viewerName: "Alex Rivera",
  options: selectionExpenseOptions({ summary: false, details: true, files: true }),
  receiptLines: ["No receipt files are linked to the expenses in this report."],
  scope: "selected",
});
assert.match(JSON.stringify(noFiles.document), /No receipt files are linked/);
assert.equal(noFiles.document.blocks.some((block) => block.title === "Summary"), false);

const docs = [
  document({ id: "d1", documentNumber: 4, title: "School note", fileName: "note.pdf", description: "Parent typed this." }),
  document({ id: "d2", documentNumber: 5, title: "Photo", fileName: "photo.png", hasStoredFile: false, description: null }),
  document({ id: "d3", documentNumber: 9, title: "Not selected", fileName: "other.pdf" }),
];
const chosenDocs = recordsForSelection(docs, ["d1", "d2"]);
const docReport = prepareDocumentIndex({
  documents: chosenDocs,
  parents: [{ name: "Alex Rivera" }],
  caseLabel: "FAM-100",
  timeZone: "America/Denver",
  generatedAt: new Date("2026-11-04T16:00:00.000Z"),
  options: selectionDocumentOptions({ index: true, metadata: true, files: false }),
  withheldCount: 0,
  fileLines: [],
  linkWarning: null,
  scope: "selected",
});
assert.equal(docReport.includedCount, 2);
assert.match(docReport.document.completeness, /2 selected documents/);
assert.doesNotMatch(JSON.stringify(docReport.document), /Not selected/);
const details = docReport.document.blocks.find((block) => block.kind === "lines" && block.title === "Document details");
assert.equal(details?.kind, "lines");
if (details?.kind === "lines") {
  assert.match(details.lines.join("\n"), /Stored description: Parent typed this/);
  assert.match(details.lines.join("\n"), /not generated for this report/);
  assert.match(details.lines.join("\n"), /No description is stored/);
  assert.doesNotMatch(details.lines.join("\n"), /AI-generated summary: Parent typed/);
}
const indexCsv = buildDocumentIndexCsv(chosenDocs, "America/Denver");
assert.match(
  indexCsv,
  /^Document ID,Title,Original filename,Category,Child,Uploaded date,Uploaded by,Visibility,Linked conversations,Linked record IDs,Attachment availability\/status/
);
assert.doesNotMatch(indexCsv, /Not selected|file bytes/);

assert.equal(expenseReportOptions(undefined).ledger, true);
assert.equal(expenseReportOptions(undefined).receiptsZip, true);
assert.equal(documentIndexOptions(undefined).metadata, false);
assert.equal(documentIndexOptions(undefined).includeFiles, false);
assert.equal(selectionExpenseOptions({ summary: false, details: false, files: false }).ledger, false);

const sharedBytes = Buffer.from("%PDF-1.4\nshared-receipt");
const duplicates = dedupeSupportingFiles([
  { key: "doc-a", records: ["EXP-001"], documentLabel: "DOC-004", fileName: "receipt.pdf", mimeType: "application/pdf", bytes: sharedBytes, unavailableReason: null },
  { key: "doc-b", records: ["EXP-004"], documentLabel: "DOC-018", fileName: "receipt-copy.pdf", mimeType: "application/pdf", bytes: sharedBytes, unavailableReason: null },
]);
assert.equal(duplicates.length, 1);
assert.deepEqual(duplicates[0]?.records, ["EXP-001", "EXP-004"]);
assert.match(duplicates[0]?.documentLabel ?? "", /DOC-004/);
assert.match(duplicates[0]?.documentLabel ?? "", /DOC-018/);

async function main() {
async function tinyPdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.addPage([200, 200]);
  return Buffer.from(await pdf.save());
}

function file(partial: Partial<SupportingFile> & Pick<SupportingFile, "key" | "fileName">): SupportingFile {
  return {
    records: ["EXP-001"],
    documentLabel: "DOC-004",
    mimeType: null,
    bytes: null,
    unavailableReason: null,
    ...partial,
  };
}

const receiptPdf = await tinyPdf();
const unsupported = Buffer.from("original-docx-bytes-keep-me");
const assembled = await assembleLabeledPdf({
  files: [
    file({ key: "pdf-1", fileName: "cleats.pdf", mimeType: "application/pdf", bytes: receiptPdf, records: ["EXP-001"] }),
    file({
      key: "docx-1",
      fileName: "notes.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes: unsupported,
      records: ["EXP-004"],
      documentLabel: "DOC-020",
    }),
    file({
      key: "missing-1",
      fileName: "gone.jpg",
      records: ["EXP-005"],
      documentLabel: "DOC-021",
      unavailableReason: "Attachment unavailable. No file is stored for this receipt.",
    }),
  ],
  includeFiles: true,
  bundleFolder: "receipts",
  build: () => buildExpenseReportPdf(many.document, "FAM-100", many.verificationPayload),
});
assert.ok(assembled.bundle.some((entry) => entry.name === "receipts/notes.docx"));
assert.equal(assembled.bundle.some((entry) => entry.name.endsWith("cleats.pdf")), false);
assert.ok(assembled.warnings.some((warning) => warning.includes("EXP-005") && warning.includes("DOC-021")));
const packed = await packageSelectionDownload({
  pdf: assembled.pdf,
  pdfName: "MyVow-Expense-Report-2026-11-04.pdf",
  bundle: assembled.bundle,
  warnings: assembled.warnings,
});
assert.equal(packed.contentType, "application/zip");
assert.equal(packed.filename, "MyVow-Expense-Report-2026-11-04.zip");
const zipText = packed.body.toString("latin1");
assert.match(zipText, /README\.txt/);
assert.match(zipText, /MyVow-Expense-Report-2026-11-04\.pdf/);
assert.match(zipText, /receipts\/notes\.docx/);
const bundled = assembled.bundle.find((entry) => entry.name === "receipts/notes.docx");
assert.ok(bundled);
assert.equal(bundled.buffer.equals(unsupported), true);

const pdfOnly = await packageSelectionDownload({
  pdf: assembled.pdf,
  pdfName: "MyVow-Expense-Report-2026-11-04.pdf",
  bundle: [],
  warnings: [],
});
assert.equal(pdfOnly.contentType, "application/pdf");
assert.match(pdfOnly.body.toString("latin1"), /Expense Report/);
assert.match(pdfOnly.body.toString("latin1"), /Page /);

const docPdf = buildDocumentIndexPdf(docReport.document, "FAM-100", docReport.verificationPayload);
assert.match(docPdf.buffer.toString("latin1"), /Document Index/);
assert.match(docPdf.buffer.toString("latin1"), /School note/);
assert.doesNotMatch(docPdf.buffer.toString("latin1"), /Not selected/);

const incomingDoc = document({
  id: "incoming-1",
  documentNumber: null,
  title: "Pediatrician listing",
  fileName: "Pediatrician listing.xlsx",
  hasStoredFile: false,
  filing: "incoming",
  childName: "Not filed",
  description: null,
});
const filedDoc = document({
  id: "filed-1",
  documentNumber: 12,
  title: "School form",
  fileName: "form.pdf",
  hasStoredFile: true,
});
const mixed = prepareDocumentIndex({
  documents: [filedDoc, incomingDoc],
  parents: [{ name: "Alex Rivera" }],
  caseLabel: "FAM-100",
  timeZone: "America/Denver",
  generatedAt: new Date("2026-11-04T16:00:00.000Z"),
  options: selectionDocumentOptions({ index: true, metadata: true, files: true }),
  withheldCount: 0,
  scope: "selected",
  fileLines: [
    "DOC-012 — form.pdf — appended after this report.",
    "Pediatrician listing.xlsx — Pediatrician listing.xlsx — not available. Attachment unavailable. No file is stored for this document. It is not included in the download bundle.",
  ],
  linkWarning: null,
});
assert.equal(mixed.includedCount, 2);
assert.match(JSON.stringify(mixed.document), /Pediatrician listing/);
assert.match(JSON.stringify(mixed.document), /DOC-012/);
assert.match(JSON.stringify(mixed.document), /Not filed/);
assert.match(JSON.stringify(mixed.document), /does not file the attachment/);
assert.doesNotMatch(JSON.stringify(mixed.document), /Private other|secret\.pdf/);
const mixedCsv = buildDocumentIndexCsv([filedDoc, incomingDoc], "America/Denver");
assert.match(mixedCsv, /DOC-012/);
assert.match(mixedCsv, /Pediatrician listing\.xlsx/);
assert.match(mixedCsv, /Attachment unavailable/);
assert.match(mixedCsv, /—/);
const originalListing = Buffer.from("original-listing-bytes");
const formPdf = await tinyPdf();
const mixedFiles = await assembleLabeledPdf({
  files: [
    file({
      key: "filed-1",
      fileName: "form.pdf",
      mimeType: "application/pdf",
      bytes: formPdf,
      records: ["DOC-012"],
      documentLabel: "DOC-012",
    }),
    file({
      key: "incoming-1",
      fileName: "Pediatrician listing.xlsx",
      records: ["Pediatrician listing.xlsx"],
      documentLabel: null,
      unavailableReason: "Attachment unavailable. No file is stored for this document.",
      bytes: null,
    }),
  ],
  includeFiles: true,
  bundleFolder: "documents",
  build: () => buildDocumentIndexPdf(mixed.document, "FAM-100", mixed.verificationPayload),
});
assert.equal(mixedFiles.bundle.some((entry) => entry.name.includes("Pediatrician listing")), false);
assert.ok(mixedFiles.warnings.some((warning) => warning.includes("Pediatrician listing.xlsx")));
assert.equal(originalListing.equals(Buffer.from("original-listing-bytes")), true);
const mixedPdf = mixedFiles.pdf.toString("latin1");
assert.match(mixedPdf, /Pediatrician listing/);
assert.match(mixedPdf, /School form/);
assert.doesNotMatch(mixedPdf, /secret\.pdf/);

assert.equal(selectionFailureMessage(401, null), "Sign in again to create this report.");
assert.match(selectionFailureMessage(403, "Some selected records are not available."), /not available/);
assert.match(selectionFailureMessage(500, ""), /could not be created/);
assert.match(selectionFailureMessage(400, "Select at least one record."), /at least one record/);

console.log("selection report tests passed");
process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
