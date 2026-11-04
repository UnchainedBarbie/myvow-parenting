import assert from "node:assert/strict";
import type { IncomingMessageLink } from "@/lib/documents/incoming-attachments";
import { documentsForSelection, type SelectableDocument } from "@/lib/reports/document-selection";
import { namedUnavailableMessage } from "@/lib/reports/selection-report-shared";

const CASE = "case-1";
const viewer = { userId: "alex", role: "parent" };

function doc(partial: Partial<SelectableDocument> & Pick<SelectableDocument, "id">): SelectableDocument {
  return {
    fileName: "file.pdf",
    status: "active",
    visibility: "family",
    uploadedBy: "alex",
    ...partial,
  };
}

function link(
  documentId: string,
  partial: Partial<IncomingMessageLink> = {}
): IncomingMessageLink {
  return {
    documentId,
    messageId: "message-1",
    conversationId: "conversation-1",
    sender: "Jordan Lee",
    receivedAt: "2026-10-12T18:00:00.000Z",
    direction: "incoming",
    caseId: CASE,
    ...partial,
  };
}

const filed = doc({ id: "filed-1", fileName: "note.pdf", status: "active" });
const incoming = doc({
  id: "incoming-1",
  fileName: "Pediatrician listing.xlsx",
  status: "pending",
  visibility: "private",
  uploadedBy: "alex",
});
const privateOther = doc({
  id: "private-other",
  fileName: "secret.pdf",
  status: "pending",
  visibility: "private",
  uploadedBy: "jordan",
});
const unlinked = doc({ id: "draft-1", fileName: "draft.pdf", status: "pending" });
const outgoing = doc({ id: "outgoing-1", fileName: "sent.pdf", status: "pending" });

const selected = documentsForSelection({
  active: [filed, doc({ id: "unselected", fileName: "other.pdf" })],
  pending: [incoming, privateOther, unlinked, outgoing],
  links: [
    link("incoming-1"),
    link("private-other"),
    link("outgoing-1", { direction: "outgoing" }),
    link("wrong-case", { caseId: "case-2" }),
  ],
  caseId: CASE,
  viewer,
  recordIds: ["incoming-1", "filed-1", "private-other", "draft-1", "outgoing-1", "missing-row"],
});

assert.deepEqual(
  selected.included.map((row) => row.id),
  ["incoming-1", "filed-1"]
);
assert.deepEqual(selected.missing, ["private-other", "draft-1", "outgoing-1", "missing-row"]);
assert.equal(selected.incomingIds.has("incoming-1"), true);
assert.equal(selected.incomingIds.has("filed-1"), false);
assert.equal(selected.included.some((row) => row.id === "unselected"), false);

assert.equal(
  namedUnavailableMessage("2 selected records are not available.", ["private-other"], new Map()),
  "2 selected records are not available."
);
assert.equal(
  namedUnavailableMessage("1 selected record is not available.", ["incoming-1"], new Map([["incoming-1", "Pediatrician listing"]])),
  "Pediatrician listing is not available."
);

console.log("document selection tests passed");
