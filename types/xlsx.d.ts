declare module "xlsx" {
  export type CellObject = {
    v?: string | number | boolean;
    f?: string;
    l?: { Target?: string };
    t?: string;
  };

  export type WorkSheet = {
    [cell: string]: CellObject | string | undefined;
  };

  export type WorkBook = {
    SheetNames: string[];
    Sheets: Record<string, WorkSheet>;
    vbaraw?: unknown;
  };

  export function read(data: Buffer, opts: Record<string, unknown>): WorkBook;

  export const utils: {
    decode_range(ref: string): { s: { r: number; c: number }; e: { r: number; c: number } };
    encode_cell(cell: { r: number; c: number }): string;
    aoa_to_sheet(data: Array<Array<string | number>>): WorkSheet;
    book_new(): WorkBook;
    book_append_sheet(book: WorkBook, sheet: WorkSheet, name?: string): void;
  };

  export function write(book: WorkBook, opts: { type: "buffer"; bookType: string }): Buffer;
}
