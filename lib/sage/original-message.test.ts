import assert from "node:assert/strict";
import {
  isMessageId,
  linkedIncomingMessageIds,
  originalMessageAccess,
  originalViewPolicy,
  safeOriginalBody,
  selectOriginalMessage,
  visibleOriginalAttachments,
} from "@/lib/sage/original-message";

const first = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";

assert.deepEqual(
  linkedIncomingMessageIds({
    sourceMessageId: first,
    itemSourceType: "message",
    itemSourceId: first,
  }),
  [first]
);
assert.deepEqual(
  linkedIncomingMessageIds({
    sourceMessageId: first,
    itemSourceType: "message",
    itemSourceId: second,
  }),
  [first, second]
);
assert.deepEqual(
  linkedIncomingMessageIds({
    sourceMessageId: null,
    itemSourceType: "chat",
    itemSourceId: second,
  }),
  []
);
assert.equal(isMessageId("not-an-id"), false);

const rows = [
  { id: first, created_at: "2026-10-01T00:00:00Z", body: "First note" },
  { id: second, created_at: "2026-10-22T00:00:00Z", body: "Later note" },
];
assert.equal(selectOriginalMessage(first, rows)?.body, "First note");
assert.equal(selectOriginalMessage(second, rows)?.body, "Later note");
assert.equal(selectOriginalMessage("latest", rows), null);

assert.equal(
  originalMessageAccess({
    signedIn: true,
    role: "parent",
    memberCaseId: "case-1",
    messageCaseId: "case-1",
    direction: "incoming",
    found: true,
  }),
  "ok"
);
assert.equal(
  originalMessageAccess({
    signedIn: true,
    role: "child",
    memberCaseId: "case-1",
    messageCaseId: "case-1",
    direction: "incoming",
    found: true,
  }),
  "forbidden"
);
assert.equal(
  originalMessageAccess({
    signedIn: true,
    role: "parent",
    memberCaseId: "case-2",
    messageCaseId: "case-1",
    direction: "incoming",
    found: true,
  }),
  "forbidden"
);
assert.equal(
  originalMessageAccess({
    signedIn: false,
    role: null,
    memberCaseId: null,
    messageCaseId: "case-1",
    direction: "incoming",
    found: true,
  }),
  "unauthorized"
);
assert.equal(
  originalMessageAccess({
    signedIn: true,
    role: "parent",
    memberCaseId: "case-1",
    messageCaseId: "case-1",
    direction: "incoming",
    found: false,
  }),
  "unavailable"
);
assert.equal(
  originalMessageAccess({
    signedIn: true,
    role: "parent",
    memberCaseId: "case-1",
    messageCaseId: "case-1",
    direction: "outgoing",
    found: true,
  }),
  "unavailable"
);
assert.equal(
  originalMessageAccess({
    signedIn: true,
    role: "parent",
    memberCaseId: "case-1",
    messageCaseId: "case-1",
    direction: "outgoing",
    found: true,
    viewerId: "parent-kevin",
    senderId: "parent-ashley",
  }),
  "ok"
);
assert.equal(
  originalMessageAccess({
    signedIn: true,
    role: "parent",
    memberCaseId: "case-1",
    messageCaseId: "case-1",
    direction: "outgoing",
    found: true,
    viewerId: "parent-ashley",
    senderId: "parent-ashley",
  }),
  "unavailable"
);
assert.equal(
  originalMessageAccess({
    signedIn: true,
    role: "parent",
    memberCaseId: "case-2",
    messageCaseId: "case-1",
    direction: "outgoing",
    found: true,
    viewerId: "parent-other",
    senderId: "parent-ashley",
  }),
  "forbidden"
);

const rewritten = "Sage shortened this.";
const original = "Line one\n\nLine two";
assert.equal(safeOriginalBody(original), original);
assert.notEqual(safeOriginalBody(original), rewritten);
assert.equal(
  safeOriginalBody('<p>Hello</p><img src="https://example.com/pixel.png" alt="x"><br>Next'),
  "Hello\n[image]\nNext"
);
assert.doesNotMatch(safeOriginalBody('<img src="https://example.com/a.png">'), /https:\/\/example.com/);

const attachments = visibleOriginalAttachments(
  [
    {
      id: "doc-1",
      fileName: "list.xlsx",
      mimeType: "application/vnd.ms-excel",
      visibility: "parents_only",
      uploadedBy: "parent-a",
    },
    {
      id: "doc-2",
      fileName: "private.pdf",
      mimeType: "application/pdf",
      visibility: "private",
      uploadedBy: "parent-a",
    },
  ],
  { userId: "parent-b", role: "parent" }
);
assert.deepEqual(attachments.map((file) => file.fileName), ["list.xlsx"]);
assert.equal(
  visibleOriginalAttachments(attachments, { userId: "kid", role: "child" }).length,
  0
);

assert.deepEqual(originalViewPolicy(), { markRead: false, sendReceipt: false, approve: false });

console.log("original message tests passed");
