import { PDFArray, PDFDocument, PDFName } from "pdf-lib";
import {
  appendSupportingFiles,
  dedupeSupportingFiles,
  supportingPlacement,
  uniqueSupportingFiles,
  type SupportingFile,
} from "@/lib/reports/embed-attachments";

export type ReportLink = {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  target: number;
};

export type ReceiptDocumentState = {
  caseId: string | null;
  status: string | null;
  deletedAt: string | null;
};

/** Decide whether a stored receipt_file_id can be opened. Deleted and dismissed files stay closed. */
export function classifyReceiptDocument(
  doc: ReceiptDocumentState | null,
  caseId: string
): { include: boolean; reason: string } {
  if (!doc) {
    return { include: false, reason: "Attachment unavailable. The receipt document was not found." };
  }
  if (doc.deletedAt) {
    return { include: false, reason: "Attachment unavailable. The receipt document was deleted." };
  }
  const status = (doc.status ?? "").trim().toLowerCase();
  if (status === "dismissed") {
    return { include: false, reason: "Attachment unavailable. The receipt document was dismissed." };
  }
  if (doc.caseId && doc.caseId !== caseId) {
    return { include: false, reason: "Attachment unavailable. The receipt document is not on this case." };
  }
  return { include: true, reason: "" };
}

export function pageRangeLabel(start: number, end: number): string {
  if (start === end) return `p. ${start}`;
  return `pp. ${start}–${end}`;
}

export function supportingEvidenceCell(input: {
  linked: boolean;
  documentLabel: string | null;
  includeFiles: boolean;
  pageLabel: string | null;
  unavailable: boolean;
}): string {
  if (!input.linked) return "No attachment";
  const id = input.documentLabel?.trim() || "Document number not assigned";
  if (!input.includeFiles) return `${id}\nAttachments excluded from this export`;
  if (input.unavailable || !input.pageLabel) return `${id}\nAttachment unavailable`;
  return `${id}, ${input.pageLabel}`;
}

export function evidenceWarnings(files: SupportingFile[]): string[] {
  const warnings: string[] = [];
  for (const file of uniqueSupportingFiles(files)) {
    if (file.bytes && file.bytes.length > 0 && !file.unavailableReason) continue;
    const records = file.records.filter(Boolean).join(", ") || "Unnumbered record";
    const id = file.documentLabel?.trim() || "Document number not assigned";
    const reason = file.unavailableReason?.trim() || "Attachment unavailable.";
    warnings.push(`${records}: ${id}. ${reason}`);
  }
  return warnings;
}

export function labelsForSupportingFiles(
  ledgerPages: number,
  files: {
    records: string[];
    pages: number;
    documentLabel: string | null;
    unavailable: boolean;
    embedded?: boolean;
  }[]
): Map<string, string> {
  const grouped = new Map<string, string[]>();
  let page = Math.max(ledgerPages, 0) + 1;
  for (const file of files) {
    const id = file.documentLabel?.trim() || "Document number not assigned";
    if (file.unavailable || file.pages < 1) {
      const text = `${id}\nAttachment unavailable`;
      for (const record of file.records) {
        const list = grouped.get(record) ?? [];
        list.push(text);
        grouped.set(record, list);
      }
      continue;
    }
    const start = page;
    const end = page + file.pages - 1;
    page = end + 1;
    const text =
      file.embedded === false
        ? `${id}\nCould not be placed in the PDF. The original file is in the download bundle.`
        : `${id}, ${pageRangeLabel(start, end)}`;
    for (const record of file.records) {
      const list = grouped.get(record) ?? [];
      list.push(text);
      grouped.set(record, list);
    }
  }
  const labels = new Map<string, string>();
  for (const [record, parts] of grouped) labels.set(record, parts.join("\n"));
  return labels;
}

export function linkTargetPage(text: string): number | null {
  const match = /pp?\.\s*(\d+)/.exec(text);
  if (!match) return null;
  const page = Number(match[1]);
  return Number.isFinite(page) && page > 0 ? page : null;
}

export async function applyReportLinks(pdfBytes: Buffer, links: ReportLink[], pageHeightMm: number): Promise<Buffer> {
  if (links.length === 0) return pdfBytes;
  const pdf = await PDFDocument.load(pdfBytes);
  const scale = 72 / 25.4;
  for (const link of links) {
    if (link.page < 1 || link.target < 1) continue;
    if (link.page > pdf.getPageCount() || link.target > pdf.getPageCount()) continue;
    const page = pdf.getPage(link.page - 1);
    const target = pdf.getPage(link.target - 1);
    const x1 = link.x * scale;
    const y2 = (pageHeightMm - link.y) * scale;
    const x2 = (link.x + link.w) * scale;
    const y1 = (pageHeightMm - (link.y + link.h)) * scale;
    const annot = pdf.context.register(
      pdf.context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [x1, y1, x2, y2],
        Border: [0, 0, 0],
        Dest: [target.ref, "XYZ", null, null, null],
      })
    );
    const existing = page.node.lookup(PDFName.of("Annots"));
    if (existing instanceof PDFArray) existing.push(annot);
    else page.node.set(PDFName.of("Annots"), pdf.context.obj([annot]));
  }
  return Buffer.from(await pdf.save());
}

export async function assembleLabeledPdf(input: {
  files: SupportingFile[];
  includeFiles: boolean;
  bundleFolder: string;
  build: (labels: Map<string, string> | null) => {
    buffer: Buffer;
    pageCount: number;
    links: ReportLink[];
    pageHeightMm: number;
  };
}): Promise<{ pdf: Buffer; bundle: { name: string; buffer: Buffer }[]; warnings: string[] }> {
  if (!input.includeFiles || input.files.length === 0) {
    const ledger = input.build(null);
    return { pdf: ledger.buffer, bundle: [], warnings: [] };
  }
  const unique = dedupeSupportingFiles(input.files);
  const placements: { pages: number; embedded: boolean }[] = [];
  for (const file of unique) placements.push(await supportingPlacement(file));
  let ledger = input.build(null);
  let stable = false;
  const described = () =>
    unique.map((file, index) => ({
      records: file.records,
      pages: placements[index]?.pages ?? 0,
      documentLabel: file.documentLabel ?? null,
      unavailable: !file.bytes || file.bytes.length === 0 || Boolean(file.unavailableReason),
      embedded: placements[index]?.embedded === true,
    }));
  for (let pass = 0; pass < 8; pass += 1) {
    const labels = labelsForSupportingFiles(ledger.pageCount, described());
    const next = input.build(labels);
    if (next.pageCount === ledger.pageCount) {
      ledger = next;
      stable = true;
      break;
    }
    ledger = next;
  }
  if (!stable) {
    const labels = labelsForSupportingFiles(ledger.pageCount, described());
    const next = input.build(labels);
    if (next.pageCount === ledger.pageCount) ledger = next;
  }
  const appended = await appendSupportingFiles(ledger.buffer, unique, input.bundleFolder);
  const pdf = await applyReportLinks(appended.pdf, ledger.links, ledger.pageHeightMm);
  return { pdf, bundle: appended.bundle, warnings: evidenceWarnings(unique) };
}
