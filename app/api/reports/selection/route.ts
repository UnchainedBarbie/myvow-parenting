import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { buildDocumentIndexPdf } from "@/lib/reports/document-index-pdf";
import { prepareDocumentIndex } from "@/lib/reports/document-index";
import { loadDocumentIndex } from "@/lib/reports/document-index-load";
import { buildExpenseReportPdf } from "@/lib/reports/expense-report-pdf";
import { prepareExpenseReport } from "@/lib/reports/expense-report";
import { loadExpenseReport } from "@/lib/reports/expense-report-load";
import { assembleLabeledPdf } from "@/lib/reports/evidence-refs";
import { SelectionAccessError, uniqueSelectedIds } from "@/lib/reports/selection-access";
import {
  packageSelectionDownload,
  selectionDocumentOptions,
  selectionDownloadName,
  selectionExpenseOptions,
  selectionHasSection,
  type SelectionReportChoices,
  type SelectionReportKind,
} from "@/lib/reports/selection-report";

export const runtime = "nodejs";

const MAX_IDS = 100;

function choicesFrom(value: unknown): SelectionReportChoices {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const flag = (key: keyof SelectionReportChoices) => source[key] === true;
  return {
    summary: flag("summary"),
    details: flag("details"),
    files: flag("files"),
    index: flag("index"),
    metadata: flag("metadata"),
  };
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      case_id?: unknown;
      report_type?: unknown;
      ids?: unknown;
      options?: unknown;
    };
    const caseId = typeof body.case_id === "string" ? body.case_id.trim() : "";
    const reportType = body.report_type === "expenses" || body.report_type === "documents" ? body.report_type : null;
    const ids = Array.isArray(body.ids)
      ? uniqueSelectedIds(body.ids.filter((id): id is string => typeof id === "string"))
      : [];
    const choices = choicesFrom(body.options);
    if (!caseId || !reportType) {
      return NextResponse.json({ message: "Choose a report from Expenses or Documents." }, { status: 400 });
    }
    if (ids.length === 0) {
      return NextResponse.json({ message: "Select at least one record." }, { status: 400 });
    }
    if (ids.length > MAX_IDS) {
      return NextResponse.json({ message: `Select ${MAX_IDS} records or fewer.` }, { status: 400 });
    }
    if (!selectionHasSection(reportType, choices)) {
      return NextResponse.json({ message: "Choose at least one section to include." }, { status: 400 });
    }

    const admin = getServiceRoleClient();
    const { data: membership } = await admin
      .from("case_members")
      .select("case_id")
      .eq("case_id", caseId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!membership) {
      return NextResponse.json({ message: "Some selected records are not available." }, { status: 403 });
    }

    const day = new Date().toISOString().slice(0, 10);
    const pdfName = selectionDownloadName(reportType as SelectionReportKind, day, "pdf");
    const packed = await buildSelection(admin, {
      caseId,
      userId: user.id,
      reportType,
      ids,
      choices,
      pdfName,
    });
    return new NextResponse(new Uint8Array(packed.body), {
      headers: {
        "Content-Type": packed.contentType,
        "Content-Disposition": `attachment; filename="${packed.filename}"`,
        "Cache-Control": "private, no-store",
        "X-Report-Warnings": Buffer.from(JSON.stringify(packed.warnings), "utf8").toString("base64"),
      },
    });
  } catch (error) {
    if (error instanceof SelectionAccessError) {
      return NextResponse.json({ message: error.message }, { status: 403 });
    }
    console.error("[reports/selection]", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "The report could not be created." },
      { status: 500 }
    );
  }
}

async function buildSelection(
  admin: ReturnType<typeof getServiceRoleClient>,
  input: {
    caseId: string;
    userId: string;
    reportType: SelectionReportKind;
    ids: string[];
    choices: SelectionReportChoices;
    pdfName: string;
  }
) {
  if (input.reportType === "expenses") {
    const options = selectionExpenseOptions(input.choices);
    const loaded = await loadExpenseReport({
      admin,
      caseId: input.caseId,
      userId: input.userId,
      dateStart: null,
      dateEnd: null,
      options,
      embedInPdf: true,
      recordIds: input.ids,
    });
    if (loaded.expenses.length !== input.ids.length) {
      throw new SelectionAccessError(input.ids.length - loaded.expenses.length);
    }
    let warnings: string[] = [];
    const assembled = await assembleLabeledPdf({
      files: loaded.receiptFiles,
      includeFiles: options.receiptsZip,
      bundleFolder: "receipts",
      build: (labels) => {
        const prepared = prepareExpenseReport({
          expenses: loaded.expenses,
          parents: loaded.parents,
          caseLabel: loaded.caseLabel,
          timeZone: loaded.timeZone,
          dateStart: null,
          dateEnd: null,
          generatedAt: new Date(),
          viewerId: loaded.viewerId,
          viewerName: loaded.viewerName,
          options,
          receiptLines: loaded.receiptLines,
          evidenceLabels: labels,
          scope: "selected",
        });
        return buildExpenseReportPdf(prepared.document, loaded.caseLabel, prepared.verificationPayload);
      },
    });
    warnings = assembled.warnings;
    const packed = await packageSelectionDownload({
      pdf: assembled.pdf,
      pdfName: input.pdfName,
      bundle: assembled.bundle,
      warnings,
    });
    return { ...packed, warnings };
  }

  const options = selectionDocumentOptions(input.choices);
  const loaded = await loadDocumentIndex({
    admin,
    caseId: input.caseId,
    userId: input.userId,
    options,
    recordIds: input.ids,
  });
  if (loaded.documents.length !== input.ids.length) {
    throw new SelectionAccessError(input.ids.length - loaded.documents.length);
  }
  const assembled = await assembleLabeledPdf({
    files: loaded.files,
    includeFiles: options.includeFiles,
    bundleFolder: "documents",
    build: (labels) => {
      const prepared = prepareDocumentIndex({
        documents: loaded.documents,
        parents: loaded.parents,
        caseLabel: loaded.caseLabel,
        timeZone: loaded.timeZone,
        generatedAt: new Date(),
        options,
        withheldCount: loaded.withheldCount,
        fileLines: loaded.fileLines,
        linkWarning: loaded.linkWarning,
        evidenceLabels: labels,
        scope: "selected",
      });
      return buildDocumentIndexPdf(prepared.document, loaded.caseLabel, prepared.verificationPayload);
    },
  });
  const packed = await packageSelectionDownload({
    pdf: assembled.pdf,
    pdfName: input.pdfName,
    bundle: assembled.bundle,
    warnings: assembled.warnings,
  });
  return { ...packed, warnings: assembled.warnings };
}
