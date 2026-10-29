import { documentAuthorizedForViewer } from "@/lib/documents-tab";
import type { getServiceRoleClient } from "@/lib/supabase/server";
import {
  applyRevisionToProposals,
  documentStateFromRaw,
  type DocumentProposalState,
  type DocumentRevision,
} from "@/lib/sage/document-intent";
import { isInactiveProposal } from "@/lib/sage/proposal-lifecycle";
import { loadSessionItemIds } from "@/lib/sage/session-items";
import type { SearchableDocument } from "@/lib/sage/document-search";

type Admin = ReturnType<typeof getServiceRoleClient>;

export async function loadVisibleDocuments(
  admin: Admin,
  caseId: string,
  viewer: { userId: string; role: string | null | undefined }
): Promise<SearchableDocument[]> {
  const { data, error } = await admin
    .from("documents")
    .select("id, title, description, category, file_name, child_id, created_at, visibility, uploaded_by")
    .eq("case_id", caseId)
    .eq("status", "active")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(80);
  if (error || !data) {
    if (error) console.error("[sage/documents] load failed:", error.message);
    return [];
  }
  const rows = (data as {
    id: string;
    title?: string | null;
    description?: string | null;
    category?: string | null;
    file_name?: string | null;
    child_id?: string | null;
    created_at?: string | null;
    visibility?: string | null;
    uploaded_by?: string | null;
  }[]).filter((row) =>
    documentAuthorizedForViewer(
      { visibility: row.visibility, uploadedBy: row.uploaded_by },
      viewer
    )
  );
  const ids = rows.map((row) => row.id);
  const childIdsByDocument = new Map<string, string[]>();
  if (ids.length > 0) {
    const { data: links } = await admin
      .from("document_children")
      .select("document_id, child_id")
      .in("document_id", ids);
    for (const link of links ?? []) {
      const documentId = (link as { document_id?: string }).document_id;
      const childId = (link as { child_id?: string }).child_id;
      if (!documentId || !childId) continue;
      const list = childIdsByDocument.get(documentId) ?? [];
      list.push(childId);
      childIdsByDocument.set(documentId, list);
    }
  }
  return rows.map((row) => {
    const linked = childIdsByDocument.get(row.id) ?? [];
    const childIds = linked.length > 0 ? linked : row.child_id ? [row.child_id] : [];
    return {
      id: row.id,
      title: (row.title ?? "").trim(),
      description: (row.description ?? "").trim(),
      category: (row.category ?? "").trim() || "other",
      fileName: (row.file_name ?? "").trim(),
      childIds,
      createdAt: row.created_at ?? "",
      visibility: (row.visibility ?? "family").trim(),
      uploadedBy: row.uploaded_by ?? "",
    };
  });
}

/** Newest open document proposal on the case, even when the journal link is missing. */
/**
 * Newest items first, limited to this parent's own items in this chat session.
 * Another session's pending document, or the other parent's, never joins this conversation.
 */
async function sessionScopedItems<T extends { id?: string }>(
  admin: Admin,
  scope: { caseId: string; userId: string; sessionId: string | null },
  columns: string
): Promise<{ data: T[] | null; error: { message: string } | null }> {
  const ids = await loadSessionItemIds(admin, scope.sessionId, scope.userId);
  if (ids.length === 0) return { data: [], error: null };
  const { data, error } = await admin
    .from("sage_items")
    .select(columns)
    .in("id", ids)
    .eq("case_id", scope.caseId)
    .eq("visible_to", scope.userId)
    .order("created_at", { ascending: false })
    .limit(30);
  return { data: (data as unknown as T[] | null) ?? null, error };
}

export async function loadLatestOpenDocument(
  admin: Admin,
  caseId: string,
  userId: string,
  sessionId: string | null
): Promise<DocumentProposalState | null> {
  const { data, error } = await sessionScopedItems<{ id?: string; plan?: { proposals?: unknown[] } | null }>(
    admin,
    { caseId, userId, sessionId },
    "id, plan, created_at"
  );
  if (error || !data) {
    if (error) console.error("[sage/documents] open proposal load failed:", error.message);
    return null;
  }
  for (const row of data as { plan?: { proposals?: unknown[] } | null }[]) {
    const proposals = Array.isArray(row.plan?.proposals) ? row.plan.proposals : [];
    for (let index = proposals.length - 1; index >= 0; index -= 1) {
      const raw = proposals[index];
      if (!raw || typeof raw !== "object") continue;
      if (isInactiveProposal(raw)) continue;
      const state = documentStateFromRaw(raw);
      if (state) return state;
    }
  }
  return null;
}

/** Revise the open document proposal when the journal row is not linked to it. */
export async function reviseLatestOpenDocument(
  admin: Admin,
  caseId: string,
  userId: string,
  revision: DocumentRevision,
  sessionId: string | null
): Promise<{ id: string; plan: Record<string, unknown> } | null> {
  const { data, error } = await sessionScopedItems<{ id?: string; plan?: { proposals?: unknown[] } | null }>(
    admin,
    { caseId, userId, sessionId },
    "id, plan"
  );
  if (error || !data) return null;
  for (const row of data as { id?: string; plan?: { proposals?: unknown[] } | null }[]) {
    if (!row.id || !row.plan || !Array.isArray(row.plan.proposals)) continue;
    const applied = applyRevisionToProposals(row.plan.proposals, revision);
    if (!applied.changed) continue;
    const plan = { ...row.plan, proposals: applied.proposals };
    const { error: updateError } = await admin
      .from("sage_items")
      .update({
        plan,
        ...(revision.childId ? { child_ids: [revision.childId] } : {}),
      })
      .eq("id", row.id)
      .eq("visible_to", userId);
    if (updateError) {
      console.error("[sage/documents] revision update failed:", updateError.message);
      continue;
    }
    return { id: row.id, plan };
  }
  return null;
}

/**
 * Align a pending upload with the proposal the parent will review.
 * An already filed document stays unchanged until they approve the edit.
 */
export async function syncPendingDocumentMetadata(
  admin: Admin,
  proposal: {
    documentId: string | null;
    title: string;
    description: string;
    category: string;
    visibility: string;
    childId: string | null;
    updatesExisting: boolean;
  }
): Promise<void> {
  if (!proposal.documentId || proposal.updatesExisting) return;
  const { data: row } = await admin
    .from("documents")
    .select("id, status")
    .eq("id", proposal.documentId)
    .maybeSingle();
  if (!row || (row as { status?: string }).status !== "pending") return;
  const { error } = await admin
    .from("documents")
    .update({
      title: proposal.title.slice(0, 120),
      description: proposal.description.slice(0, 600),
      category: proposal.category || "other",
      visibility: proposal.visibility,
      child_id: proposal.childId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", proposal.documentId)
    .eq("status", "pending");
  if (error) {
    console.error("[sage/documents] pending metadata update failed:", error.message);
    return;
  }
  if (!proposal.childId) return;
  const { error: deleteError } = await admin
    .from("document_children")
    .delete()
    .eq("document_id", proposal.documentId);
  if (deleteError) {
    console.error("[sage/documents] child link clear failed:", deleteError.message);
    return;
  }
  const { error: insertError } = await admin
    .from("document_children")
    .insert({ document_id: proposal.documentId, child_id: proposal.childId });
  if (insertError) {
    console.error("[sage/documents] child link insert failed:", insertError.message);
  }
}
