import assert from "node:assert/strict";
import { unreadDocumentClassification } from "@/lib/ai-classify";
import { messageAttachmentDecision } from "@/lib/sage/attachment-role";
import type { DocumentProposalState } from "@/lib/sage/document-intent";
import { processChatAttachment } from "@/lib/sage/process-chat-attachment";

const today = new Date("2026-10-21T18:00:00Z");
const timezone = "America/Denver";
const children = [
  { id: "child-ashley", name: "Ashley" },
  { id: "child-avery", name: "Avery" },
];
const kevin = { name: "Kevin", email: "kevin@example.com" };
const pendingAshley: DocumentProposalState = {
  key: "ashley-eval",
  title: "Ashley — Occupational Therapy Evaluation",
  description: "Occupational therapy evaluation for Ashley",
  category: "therapy",
  visibility: "parents_only",
  childName: "Ashley",
  childId: "child-ashley",
  fileName: null,
  documentId: "doc-ashley",
  requiresApproval: true,
  updatesExisting: false,
};

function sheet(name: string) {
  return {
    document_id: "doc-sheet",
    file_name: name,
    url: `/api/documents/doc-sheet/download`,
    visibility: "parents_only",
  };
}

async function turn(caption: string, fileName: string, mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
  return processChatAttachment({
    caseId: "case-1",
    timezone,
    caption,
    classify: unreadDocumentClassification(fileName),
    attachment: { ...sheet(fileName), ...(mime.startsWith("application/pdf") ? { visibility: "parents_only" } : {}) },
    children,
    coparents: [kevin],
    pendingDocument: pendingAshley,
    today,
  });
}

async function main() {
  const send = await turn(
    "Send this spreadsheet to my co-parent and ask for feedback",
    "Pediatrician listing.xlsx"
  );
  assert.equal(send.kind, "message");
  assert.match(send.reply, /Nothing is sent until you choose Send/);
  assert.equal(send.result?.plan.proposals.some((proposal) => proposal.type === "log_document"), false);
  const message = send.result?.plan.proposals.find((proposal) => proposal.type === "reply_coparent");
  assert.equal(message?.requires_approval, true);
  assert.equal("executed" in (message ?? {}), false);
  assert.equal(message?.attached_file_name, "Pediatrician listing.xlsx");
  assert.equal(message?.attached_document_id, "doc-sheet");
  assert.equal(message?.recipient_email, "kevin@example.com");
  assert.equal(message?.document_child_id, undefined);
  assert.match(message?.draft ?? "", /Pediatrician listing\.xlsx/);
  assert.match(message?.draft ?? "", /haven't read|Please review/);
  assert.equal(send.result?.child_ids.length, 0);

  const live = await turn(
    "We need to pick a pediatrician for the children. Can you send this list and have coparent review the attached list and provide their thoughts?",
    "Pediatrician listing.xlsx"
  );
  const liveMessage = live.result?.plan.proposals.find((proposal) => proposal.type === "reply_coparent");
  assert.equal(live.kind, "message");
  assert.match(liveMessage?.draft ?? "", /children/);
  assert.doesNotMatch(liveMessage?.draft ?? "", /Ashley|Avery/);
  assert.equal(live.result?.plan.proposals.some((proposal) => proposal.type === "log_document"), false);
  assert.equal(live.result?.child_ids.includes("child-ashley"), false);

  const save = await turn("Save this spreadsheet in Documents", "Pediatrician listing.xlsx");
  assert.equal(save.kind, "document");
  assert.equal(save.result?.plan.proposals.some((proposal) => proposal.type === "reply_coparent"), false);
  const filed = save.result?.plan.proposals.find((proposal) => proposal.type === "log_document");
  assert.equal(filed?.requires_approval, true);
  assert.equal(filed?.attached_file_name, "Pediatrician listing.xlsx");
  assert.equal(filed?.document_child_id ?? null, null);
  assert.notEqual(filed?.key, "ashley-eval");

  const summary = await turn("Summarize this spreadsheet", "Pediatrician listing.xlsx");
  assert.equal(summary.kind, "explain");
  assert.equal(summary.result, null);
  assert.match(summary.reply, /haven't read its contents/);
  assert.doesNotMatch(summary.reply, /I can save this file in Documents once you approve it/);

  const pdf = await processChatAttachment({
    caseId: "case-1",
    timezone,
    caption: "Attach this PDF to a message",
    classify: { ...unreadDocumentClassification("school-note.pdf"), contentsRead: false },
    attachment: sheet("school-note.pdf"),
    children,
    coparents: [kevin],
    today,
  });
  const pdfMessage = pdf.result?.plan.proposals.find((proposal) => proposal.type === "reply_coparent");
  assert.equal(pdf.kind, "message");
  assert.equal(pdfMessage?.attached_file_name, "school-note.pdf");
  assert.equal(pdf.result?.plan.proposals.some((proposal) => proposal.type === "log_document"), false);

  const both = await turn(
    "Save this document and send it to my co-parent",
    "Pediatrician listing.xlsx"
  );
  assert.equal(both.kind, "message");
  const bothTypes = (both.result?.plan.proposals ?? []).map((proposal) => proposal.type).sort();
  assert.deepEqual(bothTypes, ["log_document", "reply_coparent"]);
  assert.ok(both.result?.plan.proposals.every((proposal) => proposal.requires_approval === true));
  assert.ok(both.result?.plan.proposals.every((proposal) => !("executed" in proposal)));
  assert.match(both.reply, /Nothing is sent or filed until you approve each one/);

  const blocked = messageAttachmentDecision({
    documentCaseId: "case-1",
    messageCaseId: "case-2",
    uploadedBy: "parent-a",
    senderId: "parent-a",
    visibility: "parents_only",
    status: "pending",
    fileName: "Pediatrician listing.xlsx",
    recipientUserId: "parent-b",
    recipientRole: "parent",
    recipientOnCase: true,
  });
  assert.equal(blocked.link, false);
  const outsider = messageAttachmentDecision({
    documentCaseId: "case-1",
    messageCaseId: "case-1",
    uploadedBy: "parent-a",
    senderId: "parent-a",
    visibility: "parents_only",
    status: "pending",
    fileName: "Pediatrician listing.xlsx",
    recipientUserId: null,
    recipientRole: null,
    recipientOnCase: false,
  });
  assert.equal(outsider.link, false);
  assert.equal(outsider.fileName, "Pediatrician listing.xlsx");
  const privateFile = messageAttachmentDecision({
    documentCaseId: "case-1",
    messageCaseId: "case-1",
    uploadedBy: "parent-a",
    senderId: "parent-a",
    visibility: "private",
    status: "pending",
    fileName: "Pediatrician listing.xlsx",
    recipientUserId: "parent-b",
    recipientRole: "parent",
    recipientOnCase: true,
  });
  assert.equal(privateFile.link, false);
  const shared = messageAttachmentDecision({
    documentCaseId: "case-1",
    messageCaseId: "case-1",
    uploadedBy: "parent-a",
    senderId: "parent-a",
    visibility: "parents_only",
    status: "pending",
    fileName: "Pediatrician listing.xlsx",
    recipientUserId: "parent-b",
    recipientRole: "parent",
    recipientOnCase: true,
  });
  assert.equal(shared.link, true);
  assert.equal(shared.fileName, "Pediatrician listing.xlsx");

  console.log("attachment role tests passed");
}

main();
