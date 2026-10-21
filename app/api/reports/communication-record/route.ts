import { NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { loadCommunicationFiles, loadCommunicationRecord } from "@/lib/record/load-communication-record";
import { communicationCsv, verificationPayload } from "@/lib/reports/communication-record";
import { assembleCommunicationPdf } from "@/lib/reports/communication-record-assemble";
import { buildChronologicalPdf, buildTranscriptPdf } from "@/lib/reports/communication-record-pdf";
import { zipReport } from "@/lib/reports/expense-report-load";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function downloadName(caseLabel: string, extension: string): string {
  const cleaned =
    caseLabel
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "case";
  return `Communication-Record-${cleaned}.${extension}`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const caseId = url.searchParams.get("case_id")?.trim() ?? "";
  if (!UUID_RE.test(caseId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const format = url.searchParams.get("format") === "csv" ? "csv" : "pdf";
  const layout = url.searchParams.get("layout") === "transcript" ? "transcript" : "table";
  const includeFlag = (url.searchParams.get("include_attachments") ?? "1").trim().toLowerCase();
  const includeAttachments = includeFlag !== "0" && includeFlag !== "false";

  const searchParams: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    if (key === "case_id" || key === "format" || key === "layout" || key === "include_attachments") return;
    searchParams[key] = value;
  });

  try {
    const admin = getServiceRoleClient();
    const loaded = await loadCommunicationRecord(admin, user.id, caseId, searchParams);
    if (!loaded.ok) {
      const status = loaded.reason === "denied" ? 403 : 404;
      return NextResponse.json({ error: status === 403 ? "Forbidden" : "Not found" }, { status });
    }

    if (format === "csv") {
      const csv = Buffer.from(communicationCsv(loaded.model), "utf8");
      const name = downloadName(loaded.model.caseLabel, "csv");
      return new NextResponse(new Uint8Array(csv), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${name}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const files = includeAttachments ? await loadCommunicationFiles(admin, loaded.model) : [];
    const payload = verificationPayload(loaded.model, layout, includeAttachments);
    const build =
      layout === "transcript"
        ? (evidence: Parameters<typeof buildTranscriptPdf>[1]) =>
            buildTranscriptPdf(loaded.model, evidence, payload)
        : (evidence: Parameters<typeof buildChronologicalPdf>[1]) =>
            buildChronologicalPdf(loaded.model, evidence, payload);
    const assembled = await assembleCommunicationPdf(build, files, includeAttachments);
    const name = downloadName(loaded.model.caseLabel, assembled.bundle.length > 0 ? "zip" : "pdf");
    const body =
      assembled.bundle.length > 0
        ? await zipReport(downloadName(loaded.model.caseLabel, "pdf"), assembled.pdf, assembled.bundle)
        : assembled.pdf;
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": assembled.bundle.length > 0 ? "application/zip" : "application/pdf",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[communication-record]", error);
    return NextResponse.json({ error: "The communication record could not be exported." }, { status: 500 });
  }
}
