import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { DocumentUploadForm } from "@/components/documents/document-upload-form";
import { DocumentList, type DocumentRow } from "@/components/documents/document-list";

export default async function DocumentsPage() {
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
          Documents
        </h1>
        <p className="text-foreground-secondary mb-8">
          Secure document vault with categories and access log.
        </p>
        <div className="rounded-card border border-border bg-background-secondary p-8 text-center">
          <p className="text-foreground-secondary">
            Create or join a case in Settings to upload and view documents.
          </p>
        </div>
      </div>
    );
  }

  const { data: children } = await admin
    .from("children")
    .select("id, first_name")
    .eq("case_id", caseId)
    .order("first_name");

  const { data: docsRaw } = await admin
    .from("documents")
    .select(
      "id, file_name, file_size_bytes, mime_type, category, child_id, description, created_at"
    )
    .eq("case_id", caseId)
    .order("created_at", { ascending: false });

  const childIds = [
    ...new Set(
      (docsRaw ?? []).map((d) => d.child_id).filter(Boolean)
    ),
  ] as string[];
  const { data: childRows } =
    childIds.length > 0
      ? await admin.from("children").select("id, first_name").in("id", childIds)
      : { data: [] };
  const childMap = (childRows ?? []).reduce(
    (acc, c) => {
      acc[c.id] = c.first_name;
      return acc;
    },
    {} as Record<string, string>
  );

  const documents: DocumentRow[] = (docsRaw ?? []).map((d) => ({
    id: d.id,
    file_name: d.file_name,
    file_size_bytes: d.file_size_bytes,
    mime_type: d.mime_type,
    category: d.category,
    child_id: d.child_id,
    child_name: d.child_id ? childMap[d.child_id] ?? null : null,
    description: d.description,
    created_at: d.created_at,
  }));

  return (
    <div className="p-6 md:p-8">
      <h1 className="font-heading text-2xl font-semibold text-foreground mb-2">
        Documents
      </h1>
      <p className="text-foreground-secondary mb-8">
        Upload PDFs and images. Categorize by type and optionally assign to a
        child. Access is logged.
      </p>
      <div className="space-y-8">
        <DocumentUploadForm caseId={caseId} children={children ?? []} />
        <DocumentList documents={documents} />
      </div>
    </div>
  );
}
