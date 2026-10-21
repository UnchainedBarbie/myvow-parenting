"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

export default function ReportPreviewPage() {
  const params = useParams<{ exportId: string }>();
  const search = useSearchParams();
  const exportId = params.exportId;
  const hasBundle = search.get("bundle") === "1";
  const [warnings, setWarnings] = useState<string[]>([]);
  const [printError, setPrintError] = useState("");
  const inlineUrl = `/api/reports/download/${exportId}?inline=1`;
  const downloadUrl = `/api/reports/download/${exportId}`;
  const bundleUrl = `/api/reports/download/${exportId}?bundle=1`;

  useEffect(() => {
    const stored = sessionStorage.getItem(`report-warnings:${exportId}`);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as unknown;
      if (Array.isArray(parsed)) {
        setWarnings(parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0));
      }
    } catch {
      setWarnings([]);
    }
  }, [exportId]);

  async function printPdf() {
    setPrintError("");
    const frame = document.getElementById("report-preview-frame") as HTMLIFrameElement | null;
    try {
      frame?.contentWindow?.focus();
      frame?.contentWindow?.print();
    } catch {
      setPrintError("The preview could not open the print dialog. Use Download PDF and print that file.");
    }
  }

  return (
    <main className="flex min-h-screen flex-col bg-[#F7F4EE] text-[#3D3D3D]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[#E8E4DC] bg-white px-4 py-3">
        <h1 className="mr-auto text-sm font-medium">Report preview</h1>
        <button
          type="button"
          onClick={() => void printPdf()}
          className="inline-flex h-9 items-center rounded-full bg-[#5B7A52] px-4 text-sm text-white hover:bg-[#476242]"
        >
          Print
        </button>
        <a
          href={downloadUrl}
          className="inline-flex h-9 items-center rounded-full border border-[#5B7A52] bg-white px-4 text-sm text-[#5B7A52] hover:bg-[#F2F5EF]"
        >
          Download PDF
        </a>
        {hasBundle ? (
          <a
            href={bundleUrl}
            className="inline-flex h-9 items-center rounded-full border border-[#E8E4DC] bg-white px-4 text-sm hover:bg-[#F7F4EE]"
          >
            Download omitted files
          </a>
        ) : null}
      </div>
      {warnings.length > 0 ? (
        <div className="border-b border-[#E4C56A] bg-[#FFF8E8] px-4 py-3 text-sm">
          <p className="font-medium">Some supporting files could not be included.</p>
          <ul className="mt-1 list-disc pl-5">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
          <p className="mt-1">The preview still lists those records and states that the files are unavailable.</p>
        </div>
      ) : null}
      {printError ? <p className="px-4 py-2 text-sm text-[#8A3B32]">{printError}</p> : null}
      <iframe id="report-preview-frame" title="Report preview" src={inlineUrl} className="min-h-0 w-full flex-1 border-0" />
    </main>
  );
}
