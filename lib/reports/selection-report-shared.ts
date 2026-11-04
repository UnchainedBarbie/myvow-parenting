export type SelectionReportKind = "expenses" | "documents";

export type SelectionReportChoices = {
  summary?: boolean;
  details?: boolean;
  files?: boolean;
  index?: boolean;
  metadata?: boolean;
};

export function selectionHasSection(kind: SelectionReportKind, choices: SelectionReportChoices): boolean {
  if (kind === "expenses") return choices.summary === true || choices.details === true || choices.files === true;
  return choices.index === true || choices.metadata === true || choices.files === true;
}

export function selectionDownloadName(kind: SelectionReportKind, day: string, extension: "pdf" | "zip"): string {
  const label = kind === "expenses" ? "Expense-Report" : "Document-Report";
  return `MyVow-${label}-${day}.${extension}`;
}

export function selectionFailureMessage(status: number, message: string | null): string {
  if (status === 401) return "Sign in again to create this report.";
  if (status === 403) return message?.trim() || "Some selected records are not available.";
  if (status === 400) return message?.trim() || "Choose the records to include.";
  return message?.trim() || "The report could not be created.";
}
