import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import sharp from "sharp";

export type SupportingFile = {
  /** Stable id used to keep one copy when several records share a file. */
  key: string;
  /** DOC and EXP numbers that reference this file, in record order. */
  records: string[];
  fileName: string;
  mimeType: string | null;
  bytes: Buffer | null;
  unavailableReason: string | null;
};

export type SupportingDisposition = "pdf" | "image" | "bundle" | "unavailable";

/** Scale an image to fit inside a box while keeping the full image visible. */
export function fitContain(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } {
  if (width <= 0 || height <= 0 || maxWidth <= 0 || maxHeight <= 0) {
    return { width: 0, height: 0 };
  }
  const scale = Math.min(maxWidth / width, maxHeight / height);
  return { width: width * scale, height: height * scale };
}

export function uniqueSupportingFiles(files: SupportingFile[]): SupportingFile[] {
  const grouped = new Map<string, SupportingFile>();
  const order: string[] = [];
  for (const file of files) {
    const existing = grouped.get(file.key);
    if (!existing) {
      grouped.set(file.key, { ...file, records: [...file.records] });
      order.push(file.key);
      continue;
    }
    for (const record of file.records) {
      if (!existing.records.includes(record)) existing.records.push(record);
    }
    if (!existing.bytes && file.bytes) {
      existing.bytes = file.bytes;
      existing.mimeType = existing.mimeType ?? file.mimeType;
      existing.fileName = existing.fileName || file.fileName;
      existing.unavailableReason = null;
    }
  }
  return order.map((key) => grouped.get(key)!);
}

function looksLikePdf(bytes: Buffer, mimeType: string | null, fileName: string): boolean {
  const mime = (mimeType ?? "").toLowerCase();
  if (mime === "application/pdf" || mime === "application/x-pdf") return true;
  if (fileName.toLowerCase().endsWith(".pdf")) return true;
  return bytes.length >= 5 && bytes.subarray(0, 5).toString("latin1") === "%PDF-";
}

function looksLikeImage(mimeType: string | null, fileName: string): boolean {
  const mime = (mimeType ?? "").toLowerCase();
  if (mime.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|tiff?|bmp|heic|heif)$/i.test(fileName);
}

function isJpeg(bytes: Buffer, mimeType: string | null, fileName: string): boolean {
  const mime = (mimeType ?? "").toLowerCase();
  if (mime === "image/jpeg" || mime === "image/jpg") return true;
  if (/\.jpe?g$/i.test(fileName)) return true;
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isPng(bytes: Buffer, mimeType: string | null, fileName: string): boolean {
  const mime = (mimeType ?? "").toLowerCase();
  if (mime === "image/png") return true;
  if (fileName.toLowerCase().endsWith(".png")) return true;
  return bytes.length >= 8 && bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
}

export async function classifySupportingFile(file: SupportingFile): Promise<SupportingDisposition> {
  if (!file.bytes || file.bytes.length === 0) return "unavailable";
  if (looksLikePdf(file.bytes, file.mimeType, file.fileName)) {
    try {
      const src = await PDFDocument.load(file.bytes, { ignoreEncryption: true, updateMetadata: false });
      return src.getPageCount() > 0 ? "pdf" : "bundle";
    } catch {
      return "bundle";
    }
  }
  if (looksLikeImage(file.mimeType, file.fileName)) {
    try {
      await rasterImage(file.bytes, file.mimeType, file.fileName);
      return "image";
    } catch {
      return "bundle";
    }
  }
  return "bundle";
}

/** Pages this file will add: a cover or notice, plus each original PDF page. */
export async function supportingPageCount(file: SupportingFile): Promise<number> {
  const disposition = await classifySupportingFile(file);
  if (disposition === "pdf" && file.bytes) {
    try {
      const src = await PDFDocument.load(file.bytes, { ignoreEncryption: true, updateMetadata: false });
      const count = src.getPageCount();
      return count > 0 ? 1 + count : 1;
    } catch {
      return 1;
    }
  }
  return 1;
}

export function supportingFileSentence(
  file: SupportingFile,
  disposition: SupportingDisposition,
  embedInPdf = true
): string {
  const records = file.records.filter(Boolean).join(", ") || "Unnumbered record";
  const name = file.fileName.trim() || "Untitled file";
  if (!embedInPdf && file.bytes && file.bytes.length > 0) {
    return `${records} — ${name} — included as a separate file in the download bundle.`;
  }
  if (disposition === "pdf" || disposition === "image") {
    return `${records} — ${name} — appended after this report.`;
  }
  if (disposition === "bundle") {
    return `${records} — ${name} — could not be placed in the PDF. The original file is included in the download bundle.`;
  }
  const reason = file.unavailableReason?.trim() || "The file is not available.";
  return `${records} — ${name} — not available. ${reason} It is not included in the download bundle.`;
}

async function rasterImage(
  bytes: Buffer,
  mimeType: string | null,
  fileName: string
): Promise<{ kind: "jpg" | "png"; bytes: Buffer }> {
  if (isJpeg(bytes, mimeType, fileName)) return { kind: "jpg", bytes };
  if (isPng(bytes, mimeType, fileName)) return { kind: "png", bytes };
  const converted = await sharp(bytes, { failOn: "none" }).rotate().png().toBuffer();
  return { kind: "png", bytes: converted };
}

function safeBundleName(folder: string, fileName: string, used: Map<string, number>): string {
  const cleaned = fileName.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || "file";
  const base = `${folder}/${cleaned}`;
  const count = used.get(base) ?? 0;
  used.set(base, count + 1);
  if (count === 0) return base;
  return base.replace(/(\.[^.]+)?$/, `-${count + 1}$1`);
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [" "];
}

async function addNoticePage(
  pdf: PDFDocument,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  bold: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  lines: { text: string; bold?: boolean }[]
) {
  const page = pdf.addPage([792, 612]);
  page.drawText("MYVOW PARENTING", {
    x: 36,
    y: 572,
    size: 9,
    font,
    color: rgb(0.29, 0.29, 0.29),
  });
  page.drawText("Supporting file", {
    x: 36,
    y: 546,
    size: 18,
    font: bold,
    color: rgb(0.07, 0.07, 0.07),
  });
  page.drawLine({
    start: { x: 36, y: 536 },
    end: { x: 756, y: 536 },
    thickness: 0.8,
    color: rgb(0.13, 0.13, 0.13),
  });
  let y = 510;
  for (const line of lines) {
    const wrapped = wrapText(line.text, 110);
    for (const part of wrapped) {
      page.drawText(part, {
        x: 36,
        y,
        size: 11,
        font: line.bold ? bold : font,
        color: rgb(0.09, 0.09, 0.09),
      });
      y -= 16;
      if (y < 36) return;
    }
    y -= 4;
  }
}

export function bundleAvailableFiles(
  files: SupportingFile[],
  bundleFolder: string
): { name: string; buffer: Buffer }[] {
  const used = new Map<string, number>();
  const bundle: { name: string; buffer: Buffer }[] = [];
  for (const file of uniqueSupportingFiles(files)) {
    if (!file.bytes || file.bytes.length === 0) continue;
    bundle.push({
      name: safeBundleName(bundleFolder, file.fileName, used),
      buffer: file.bytes,
    });
  }
  return bundle;
}

export async function appendSupportingFiles(
  reportPdf: Buffer,
  files: SupportingFile[],
  bundleFolder: string
): Promise<{ pdf: Buffer; bundle: { name: string; buffer: Buffer }[] }> {
  const unique = uniqueSupportingFiles(files);
  if (unique.length === 0) return { pdf: reportPdf, bundle: [] };

  const pdf = await PDFDocument.load(reportPdf);
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const bundle: { name: string; buffer: Buffer }[] = [];
  const usedNames = new Map<string, number>();

  for (const file of unique) {
    const records = file.records.filter(Boolean).join(", ") || "Unnumbered record";
    const name = file.fileName.trim() || "Untitled file";
    const disposition = await classifySupportingFile(file);

    if (disposition === "unavailable" || !file.bytes) {
      await addNoticePage(pdf, font, bold, [
        { text: records, bold: true },
        { text: `File: ${name}` },
        { text: file.unavailableReason?.trim() || "This file is not available." },
        { text: "The file is not included in the download bundle." },
      ]);
      continue;
    }

    if (disposition === "pdf") {
      try {
        const src = await PDFDocument.load(file.bytes, { ignoreEncryption: true, updateMetadata: false });
        const count = src.getPageCount();
        await addNoticePage(pdf, font, bold, [
          { text: records, bold: true },
          { text: `File: ${name}` },
          {
            text: `${count} page${count === 1 ? "" : "s"} from the original file follow, in their original order. The file content is unchanged.`,
          },
        ]);
        const copied = await pdf.copyPages(src, src.getPageIndices());
        for (const page of copied) pdf.addPage(page);
        continue;
      } catch {
        const bundledName = safeBundleName(bundleFolder, name, usedNames);
        bundle.push({ name: bundledName, buffer: file.bytes });
        await addNoticePage(pdf, font, bold, [
          { text: records, bold: true },
          { text: `File: ${name}` },
          { text: "This PDF could not be placed in the report. The original file is included in the download bundle." },
          { text: `Bundle path: ${bundledName}` },
        ]);
        continue;
      }
    }

    if (disposition === "image") {
      try {
        const image = await rasterImage(file.bytes, file.mimeType, file.fileName);
        const embedded =
          image.kind === "jpg" ? await pdf.embedJpg(image.bytes) : await pdf.embedPng(image.bytes);
        const page = pdf.addPage([792, 612]);
        page.drawText("MYVOW PARENTING", {
          x: 36,
          y: 572,
          size: 9,
          font,
          color: rgb(0.29, 0.29, 0.29),
        });
        const recordLines = wrapText(records, 80);
        recordLines.forEach((part, index) => {
          page.drawText(part, {
            x: 36,
            y: 548 - index * 16,
            size: 14,
            font: bold,
            color: rgb(0.07, 0.07, 0.07),
          });
        });
        const captionTop = 548 - recordLines.length * 16 - 6;
        const caption = wrapText(name, 90);
        caption.forEach((part, index) => {
          page.drawText(part, { x: 36, y: captionTop - index * 14, size: 11, font, color: rgb(0.13, 0.13, 0.13) });
        });
        const top = captionTop - caption.length * 14 - 12;
        const maxW = 720;
        const maxH = Math.max(120, top - 36);
        const fitted = fitContain(embedded.width, embedded.height, maxW, maxH);
        const width = fitted.width;
        const height = fitted.height;
        page.drawImage(embedded, {
          x: 36 + (maxW - width) / 2,
          y: 36 + (maxH - height) / 2,
          width,
          height,
        });
        continue;
      } catch {
        const bundledName = safeBundleName(bundleFolder, name, usedNames);
        bundle.push({ name: bundledName, buffer: file.bytes });
        await addNoticePage(pdf, font, bold, [
          { text: records, bold: true },
          { text: `File: ${name}` },
          { text: "This image could not be placed in the report. The original file is included in the download bundle." },
          { text: `Bundle path: ${bundledName}` },
        ]);
        continue;
      }
    }

    const bundledName = safeBundleName(bundleFolder, name, usedNames);
    bundle.push({ name: bundledName, buffer: file.bytes });
    await addNoticePage(pdf, font, bold, [
      { text: records, bold: true },
      { text: `File: ${name}` },
      { text: "This file type cannot be placed in the PDF. The original file is included in the download bundle." },
      { text: `Bundle path: ${bundledName}` },
    ]);
  }

  const saved = await pdf.save();
  return { pdf: Buffer.from(saved), bundle };
}
