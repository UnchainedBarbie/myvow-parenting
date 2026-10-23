import assert from "node:assert/strict";
import { documentDownloadPath, downloadDispositionName } from "@/lib/documents-files";
import { documentDownloadAccess } from "@/lib/documents-tab";
import {
  incomingLibraryEntries,
  librarySearchText,
  NOT_FILED_LABEL,
  originalMessageHref,
} from "@/lib/documents/incoming-attachments";
import { calendarCardDate, needsDateField } from "@/components/sage/proposal-helpers";
import type { SageProposal } from "@/components/sage/proposal-types";

const caseId = "case-1";
const parent = { userId: "parent-1", role: "parent" };
const messageId = "11111111-1111-4111-8111-111111111111";
const otherMessageId = "22222222-2222-4222-8222-222222222222";
const documentId = "33333333-3333-4333-8333-333333333333";
const conversationId = "44444444-4444-4444-8444-444444444444";
const otherConversationId = "55555555-5555-4555-8555-555555555555";

const stored = {
  id: documentId,
  fileName: "Pediatrician listing.xlsx",
  status: "pending",
  visibility: "parents_only",
  uploadedBy: "parent-1",
};

const found = incomingLibraryEntries({
  caseId,
  viewer: parent,
  documents: [
    stored,
    {
      id: "pending-unlinked",
      fileName: "Draft upload.pdf",
      status: "pending",
      visibility: "parents_only",
      uploadedBy: "parent-1",
    },
    {
      id: "already-filed",
      fileName: "Order.pdf",
      status: "active",
      visibility: "parents_only",
      uploadedBy: "parent-1",
    },
  ],
  links: [
    {
      documentId,
      messageId,
      conversationId,
      sender: "coparent@example.com",
      receivedAt: "2026-10-23T15:00:00Z",
      direction: "incoming",
      caseId,
    },
    {
      documentId,
      messageId: otherMessageId,
      conversationId: otherConversationId,
      sender: "someone-else@example.com",
      receivedAt: "2026-10-01T15:00:00Z",
      direction: "incoming",
      caseId,
    },
  ],
});

assert.equal(found.length, 1);
assert.equal(found[0].id, documentId);
assert.equal(found[0].fileName, "Pediatrician listing.xlsx");
assert.equal(found[0].status, "pending");
assert.equal(found[0].label, "Incoming attachment");
assert.equal(found[0].unfiledLabel, NOT_FILED_LABEL);
assert.equal(found[0].messageId, messageId);
assert.equal(found[0].messageHref, originalMessageHref(conversationId));
assert.equal(found[0].messageHref?.includes(otherConversationId), false);
assert.equal(stored.status, "pending");
assert.equal(downloadDispositionName(stored.fileName), "Pediatrician listing.xlsx");
assert.equal(documentDownloadPath(documentId, false), `/api/documents/${documentId}/download?redirect=1`);
assert.equal(documentDownloadPath(documentId, false).includes("preview"), false);
assert.match(librarySearchText({ fileName: stored.fileName, filing: "incoming" }), /pediatrician listing\.xlsx/);
assert.match(librarySearchText({ fileName: stored.fileName, filing: "incoming" }), /incoming attachment/);
assert.match(librarySearchText({ filing: "incoming" }), /not filed/);

const hidden = incomingLibraryEntries({
  caseId,
  viewer: { userId: "other-parent", role: "parent" },
  documents: [{ ...stored, visibility: "private", uploadedBy: "parent-1" }],
  links: [
    {
      documentId,
      messageId,
      conversationId,
      sender: "coparent@example.com",
      receivedAt: "2026-10-23T15:00:00Z",
      direction: "incoming",
      caseId,
    },
  ],
});
assert.equal(hidden.length, 0);

assert.equal(
  documentDownloadAccess({
    found: true,
    status: "pending",
    visibility: "parents_only",
    uploadedBy: "parent-1",
    viewerId: "parent-1",
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
    uploadedBy: "parent-1",
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
    uploadedBy: "parent-1",
    viewerId: "outsider",
    viewerRole: null,
    viewerIsMember: false,
    link: "same_case",
  }),
  "forbidden"
);

const reply = {
  type: "reply_coparent",
  draft: "Thanks, I will review the pediatrician list.",
  depends_on: null,
} as SageProposal;
assert.equal(needsDateField(reply, null), false);
assert.equal(calendarCardDate(reply), null);

const calendar = {
  type: "calendar_update",
  draft: "Add the appointment.",
  depends_on: null,
  chosen_date: "2026-10-30",
  calendar_intent: "offer",
} as SageProposal;
assert.equal(needsDateField(calendar, null), false);
assert.equal(calendarCardDate(calendar), "2026-10-30");

const scheduling = {
  type: "schedule_change",
  draft: "Move pickup.",
  depends_on: null,
  calendar_intent: "update",
} as SageProposal;
assert.equal(needsDateField(scheduling, null), true);

console.log("incoming attachment tests passed");
