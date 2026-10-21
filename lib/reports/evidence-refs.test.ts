import assert from "node:assert/strict";
import { jsPDF } from "jspdf";
import { PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import { assembleLabeledPdf, classifyReceiptDocument, labelsForSupportingFiles, pageRangeLabel, supportingEvidenceCell } from "@/lib/reports/evidence-refs";
import { prepareExpenseReport, type ExpenseReportSource } from "@/lib/reports/expense-report";
import type { SupportingFile } from "@/lib/reports/embed-attachments";

const caseId = "case-1";

assert.deepEqual(classifyReceiptDocument(null, caseId), {
  include: false,
  reason: "Attachment unavailable. The receipt document was not found.",
});
assert.equal(classifyReceiptDocument({ caseId, status: "pending", deletedAt: null }, caseId).include, true);
assert.equal(classifyReceiptDocument({ caseId: null, status: "active", deletedAt: null }, caseId).include, true);
assert.equal(classifyReceiptDocument({ caseId, status: "active", deletedAt: "2026-01-01" }, caseId).include, false);
assert.equal(classifyReceiptDocument({ caseId, status: "dismissed", deletedAt: null }, caseId).include, false);
assert.equal(classifyReceiptDocument({ caseId: "other", status: "active", deletedAt: null }, caseId).include, false);

assert.equal(supportingEvidenceCell({
  linked: false,
  documentLabel: null,
  includeFiles: true,
  pageLabel: null,
  unavailable: false,
}), "No attachment");
assert.equal(supportingEvidenceCell({
  linked: true,
  documentLabel: "DOC-018",
  includeFiles: false,
  pageLabel: null,
  unavailable: false,
}), "DOC-018\nAttachments excluded from this export");
assert.equal(supportingEvidenceCell({
  linked: true,
  documentLabel: "DOC-018",
  includeFiles: true,
  pageLabel: null,
  unavailable: true,
}), "DOC-018\nAttachment unavailable");
assert.equal(pageRangeLabel(8, 9), "pp. 8–9");
assert.doesNotMatch(supportingEvidenceCell({
  linked: true,
  documentLabel: "DOC-018",
  includeFiles: false,
  pageLabel: "pp. 8–9",
  unavailable: false,
}), /pp\./);

const labels = labelsForSupportingFiles(2, [
  { records: ["EXP-010", "EXP-013"], pages: 1, documentLabel: "DOC-018", unavailable: false },
  { records: ["EXP-022"], pages: 3, documentLabel: "DOC-020", unavailable: false },
  { records: ["EXP-030"], pages: 1, documentLabel: "DOC-021", unavailable: true },
]);
assert.equal(labels.get("EXP-010"), "DOC-018, p. 3");
assert.equal(labels.get("EXP-013"), "DOC-018, p. 3");
assert.equal(labels.get("EXP-022"), "DOC-020, pp. 4–6");
assert.equal(labels.get("EXP-030"), "DOC-021\nAttachment unavailable");

const excluded = prepareExpenseReport({
  expenses: [
    {
      id: "e10",
      expenseNumber: 10,
      createdAt: "2026-10-10T18:00:00.000Z",
      incurredDate: "2026-10-09",
      description: "Receipted",
      category: "medical",
      categoryDescription: null,
      amount: 12,
      submittedBy: "alex",
      amountOwed: 6,
      otherParentShare: 6,
      otherParentPercent: 50,
      splitLabel: "50/50",
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
      receiptName: "receipt.jpg",
      receiptDocumentNumber: 18,
      receiptFileId: "doc-18",
      childName: "Sam",
    } satisfies ExpenseReportSource,
  ],
  parents: [
    { userId: "alex", name: "Alex Rivera" },
    { userId: "jordan", name: "Jordan Lee" },
  ],
  caseLabel: "FAM-100",
  timeZone: "America/Denver",
  dateStart: null,
  dateEnd: null,
  generatedAt: new Date("2026-10-20T18:00:00.000Z"),
  viewerId: "alex",
  viewerName: "Alex Rivera",
  options: { ledger: true, payments: false, disputes: false, netBalance: false, receiptsZip: false },
  receiptLines: [],
});
const excludedLedger = excluded.document.blocks.find((block) => block.kind === "table");
assert.ok(excludedLedger && excludedLedger.kind === "table");
assert.match(excludedLedger.rows[0][10], /DOC-018/);
assert.match(excludedLedger.rows[0][10], /Attachments excluded from this export/);
assert.doesNotMatch(excludedLedger.rows[0][10], /pp\./);

function ledger(labelsMap: Map<string, string> | null) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "letter" });
  doc.setFontSize(12);
  doc.text(labelsMap?.get("EXP-010") ?? "pending", 20, 20);
  doc.text(labelsMap?.get("EXP-022") ?? "", 20, 30);
  const out = doc.output("arraybuffer");
  return {
    buffer: Buffer.from(new Uint8Array(out as ArrayBuffer)),
    pageCount: doc.getNumberOfPages(),
    links: labelsMap?.get("EXP-010")?.includes("p.")
      ? [{ page: 1, x: 20, y: 20, w: 40, h: 4, target: 2 }]
      : [],
    pageHeightMm: 215.9,
  };
}

async function main() {
  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  const multipage = await PDFDocument.create();
  multipage.addPage([200, 200]);
  multipage.addPage([200, 200]);
  const font = await multipage.embedFont(StandardFonts.Helvetica);
  multipage.getPages().forEach((page, index) => {
    page.drawText(`Receipt page ${index + 1}`, { x: 20, y: 100, size: 12, font });
  });
  const pdfBytes = Buffer.from(await multipage.save());
  const sharedImage: SupportingFile = {
    key: "doc-18",
    records: ["EXP-010"],
    documentLabel: "DOC-018",
    fileName: "receipt.jpg",
    mimeType: "image/png",
    bytes: image,
    unavailableReason: null,
  };
  const secondLink: SupportingFile = { ...sharedImage, records: ["EXP-013"] };
  const multi: SupportingFile = {
    key: "doc-20",
    records: ["EXP-022"],
    documentLabel: "DOC-020",
    fileName: "statement.pdf",
    mimeType: "application/pdf",
    bytes: pdfBytes,
    unavailableReason: null,
  };
  const missing: SupportingFile = {
    key: "doc-21",
    records: ["EXP-030"],
    documentLabel: "DOC-021",
    fileName: "gone.pdf",
    mimeType: "application/pdf",
    bytes: null,
    unavailableReason: "Attachment unavailable. The receipt document was deleted.",
  };
  const assembled = await assembleLabeledPdf({
    files: [sharedImage, secondLink, multi, missing],
    includeFiles: true,
    bundleFolder: "receipts",
    build: ledger,
  });
  const pdf = await PDFDocument.load(assembled.pdf);
  const text = Buffer.from(assembled.pdf).toString("latin1");
  assert.match(text, /DOC-018, p\. 2/);
  assert.match(text, /DOC-020, pp\. 3\x964/);
  assert.equal(pdf.getPageCount(), 4);
  assert.doesNotMatch(text, /could not be placed/);
  assert.match(assembled.warnings.join("\n"), /EXP-030/);
  assert.match(assembled.warnings.join("\n"), /DOC-021/);
  let linked = false;
  for (let index = 0; index < pdf.getPageCount(); index += 1) {
    if (pdf.getPage(index).node.lookup(PDFName.of("Annots"))) linked = true;
  }
  assert.equal(linked, true);
  console.log("evidence reference tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
