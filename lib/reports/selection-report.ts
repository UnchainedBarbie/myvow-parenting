import { documentIndexOptions, type DocumentIndexOptions } from "@/lib/reports/document-index";
import type { ExpenseReportOptions } from "@/lib/reports/expense-report";
import { expenseReportOptions, zipReport } from "@/lib/reports/expense-report-load";
import {
  type SelectionReportChoices,
  type SelectionReportKind,
} from "@/lib/reports/selection-report-shared";

export {
  selectionDownloadName,
  selectionFailureMessage,
  selectionHasSection,
  type SelectionReportChoices,
  type SelectionReportKind,
} from "@/lib/reports/selection-report-shared";

export function selectionExpenseOptions(choices: SelectionReportChoices): ExpenseReportOptions {
  return expenseReportOptions({
    all_expenses: choices.details === true,
    payment_records: choices.details === true,
    dispute_history: choices.details === true,
    net_balance: choices.summary === true,
    receipts_zip: choices.files === true,
  });
}

export function selectionDocumentOptions(choices: SelectionReportChoices): DocumentIndexOptions {
  return documentIndexOptions({
    document_list: choices.index === true,
    linked_conversations: choices.index === true,
    include_documents_zip: choices.files === true,
    document_metadata: choices.metadata === true,
  });
}

export async function packageSelectionDownload(input: {
  pdf: Buffer;
  pdfName: string;
  bundle: { name: string; buffer: Buffer }[];
  warnings: string[];
}): Promise<{ body: Buffer; contentType: string; filename: string }> {
  if (input.bundle.length === 0) {
    return {
      body: input.pdf,
      contentType: "application/pdf",
      filename: input.pdfName,
    };
  }
  const notes = [
    "This download contains the formatted report and the original files that could not be placed in the PDF.",
    "Those original files are unchanged.",
    "",
    "Original files:",
    ...input.bundle.map((file) => file.name),
    "",
    input.warnings.length > 0 ? "Attachments that could not be included:" : "Every other linked file was placed in the PDF or listed above.",
    ...input.warnings,
  ].join("\n");
  const filename = input.pdfName.replace(/\.pdf$/i, ".zip");
  const body = await zipReport("README.txt", Buffer.from(notes, "utf8"), [
    { name: input.pdfName, buffer: input.pdf },
    ...input.bundle,
  ]);
  return { body, contentType: "application/zip", filename };
}
