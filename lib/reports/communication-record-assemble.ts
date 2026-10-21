import { PDFArray, PDFDocument, PDFName } from "pdf-lib";
import { appendSupportingFiles, supportingPageCount, uniqueSupportingFiles, type SupportingFile } from "@/lib/reports/embed-attachments";
import { planEvidence, type EvidenceRef } from "@/lib/reports/communication-record";
import { evidenceWarnings } from "@/lib/reports/evidence-refs";
import type { LedgerPdf, PdfLink } from "@/lib/reports/communication-record-pdf";

export async function applyPdfLinks(pdfBytes: Buffer, links: PdfLink[], pageHeightMm: number): Promise<Buffer> {
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
    if (existing instanceof PDFArray) {
      existing.push(annot);
    } else {
      page.node.set(PDFName.of("Annots"), pdf.context.obj([annot]));
    }
  }
  return Buffer.from(await pdf.save());
}

export async function assembleCommunicationPdf(
  build: (evidence: Map<string, EvidenceRef[]> | null) => LedgerPdf,
  files: SupportingFile[],
  includeAttachments: boolean
): Promise<{ pdf: Buffer; bundle: { name: string; buffer: Buffer }[]; warnings: string[] }> {
  if (!includeAttachments || files.length === 0) {
    const ledger = build(includeAttachments ? new Map() : null);
    return { pdf: ledger.buffer, bundle: [], warnings: [] };
  }

  const unique = uniqueSupportingFiles(files);
  const counts: number[] = [];
  for (const file of unique) counts.push(await supportingPageCount(file));

  let ledger = build(new Map());
  let stable = false;
  for (let pass = 0; pass < 8; pass += 1) {
    const planned = planEvidence(
      ledger.pageCount,
      unique.map((file, index) => ({
        records: file.records,
        pages: counts[index] ?? 1,
        documentLabel: file.documentLabel ?? null,
        unavailable: !file.bytes || file.bytes.length === 0 || Boolean(file.unavailableReason),
      }))
    );
    const next = build(planned);
    if (next.pageCount === ledger.pageCount) {
      ledger = next;
      stable = true;
      break;
    }
    ledger = next;
  }
  if (!stable) {
    const planned = planEvidence(
      ledger.pageCount,
      unique.map((file, index) => ({
        records: file.records,
        pages: counts[index] ?? 1,
        documentLabel: file.documentLabel ?? null,
        unavailable: !file.bytes || file.bytes.length === 0 || Boolean(file.unavailableReason),
      }))
    );
    const next = build(planned);
    if (next.pageCount === ledger.pageCount) ledger = next;
  }

  const appended = await appendSupportingFiles(ledger.buffer, unique, "attachments");
  const pdf = await applyPdfLinks(appended.pdf, ledger.links, ledger.pageHeightMm);
  return { pdf, bundle: appended.bundle, warnings: evidenceWarnings(unique) };
}
