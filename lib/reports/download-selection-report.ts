import {
  selectionFailureMessage,
  type SelectionReportChoices,
  type SelectionReportKind,
} from "@/lib/reports/selection-report-shared";

export async function downloadSelectionReport(input: {
  caseId: string;
  reportType: SelectionReportKind;
  ids: string[];
  options: SelectionReportChoices;
}): Promise<{ warnings: string[] }> {
  const response = await fetch("/api/reports/selection", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      case_id: input.caseId,
      report_type: input.reportType,
      ids: input.ids,
      options: input.options,
    }),
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(selectionFailureMessage(response.status, data.message ?? null));
  }
  const blob = await response.blob();
  if (!blob || blob.size === 0) {
    throw new Error("The report download was empty.");
  }
  const headerName = response.headers.get("Content-Disposition") ?? "";
  const matched = /filename="([^"]+)"/.exec(headerName);
  const filename = matched?.[1] || "MyVow-Report.pdf";
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
  const encoded = response.headers.get("X-Report-Warnings") ?? "";
  if (!encoded) return { warnings: [] };
  try {
    const parsed = JSON.parse(atob(encoded)) as unknown;
    return { warnings: Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [] };
  } catch {
    return { warnings: [] };
  }
}
