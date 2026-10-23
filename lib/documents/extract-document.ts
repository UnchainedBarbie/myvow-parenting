import { inflateRawSync } from "node:zlib";
import * as XLSX from "xlsx";
import { documentExtension } from "@/lib/documents-files";
import { extractPdfText } from "@/lib/pdf-extract";

export const ANALYSIS_MAX_SHEETS = 6;
export const ANALYSIS_MAX_ROWS = 100;
export const ANALYSIS_MAX_COLS = 16;
export const ANALYSIS_MAX_CHARS = 8000;
export const ANALYSIS_MAX_CELL = 180;

export type SheetTable = {
  name: string;
  headers: string[];
  rows: { row: number; cells: string[] }[];
  totalRows: number;
  totalCols: number;
  omittedRows: number;
  omittedCols: number;
  formulasNotRun: number;
  externalLinksSkipped: number;
};

export type ExtractionResult =
  | {
      ok: true;
      kind: "table";
      sheets: SheetTable[];
      unreadSheets: string[];
      macrosIgnored: boolean;
    }
  | { ok: true; kind: "text"; text: string; truncated: boolean; label: string }
  | { ok: false; reason: string };

type ExtractDeps = {
  extractPdf?: (buffer: Buffer) => Promise<string>;
};

export async function extractDocument(
  buffer: Buffer,
  fileName: string,
  deps: ExtractDeps = {}
): Promise<ExtractionResult> {
  const ext = documentExtension(fileName);
  if (ext === "doc") {
    return {
      ok: false,
      reason: "Legacy Word .doc files can't be extracted safely. The file is still stored.",
    };
  }
  try {
    if (ext === "csv") return csvTable(buffer, fileName);
    if (ext === "txt") return textResult(buffer.toString("utf8"), "Text");
    if (ext === "pdf") {
      const extract = deps.extractPdf ?? extractPdfText;
      return textResult(await extract(buffer), "PDF text");
    }
    if (ext === "docx") return textResult(docxText(buffer), "Word text");
    if (ext === "xlsx" || ext === "xls") {
      if (!workbookBytes(buffer, ext)) {
        return {
          ok: false,
          reason: "I couldn't read this workbook. The file is still stored.",
        };
      }
      return ext === "xlsx" ? parseXlsx(buffer) : workbookTable(buffer);
    }
    return { ok: false, reason: "This file type can't be read as text." };
  } catch {
    console.error("[document-extract] unreadable");
    return {
      ok: false,
      reason: "I couldn't read this file. It is still stored.",
    };
  }
}

function textResult(raw: string, label: string): ExtractionResult {
  const text = raw.replace(/\u0000/g, "").trim();
  if (!text) return { ok: false, reason: "The file didn't contain readable text." };
  if (text.length <= ANALYSIS_MAX_CHARS) return { ok: true, kind: "text", text, truncated: false, label };
  return {
    ok: true,
    kind: "text",
    text: text.slice(0, ANALYSIS_MAX_CHARS),
    truncated: true,
    label,
  };
}

function csvTable(buffer: Buffer, fileName: string): ExtractionResult {
  const table = rowsToSheet(fileName, parseCsv(buffer.toString("utf8")));
  return { ok: true, kind: "table", sheets: [table], unreadSheets: [], macrosIgnored: false };
}

function workbookBytes(buffer: Buffer, ext: string): boolean {
  if (buffer.length < 8) return false;
  if (ext === "xlsx") return buffer[0] === 0x50 && buffer[1] === 0x4b;
  return buffer[0] === 0xd0 && buffer[1] === 0xcf;
}

function parseXlsx(buffer: Buffer): ExtractionResult {
  const entries = unzipEntries(buffer);
  const workbook = textEntry(entries, "xl/workbook.xml");
  const rels = textEntry(entries, "xl/_rels/workbook.xml.rels");
  if (!workbook) return { ok: false, reason: "I couldn't read this workbook. The file is still stored." };
  const sheets = [...workbook.matchAll(/<sheet\b[^>]*>/g)].map((tag) => ({
    name: decodeXml(/name="([^"]*)"/.exec(tag[0])?.[1] ?? "Sheet"),
    id: /r:id="([^"]*)"/.exec(tag[0])?.[1] ?? "",
  }));
  if (sheets.length === 0) return { ok: false, reason: "The workbook has no sheets." };
  const targets = new Map<string, string>();
  for (const rel of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]*)"/.exec(rel[0])?.[1] ?? "";
    const target = /Target="([^"]*)"/.exec(rel[0])?.[1] ?? "";
    if (id && target) targets.set(id, target.replace(/^\//, ""));
  }
  const shared = sharedStrings(textEntry(entries, "xl/sharedStrings.xml"));
  const macrosIgnored = [...entries.keys()].some((name) => name.toLowerCase().includes("vbaproject"));
  const externalPart = [...entries.keys()].some((name) => name.includes("externalLinks"));
  const readable = sheets.slice(0, ANALYSIS_MAX_SHEETS);
  const unreadSheets = sheets.slice(ANALYSIS_MAX_SHEETS).map((sheet) => sheet.name);
  const tables = readable.map((sheet) => {
    const target = targets.get(sheet.id) ?? "";
    const path = target.startsWith("xl/") ? target : `xl/${target}`;
    return sheetFromXml(sheet.name, textEntry(entries, path), shared);
  });
  if (externalPart && tables[0]) tables[0].externalLinksSkipped += 1;
  return { ok: true, kind: "table", sheets: tables, unreadSheets, macrosIgnored };
}

function sheetFromXml(name: string, xml: string, shared: string[]): SheetTable {
  if (!xml) return emptySheet(name);
  const cells = new Map<string, { text: string; formula: boolean; external: boolean }>();
  let maxRow = 0;
  let maxCol = 0;
  let formulasNotRun = 0;
  let externalLinksSkipped = 0;
  for (const match of xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g)) {
    const attrs = match[1] || match[3] || "";
    const body = match[2] ?? "";
    const ref = /r="([A-Z]+)(\d+)"/.exec(attrs);
    if (!ref) continue;
    const col = colIndex(ref[1]);
    const row = Number(ref[2]);
    maxRow = Math.max(maxRow, row);
    maxCol = Math.max(maxCol, col);
    const formula = decodeXml(/<f[^>]*>([\s\S]*?)<\/f>/.exec(body)?.[1] ?? "");
    const external = /\[|https?:/i.test(formula);
    const type = /t="([^"]*)"/.exec(attrs)?.[1] ?? "";
    let text = "";
    if (formula || external) {
      formulasNotRun += 1;
      if (external) {
        externalLinksSkipped += 1;
        text = "(external link not opened)";
      } else {
        const stored = cellText(body, type, shared);
        text = stored ? `${stored} (stored value; formula not run)` : "(formula not calculated)";
      }
    } else {
      text = cellText(body, type, shared);
    }
    cells.set(`${row}:${col}`, { text, formula: Boolean(formula), external });
  }
  const dimension = /<dimension[^>]*ref="(?:[A-Z]+)(\d+):(?:[A-Z]+)(\d+)"/.exec(xml);
  const declaredRows = dimension ? Number(dimension[2]) : maxRow;
  const declaredCols = dimension
    ? colIndex(/:([A-Z]+)/.exec(/ref="([^"]+)"/.exec(/<dimension[^>]*>/.exec(xml)?.[0] ?? "")?.[1] ?? "A")?.[1] ?? "A") + 1
    : maxCol + 1;
  const totalRows = Math.max(declaredRows, maxRow);
  const totalCols = Math.max(declaredCols, maxCol + 1);
  const rowLimit = Math.min(totalRows, ANALYSIS_MAX_ROWS + 1);
  const colLimit = Math.min(totalCols, ANALYSIS_MAX_COLS);
  const headerLine: string[] = [];
  for (let col = 0; col < colLimit; col += 1) headerLine.push(cells.get(`1:${col}`)?.text ?? "");
  const headers = headerLine.map((cell, index) => cell || `Column ${index + 1}`);
  const rows: { row: number; cells: string[] }[] = [];
  for (let row = 2; row <= rowLimit; row += 1) {
    const line: string[] = [];
    let any = false;
    for (let col = 0; col < colLimit; col += 1) {
      const value = cells.get(`${row}:${col}`)?.text ?? "";
      if (value) any = true;
      line.push(value);
    }
    if (any) rows.push({ row, cells: line });
  }
  return {
    name,
    headers,
    rows,
    totalRows,
    totalCols,
    omittedRows: Math.max(0, totalRows - rowLimit),
    omittedCols: Math.max(0, totalCols - colLimit),
    formulasNotRun,
    externalLinksSkipped,
  };
}

function cellText(body: string, type: string, shared: string[]): string {
  const inline = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/.exec(body)?.[1];
  if (inline != null) return clip(decodeXml(inline));
  const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
  if (raw == null) return "";
  if (type === "s") return clip(shared[Number(raw)] ?? "");
  if (type === "inlineStr") return clip(decodeXml(raw));
  return clip(decodeXml(raw));
}

function sharedStrings(xml: string): string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((item) =>
    [...item[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((part) => decodeXml(part[1])).join("")
  );
}

function textEntry(entries: Map<string, Buffer>, name: string): string {
  return entries.get(name)?.toString("utf8") ?? "";
}

function unzipEntries(buffer: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const flags = buffer.readUInt16LE(offset + 6);
    const method = buffer.readUInt16LE(offset + 8);
    const compressed = buffer.readUInt32LE(offset + 18);
    const nameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);
    const name = buffer.slice(offset + 30, offset + 30 + nameLen).toString("utf8").replace(/\\/g, "/");
    const start = offset + 30 + nameLen + extraLen;
    if ((flags & 0x8) !== 0 && compressed === 0) break;
    const slice = buffer.slice(start, start + compressed);
    if (method === 0) entries.set(name, slice);
    else if (method === 8) entries.set(name, inflateRawSync(slice));
    offset = start + compressed;
  }
  return entries;
}

function colIndex(letters: string): number {
  let value = 0;
  for (const char of letters) value = value * 26 + (char.charCodeAt(0) - 64);
  return value - 1;
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function workbookTable(buffer: Buffer): ExtractionResult {
  const book = XLSX.read(buffer, {
    type: "buffer",
    cellFormula: true,
    cellHTML: false,
    cellStyles: false,
    cellNF: false,
    bookVBA: false,
    WTF: false,
  });
  const names = book.SheetNames ?? [];
  if (names.length === 0) {
    return { ok: false, reason: "The workbook has no sheets." };
  }
  const macrosIgnored = Boolean((book as { vbaraw?: unknown }).vbaraw);
  const readable = names.slice(0, ANALYSIS_MAX_SHEETS);
  const unreadSheets = names.slice(ANALYSIS_MAX_SHEETS);
  const sheets = readable.map((name) => sheetTable(name, book.Sheets[name]));
  return { ok: true, kind: "table", sheets, unreadSheets, macrosIgnored };
}

function sheetTable(name: string, sheet: XLSX.WorkSheet | undefined): SheetTable {
  const ref = sheet?.["!ref"];
  if (!sheet || typeof ref !== "string" || !ref) {
    return emptySheet(name);
  }
  const range = XLSX.utils.decode_range(ref);
  const totalRows = range.e.r - range.s.r + 1;
  const totalCols = range.e.c - range.s.c + 1;
  const rowLimit = Math.min(totalRows, ANALYSIS_MAX_ROWS + 1);
  const colLimit = Math.min(totalCols, ANALYSIS_MAX_COLS);
  const grid: string[][] = [];
  let formulasNotRun = 0;
  let externalLinksSkipped = 0;
  for (let r = 0; r < rowLimit; r += 1) {
    const row: string[] = [];
    for (let c = 0; c < colLimit; c += 1) {
      const addr = XLSX.utils.encode_cell({ r: range.s.r + r, c: range.s.c + c });
      const cell = sheet[addr] as XLSX.CellObject | undefined;
      const shown = showCell(cell);
      formulasNotRun += shown.formula ? 1 : 0;
      externalLinksSkipped += shown.external ? 1 : 0;
      row.push(shown.text);
    }
    grid.push(row);
  }
  const headers = (grid[0] ?? []).map((cell, index) => cell || `Column ${index + 1}`);
  const rows = grid.slice(1).map((cells, index) => ({
    row: range.s.r + index + 2,
    cells,
  }));
  return {
    name,
    headers,
    rows,
    totalRows,
    totalCols,
    omittedRows: Math.max(0, totalRows - rowLimit),
    omittedCols: Math.max(0, totalCols - colLimit),
    formulasNotRun,
    externalLinksSkipped,
  };
}

function emptySheet(name: string): SheetTable {
  return {
    name,
    headers: [],
    rows: [],
    totalRows: 0,
    totalCols: 0,
    omittedRows: 0,
    omittedCols: 0,
    formulasNotRun: 0,
    externalLinksSkipped: 0,
  };
}

function showCell(
  cell: XLSX.CellObject | string | undefined
): { text: string; formula: boolean; external: boolean } {
  if (!cell) return { text: "", formula: false, external: false };
  if (typeof cell === "string") return { text: clip(cell), formula: false, external: false };
  const formula = typeof cell.f === "string" ? cell.f : "";
  const link = cell.l && typeof cell.l.Target === "string" ? cell.l.Target : "";
  const external = /\[|https?:/i.test(formula) || /^https?:/i.test(link);
  if (formula || external) {
    if (external) return { text: "(external link not opened)", formula: true, external: true };
    const cached = cell.v == null || cell.v === "" ? "" : clip(String(cell.v));
    return {
      text: cached ? `${cached} (stored value; formula not run)` : "(formula not calculated)",
      formula: true,
      external: false,
    };
  }
  if (cell.v == null) return { text: "", formula: false, external: false };
  return { text: clip(String(cell.v)), formula: false, external: false };
}

function rowsToSheet(name: string, grid: string[][]): SheetTable {
  const width = grid.reduce((max, row) => Math.max(max, row.length), 0);
  const totalRows = grid.length;
  const totalCols = width;
  const rowLimit = Math.min(totalRows, ANALYSIS_MAX_ROWS + 1);
  const colLimit = Math.min(totalCols, ANALYSIS_MAX_COLS);
  const shown = grid.slice(0, rowLimit).map((row) => row.slice(0, colLimit).map(clip));
  const headers = (shown[0] ?? []).map((cell, index) => cell || `Column ${index + 1}`);
  return {
    name,
    headers,
    rows: shown.slice(1).map((cells, index) => ({ row: index + 2, cells })),
    totalRows,
    totalCols,
    omittedRows: Math.max(0, totalRows - rowLimit),
    omittedCols: Math.max(0, totalCols - colLimit),
    formulasNotRun: 0,
    externalLinksSkipped: 0,
  };
}

function clip(value: string): string {
  const clean = value.replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
  if (clean.length <= ANALYSIS_MAX_CELL) return clean;
  return `${clean.slice(0, ANALYSIS_MAX_CELL)}…`;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (char === "\n") {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows.filter((line) => line.some((value) => value.length > 0));
}

function docxText(buffer: Buffer): string {
  const xml = unzipText(buffer, "word/document.xml");
  if (!xml) throw new Error("docx missing document.xml");
  return xml
    .replace(/<w:p[ >]/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function unzipText(buffer: Buffer, name: string): string | null {
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) break;
    const method = buffer.readUInt16LE(offset + 8);
    const compressed = buffer.readUInt32LE(offset + 18);
    const nameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);
    const start = offset + 30 + nameLen + extraLen;
    const entry = buffer.slice(offset + 30, offset + 30 + nameLen).toString("utf8");
    const data = buffer.slice(start, start + compressed);
    if (entry === name) {
      if (method === 0) return data.toString("utf8");
      if (method === 8) return inflateRawSync(data).toString("utf8");
      return null;
    }
    offset = start + compressed;
  }
  return null;
}
