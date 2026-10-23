/** Labels used by the Documents tab. Reports must use these same strings. */

export const DOCUMENT_CATEGORY_LABELS: Record<string, string> = {
  court_order: "Court Order",
  school: "School",
  medical: "Medical",
  expenses: "Expenses",
  therapy: "Therapy",
  legal: "Legal",
  custody: "Custody",
  photos: "Photos",
  communication: "Communication",
  incident: "Incident",
  other: "Other",
  financial: "Expenses",
};

export const DOCUMENT_VISIBILITY_LABELS: Record<string, string> = {
  private: "Just me",
  family: "Family",
  parents_only: "Parents only",
  family_read_only: "Family",
  shared_ai_review: "Parents only",
};

export function documentCategoryLabel(category: string | null | undefined): string {
  const key = category?.trim() ?? "";
  if (!key) return "Other";
  return DOCUMENT_CATEGORY_LABELS[key] ?? key;
}

export function documentVisibilityLabel(visibility: string | null | undefined): string {
  const key = visibility?.trim() ?? "";
  if (!key) return "Just me";
  return DOCUMENT_VISIBILITY_LABELS[key] ?? key;
}

export function formatDocumentNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `DOC-${String(Math.trunc(value)).padStart(3, "0")}`;
}

/**
 * Private documents are visible only to the parent who uploaded them.
 * Parents-only documents are visible to parents and professional viewers on the case.
 * Family documents are visible to any case member.
 */
export function documentAuthorizedForViewer(
  doc: { visibility: string | null | undefined; uploadedBy: string | null | undefined },
  viewer: { userId: string; role: string | null | undefined }
): boolean {
  const visibility = (doc.visibility ?? "family").trim().toLowerCase();
  if (visibility === "private") return doc.uploadedBy === viewer.userId;
  if (visibility === "parents_only" || visibility === "shared_ai_review") {
    const role = (viewer.role ?? "").trim().toLowerCase();
    return role === "parent" || role === "professional_viewer" || doc.uploadedBy === viewer.userId;
  }
  return true;
}

export type DocumentLinkScope = "none" | "same_case" | "other_case";

/**
 * Whether this viewer may use the document download route.
 * Pending files stay pending. A pending file the viewer did not upload is
 * available only when a message on the same case already links it.
 */
export function documentDownloadAccess(input: {
  found: boolean;
  status: string | null;
  visibility: string | null;
  uploadedBy: string | null;
  viewerId: string;
  viewerRole: string | null;
  viewerIsMember: boolean;
  link: DocumentLinkScope;
}): "ok" | "forbidden" | "not_found" {
  if (!input.found) return "not_found";
  const status = (input.status ?? "").trim().toLowerCase();
  if (status !== "active" && status !== "pending") return "not_found";
  if (!input.viewerIsMember) return "forbidden";
  const allowed = documentAuthorizedForViewer(
    { visibility: input.visibility, uploadedBy: input.uploadedBy },
    { userId: input.viewerId, role: input.viewerRole }
  );
  if (!allowed) return "forbidden";
  if (status === "pending" && input.uploadedBy !== input.viewerId) {
    if (input.link === "none") return "not_found";
    if (input.link === "other_case") return "forbidden";
  }
  return "ok";
}
