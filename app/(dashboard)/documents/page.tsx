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
      <div className="px-3 pt-3 pb-1 md:px-4 md:pt-4 md:pb-2">
        <h1 className="font-heading text-xl md:text-2xl font-semibold text-foreground mb-1">
          Documents
        </h1>
        <p className="text-xs md:text-sm text-foreground-secondary mb-2">
          Secure, time-stamped documentation. Court-export ready.
        </p>
        <div className="rounded-card border border-border bg-background-secondary p-8 text-center">
          <p className="text-foreground-secondary">
            Create or join a case in Settings to upload and view documents.
          </p>
        </div>
      </div>
    );
  }

  const { data: childrenData, error: childrenError } = await admin
    .from("children")
    .select("id, first_name")
    .eq("case_id", caseId)
    .order("first_name");
  console.log("CHILDREN QUERY:", { data: childrenData, error: childrenError });
  const children = childrenData ?? [];

  const { data: docsRaw } = await admin
    .from("documents")
    .select("id, title, file_name, file_size_bytes, mime_type, category, child_id, description, created_at, visibility")
    .eq("case_id", caseId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  const docIds = (docsRaw ?? []).map((d) => d.id);
  const { data: docChildrenRows } =
    docIds.length > 0
      ? await admin
          .from("document_children")
          .select("document_id, child_id")
          .in("document_id", docIds)
      : { data: [] };

  const docToChildIds = (docChildrenRows ?? []).reduce(
    (acc, row) => {
      const id = (row as { document_id: string; child_id: string }).document_id;
      const cid = (row as { document_id: string; child_id: string }).child_id;
      if (!acc[id]) acc[id] = [];
      acc[id].push(cid);
      return acc;
    },
    {} as Record<string, string[]>
  );

  const { data: messagesForLog } = await admin
    .from("messages")
    .select("id, external_comm_id, created_at")
    .eq("case_id", caseId)
    .not("external_comm_id", "eq", null)
    .order("created_at", { ascending: false })
    .limit(100);

  const childIdsFromJunction = [
    ...new Set((docChildrenRows ?? []).map((r) => (r as { child_id: string }).child_id)),
  ];
  const { data: childRows } =
    childIdsFromJunction.length > 0
      ? await admin.from("children").select("id, first_name").in("id", childIdsFromJunction)
      : { data: [] };
  const childMap = (childRows ?? []).reduce(
    (acc, c) => {
      acc[c.id] = c.first_name;
      return acc;
    },
    {} as Record<string, string>
  );

  const documents: DocumentRow[] = (docsRaw ?? []).map((d, index) => {
  const row = d as {
    id: string;
    title?: string | null;
    file_name: string;
    file_size_bytes?: number | null;
    mime_type?: string | null;
    category: string;
    child_id?: string | null;
    description?: string | null;
    created_at: string;
    visibility?: string;
    related_comm_id?: string | null;
    deleted_at?: string | null;
    document_number?: number | null;
  };
  const linkedChildIds = docToChildIds[row.id] ?? [];
  const child_name =
    linkedChildIds.length === 0
      ? "All children"
      : linkedChildIds.map((cid) => childMap[cid] ?? cid).join(", ");
  return {
    id: row.id,
    title: row.title ?? null,
    file_name: row.file_name,
    file_size_bytes: row.file_size_bytes ?? null,
    mime_type: row.mime_type ?? null,
    category: row.category,
    child_id: row.child_id ?? null,
    child_ids: linkedChildIds,
    child_name,
    description: row.description ?? null,
    created_at: row.created_at,
    visibility: row.visibility ?? "private",
    related_comm_id: row.related_comm_id ?? null,
    deleted_at: row.deleted_at ?? null,
    document_number: row.document_number ?? index + 1,
  };
});

  const logEntries = (messagesForLog ?? []).map((m) => ({
    id: m.id,
    external_comm_id: (m as { external_comm_id?: string | null }).external_comm_id ?? null,
    created_at: (m as { created_at: string }).created_at,
  }));

  console.log("CHILDREN DATA (documents page, passing to form):", children);

  return (
    <div className="px-3 pt-3 pb-1 md:px-4 md:pt-4 md:pb-2">
      <div className="mb-4">
        <h1 className="font-heading text-xl md:text-2xl font-semibold text-foreground mb-1">
          Documents
        </h1>
        <p className="text-xs md:text-sm text-foreground-secondary leading-snug">
          Secure, time-stamped documentation. Court-export ready.
        </p>
      </div>
      <div className="space-y-2">
        <div className="grid gap-4 lg:grid-cols-[minmax(260px,28%)_minmax(0,1fr)] items-start">
          <DocumentUploadForm caseId={caseId} children={children ?? []} logEntries={logEntries} />
          <DocumentList documents={documents} children={children ?? []} />
        </div>
      </div>
    </div>
  );
}
