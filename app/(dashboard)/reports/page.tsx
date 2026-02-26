import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ExportForm } from "@/components/reports/export-form";
import { ExportList, type ExportRow } from "@/components/reports/export-list";

export default async function ReportsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = getServiceRoleClient();
  const { data: membership } = await admin
    .from("case_members")
    .select("case_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  const caseId = membership?.case_id ?? null;

  if (!caseId) {
    return (
      <div className="p-6 md:p-8">
        <h1 className="font-heading text-2xl font-semibold text-foreground mb-2">
          Reports
        </h1>
        <p className="text-foreground-secondary mb-8">
          Court-ready exports with date range and verification hash.
        </p>
        <div className="rounded-card border border-border bg-background-secondary p-8 text-center">
          <p className="text-foreground-secondary">
            Create or join a case in Settings to generate exports.
          </p>
        </div>
      </div>
    );
  }

  const { data: exportsRaw } = await admin
    .from("court_exports")
    .select(
      "id, export_type, date_range_start, date_range_end, file_path, verification_hash, record_count, created_at"
    )
    .eq("case_id", caseId)
    .order("created_at", { ascending: false });

  const exports: ExportRow[] = (exportsRaw ?? []).map((e) => ({
    id: e.id,
    export_type: e.export_type,
    date_range_start: e.date_range_start,
    date_range_end: e.date_range_end,
    file_path: e.file_path,
    verification_hash: e.verification_hash,
    record_count: e.record_count,
    created_at: e.created_at,
  }));

  return (
    <div className="p-6 md:p-8">
      <h1 className="font-heading text-2xl font-semibold text-foreground mb-2">
        Reports
      </h1>
      <p className="text-foreground-secondary mb-8">
        Generate court-ready PDF exports. Each export is logged for the audit trail
        and includes a verification hash.
      </p>
      <div className="space-y-8">
        <ExportForm caseId={caseId} />
        <ExportList exports={exports} />
      </div>
    </div>
  );
}
