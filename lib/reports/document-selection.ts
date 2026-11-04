import { documentAuthorizedForViewer } from "@/lib/documents-tab";
import {
  incomingLibraryEntries,
  type IncomingMessageLink,
} from "@/lib/documents/incoming-attachments";
import { missingSelectedIds, uniqueSelectedIds } from "@/lib/reports/selection-access";

export type SelectableDocument = {
  id: string;
  fileName: string;
  status: string | null;
  visibility: string | null;
  uploadedBy: string | null;
};

/**
 * Records a parent can already select in Documents.
 * Filed rows are active and authorized. Incoming rows are the same pending
 * attachments the library lists. Nothing is filed, copied, or removed.
 */
export function documentsForSelection<T extends SelectableDocument>(input: {
  active: T[];
  pending: T[];
  links: IncomingMessageLink[];
  caseId: string;
  viewer: { userId: string; role: string | null };
  recordIds: string[];
}): { included: T[]; missing: string[]; incomingIds: Set<string> } {
  const active = input.active.filter((doc) =>
    documentAuthorizedForViewer(
      { visibility: doc.visibility, uploadedBy: doc.uploadedBy },
      input.viewer
    )
  );
  const incoming = incomingLibraryEntries({
    documents: input.pending.map((doc) => ({
      id: doc.id,
      fileName: doc.fileName,
      status: doc.status,
      visibility: doc.visibility,
      uploadedBy: doc.uploadedBy,
    })),
    links: input.links,
    caseId: input.caseId,
    viewer: input.viewer,
  });
  const incomingIds = new Set(incoming.map((entry) => entry.id));
  const pendingById = new Map(input.pending.map((doc) => [doc.id, doc]));
  const byId = new Map<string, T>();
  for (const doc of active) byId.set(doc.id, doc);
  for (const id of incomingIds) {
    const doc = pendingById.get(id);
    if (doc && !byId.has(doc.id)) byId.set(doc.id, doc);
  }
  const wanted = uniqueSelectedIds(input.recordIds);
  return {
    included: wanted.flatMap((id) => {
      const doc = byId.get(id);
      return doc ? [doc] : [];
    }),
    missing: missingSelectedIds([...byId.values()], wanted),
    incomingIds,
  };
}
