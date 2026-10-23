import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { DocumentUploadForm } from "@/components/documents/document-upload-form";
import { DocumentList, type DocumentRow } from "@/components/documents/document-list";
import { documentAuthorizedForViewer } from "@/lib/documents-tab";
import { incomingLibraryEntries, type IncomingMessageLink } from "@/lib/documents/incoming-attachments";

export default async function DocumentsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = getServiceRoleClient();
  const { data: membership } = await admin
    .from("case_members")
    .select("case_id, role")
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

  const viewerRole = (membership as { role?: string | null } | null)?.role ?? null;
  const { data: docsRaw } = await admin
    .from("documents")
    .select("id, title, file_name, file_size_bytes, mime_type, category, child_id, description, created_at, visibility, document_number, uploaded_by, status")
    .eq("case_id", caseId)
    .eq("status", "active")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  const { data: pendingRaw } = await admin
    .from("documents")
    .select("id, title, file_name, file_size_bytes, mime_type, category, child_id, description, created_at, visibility, document_number, uploaded_by, status")
    .eq("case_id", caseId)
    .eq("status", "pending")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  const pendingIds = (pendingRaw ?? []).map((d) => d.id as string);
  let incomingLinks: IncomingMessageLink[] = [];
  if (pendingIds.length > 0) {
    const { data: linkRows } = await admin
      .from("message_documents")
      .select("document_id, message_id")
      .in("document_id", pendingIds);
    const messageIds = [
      ...new Set(
        (linkRows ?? [])
          .map((row) => (row as { message_id?: string }).message_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      ),
    ];
    const { data: messageRows } =
      messageIds.length > 0
        ? await admin
            .from("messages")
            .select("id, case_id, conversation_id, direction, created_at, sender_id, sender_external_email")
            .in("id", messageIds)
        : { data: [] };
    const senderIds = [
      ...new Set(
        (messageRows ?? [])
          .map((row) => (row as { sender_id?: string | null }).sender_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      ),
    ];
    const { data: senderRows } =
      senderIds.length > 0
        ? await admin.from("users").select("id, full_name, email").in("id", senderIds)
        : { data: [] };
    const senderById = new Map(
      (senderRows ?? []).map((row) => {
        const id = (row as { id: string }).id;
        const name = ((row as { full_name?: string | null }).full_name ?? "").trim();
        const email = ((row as { email?: string | null }).email ?? "").trim();
        return [id, name || email] as const;
      })
    );
    const messageById = new Map(
      (messageRows ?? []).map((row) => [(row as { id: string }).id, row])
    );
    incomingLinks = (linkRows ?? []).map((row) => {
      const documentId = (row as { document_id?: string }).document_id ?? "";
      const messageId = (row as { message_id?: string }).message_id ?? "";
      const message = messageById.get(messageId) as
        | {
            case_id?: string | null;
            conversation_id?: string | null;
            direction?: string | null;
            created_at?: string | null;
            sender_id?: string | null;
            sender_external_email?: string | null;
          }
        | undefined;
      const external = (message?.sender_external_email ?? "").trim();
      const named = message?.sender_id ? senderById.get(message.sender_id) ?? "" : "";
      return {
        documentId,
        messageId,
        conversationId: message?.conversation_id ?? null,
        sender: external || named || null,
        receivedAt: message?.created_at ?? null,
        direction: message?.direction ?? null,
        caseId: message?.case_id ?? null,
      };
    });
  }
  const incomingById = new Map(
    incomingLibraryEntries({
      documents: (pendingRaw ?? []).map((row) => ({
        id: row.id as string,
        fileName: String((row as { file_name?: string | null }).file_name ?? ""),
        status: (row as { status?: string | null }).status ?? null,
        visibility: (row as { visibility?: string | null }).visibility ?? null,
        uploadedBy: (row as { uploaded_by?: string | null }).uploaded_by ?? null,
      })),
      links: incomingLinks,
      caseId,
      viewer: { userId: user.id, role: viewerRole },
    }).map((entry) => [entry.id, entry])
  );

  const docIds = [...(docsRaw ?? []).map((d) => d.id as string), ...incomingById.keys()];
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

  const toRow = (d: Record<string, unknown>, filing: "filed" | "incoming"): DocumentRow | null => {
    const id = String(d.id ?? "");
    if (!id) return null;
    const allowed = documentAuthorizedForViewer(
      {
        visibility: typeof d.visibility === "string" ? d.visibility : null,
        uploadedBy: typeof d.uploaded_by === "string" ? d.uploaded_by : null,
      },
      { userId: user.id, role: viewerRole }
    );
    if (!allowed) return null;
    const incoming = filing === "incoming" ? incomingById.get(id) : undefined;
    if (filing === "incoming" && !incoming) return null;
    const linkedChildIds = docToChildIds[id] ?? [];
    const child_name =
      filing === "incoming" && linkedChildIds.length === 0
        ? "Not filed"
        : linkedChildIds.length === 0
          ? "All children"
          : linkedChildIds.map((cid) => childMap[cid] ?? cid).join(", ");
    return {
      id,
      title: typeof d.title === "string" ? d.title : null,
      file_name: String(d.file_name ?? ""),
      file_size_bytes: typeof d.file_size_bytes === "number" ? d.file_size_bytes : null,
      mime_type: typeof d.mime_type === "string" ? d.mime_type : null,
      category: typeof d.category === "string" ? d.category : "other",
      child_id: typeof d.child_id === "string" ? d.child_id : null,
      child_ids: linkedChildIds,
      child_name,
      description: typeof d.description === "string" ? d.description : null,
      created_at: incoming?.receivedAt || (typeof d.created_at === "string" ? d.created_at : ""),
      visibility: typeof d.visibility === "string" ? d.visibility : "private",
      related_comm_id: null,
      document_number: typeof d.document_number === "number" ? d.document_number : undefined,
      filing,
      source_message_id: incoming?.messageId ?? null,
      source_conversation_id: incoming?.conversationId ?? null,
      source_sender: incoming?.sender ?? null,
      message_href: incoming?.messageHref ?? null,
    };
  };

  const filed = (docsRaw ?? [])
    .map((row) => toRow(row as Record<string, unknown>, "filed"))
    .filter((row): row is DocumentRow => row != null);
  const incoming = (pendingRaw ?? [])
    .map((row) => toRow(row as Record<string, unknown>, "incoming"))
    .filter((row): row is DocumentRow => row != null);
  const documents: DocumentRow[] = [...incoming, ...filed];

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
