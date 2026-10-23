import assert from "node:assert/strict";
import { documentOpensInline } from "@/lib/documents-files";
import { documentDownloadAccess } from "@/lib/documents-tab";
import type { MessageIntakeEvidence, StoredIntakeDocument } from "@/lib/messages/intake-evidence";
import { collectOwnerMailboxes } from "@/lib/messages/owner-mailboxes";
import { filesForMessages, sageAttachmentViews } from "@/lib/sage/message-attachments";
import { correctStoredIntakeTurn } from "@/lib/sage/stored-intake";
import { linkedIncomingMessageIds } from "@/lib/sage/original-message";

const owner = "owner-1";
const allison = "allison@theholisticaccountant.com";
const messageId = "11111111-1111-4111-8111-111111111111";
const otherMessageId = "22222222-2222-4222-8222-222222222222";
const documentId = "33333333-3333-4333-8333-333333333333";
const otherDocumentId = "44444444-4444-4444-8444-444444444444";
const pdfId = "55555555-5555-4555-8555-555555555555";

const xlsx: StoredIntakeDocument = {
  id: documentId,
  filename: "Pediatrician listing.xlsx",
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  read: false,
  visibility: "parents_only",
  uploadedBy: owner,
  status: "pending",
};
const pdf: StoredIntakeDocument = {
  id: pdfId,
  filename: "Visit summary.pdf",
  mimeType: "application/pdf",
  read: true,
  visibility: "parents_only",
  uploadedBy: owner,
  status: "pending",
};
const otherFile: StoredIntakeDocument = {
  ...xlsx,
  id: otherDocumentId,
  filename: "Other list.xlsx",
};

function evidenceFor(
  id: string,
  senderEmail: string,
  senderId: string,
  files: StoredIntakeDocument[]
): MessageIntakeEvidence {
  return {
    caseId: "case-1",
    senderId,
    senderEmail,
    senderEmails: [senderEmail],
    files,
  };
}

const ownerEmails = collectOwnerMailboxes({
  userEmail: "login@example.com",
  members: [{ external_email: allison, invited_email: null }],
  registeredEmails: [],
});
assert.ok(ownerEmails.includes(allison));
assert.equal(ownerEmails.includes("kevin@example.com"), false);

const storedRecord = { messageId, documentId, status: xlsx.status };
const evidence = new Map<string, MessageIntakeEvidence>([
  [messageId, evidenceFor(messageId, `Allison <${allison}>`, "other-user", [xlsx, pdf])],
  [otherMessageId, evidenceFor(otherMessageId, "kevin@example.com", "kevin-user", [otherFile])],
]);

const linked = linkedIncomingMessageIds({
  sourceMessageId: null,
  itemSourceType: "message",
  itemSourceId: messageId,
});
assert.deepEqual(linked, [messageId]);

const misclassified = correctStoredIntakeTurn({
  content:
    "Co-Parent is asking you to review the pediatrician list. A reply is ready for you to review.",
  summary: "Co-Parent is asking you to review the pediatrician list.",
  proposals: [
    { type: "reply_coparent", title: "Reply to Co-Parent", draft: "Thanks, I will review the list.", status: "" },
    { type: "log_document", draft: "File Pediatrician listing.xlsx", status: "" },
    { type: "note_only", draft: "Noted.", status: "" },
  ],
  linkedMessageIds: linked,
  evidence,
  ownerId: owner,
  ownerEmails,
  viewer: { userId: owner, role: "parent" },
});

assert.equal(misclassified.ownMessage, true);
assert.match(misclassified.content, /Pediatrician listing\.xlsx is attached/);
assert.match(misclassified.content, /Nothing has been filed or sent/);
assert.doesNotMatch(misclassified.content, /Co-Parent is asking/i);
assert.doesNotMatch(misclassified.content, /A reply is ready/i);
assert.doesNotMatch(misclassified.summary, /Co-Parent is asking/i);
assert.equal(misclassified.proposals[0].status, "dismissed");
assert.equal(misclassified.proposals[1].status, "dismissed");
assert.equal(misclassified.proposals[2].status, "");
assert.equal(misclassified.proposals.length, 3);
assert.deepEqual(misclassified.preserved.messageIds, [messageId]);
assert.deepEqual(misclassified.preserved.documentIds, [documentId, pdfId]);
assert.deepEqual(misclassified.preserved.statuses, ["pending", "pending"]);
assert.equal(storedRecord.messageId, messageId);
assert.equal(storedRecord.documentId, documentId);
assert.equal(storedRecord.status, "pending");
assert.equal(xlsx.status, "pending");

const shown = misclassified.attachments;
assert.equal(shown.length, 2);
assert.equal(shown[0].fileName, "Pediatrician listing.xlsx");
assert.equal(shown[0].icon, "spreadsheet");
assert.equal(shown[0].preview, false);
assert.equal(shown[0].id, documentId);
assert.equal(shown[1].fileName, "Visit summary.pdf");
assert.equal(shown[1].icon, "pdf");
assert.equal(shown[1].preview, true);

const onlyLinked = filesForMessages(linked, evidence);
assert.equal(onlyLinked.some((file) => file.id === otherDocumentId), false);

const coparent = correctStoredIntakeTurn({
  content: "Co-Parent is asking whether Friday still works.",
  summary: "Co-Parent is asking whether Friday still works.",
  proposals: [
    { type: "reply_coparent", draft: "Friday works for me.", status: "" },
  ],
  linkedMessageIds: [otherMessageId],
  evidence,
  ownerId: owner,
  ownerEmails,
  viewer: { userId: owner, role: "parent" },
});
assert.equal(coparent.ownMessage, false);
assert.match(coparent.content, /Co-Parent is asking whether Friday still works/);
assert.equal(coparent.proposals[0].status, "");
assert.equal(coparent.attachments[0].id, otherDocumentId);
assert.equal(coparent.attachments[0].fileName, "Other list.xlsx");
assert.equal(otherFile.status, "pending");

const hiddenFromChild = sageAttachmentViews([xlsx], { userId: "child-1", role: "child" });
assert.equal(hiddenFromChild.length, 0);
const visibleToParent = sageAttachmentViews([xlsx], { userId: owner, role: "parent" });
assert.equal(visibleToParent.length, 1);

assert.equal(
  documentDownloadAccess({
    found: true,
    status: "pending",
    visibility: "parents_only",
    uploadedBy: owner,
    viewerId: owner,
    viewerRole: "parent",
    viewerIsMember: true,
    link: "same_case",
  }),
  "ok"
);
assert.equal(
  documentDownloadAccess({
    found: true,
    status: "pending",
    visibility: "parents_only",
    uploadedBy: owner,
    viewerId: "child-1",
    viewerRole: "child",
    viewerIsMember: true,
    link: "same_case",
  }),
  "forbidden"
);
assert.equal(
  documentDownloadAccess({
    found: true,
    status: "pending",
    visibility: "parents_only",
    uploadedBy: owner,
    viewerId: "outsider",
    viewerRole: null,
    viewerIsMember: false,
    link: "same_case",
  }),
  "forbidden"
);
assert.equal(
  documentDownloadAccess({
    found: true,
    status: "pending",
    visibility: "parents_only",
    uploadedBy: "someone-else",
    viewerId: owner,
    viewerRole: "parent",
    viewerIsMember: true,
    link: "none",
  }),
  "not_found"
);
assert.equal(documentOpensInline("Visit summary.pdf", "application/pdf", true), true);
assert.equal(documentOpensInline("Pediatrician listing.xlsx", xlsx.mimeType, true), false);
assert.equal(documentOpensInline("Visit summary.pdf", "application/pdf", false), false);

console.log("sage message attachment tests passed");
