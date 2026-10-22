import assert from "node:assert/strict";
import { documentFileProblem } from "@/lib/documents-files";
import { buildDocumentReviewRow } from "@/components/sage/proposal-helpers";
import type { SageItem, SageProposal } from "@/components/sage/proposal-types";
import { deriveOpenItems } from "@/lib/open-items";
import { routeChatIntent } from "@/lib/sage/chat-intent";
import { isSupersededProposal } from "@/lib/sage/proposal-lifecycle";
import type { ConversationContext } from "@/lib/sage/conversation-context";
import {
  answerDocumentQuestion,
  splitDocumentAnswer,
} from "@/lib/sage/document-search";
import { documentAuthorizedForViewer } from "@/lib/documents-tab";
import {
  applyDocumentTurn,
  applyRevisionToProposals,
  attachmentFilingText,
  attachmentRouteKind,
  interpretDocumentTurn,
  type DocumentProposalState,
  type DocumentThread,
} from "@/lib/sage/document-intent";
import { processChatAttachment } from "@/lib/sage/process-chat-attachment";

const today = new Date("2026-10-21T18:00:00Z");
const timezone = "America/Denver";
const children = [
  { id: "child-ashley", name: "Ashley" },
  { id: "child-avery", name: "Avery" },
];
const sentence = "This is Ashley's occupational therapy evaluation. Save it to her medical documents.";
const empty: DocumentThread = { pending: null, filed: null };

function proposalOf(state: DocumentProposalState): SageProposal {
  return {
    type: "log_document",
    draft: `File “${state.title}”. ${state.description}`,
    depends_on: null,
    requires_approval: state.requiresApproval,
    title: state.title,
    description: state.description,
    category: state.category,
    visibility: state.visibility,
    key: state.key,
    document_child_id: state.childId,
    document_child_name: state.childName,
    attached_document_id: state.documentId,
    attached_file_name: state.fileName,
  };
}

async function main() {
  const described = applyDocumentTurn(empty, { text: sentence }, children, today, timezone);
  assert.equal(described.error, null);
  assert.equal(described.calendar, false);
  assert.equal(described.open.length, 1);
  const pending = described.thread.pending;
  assert.ok(pending);
  assert.equal(pending.childId, "child-ashley");
  assert.equal(pending.category, "therapy");
  assert.equal(pending.title, "Ashley — Occupational Therapy Evaluation");
  assert.equal(pending.description, "Occupational therapy evaluation for Ashley");
  assert.equal(pending.visibility, "parents_only");
  assert.equal(pending.requiresApproval, true);
  assert.equal(pending.updatesExisting, false);

  const withFile = applyDocumentTurn(
    described.thread,
    {
      fileName: "ashley ot evaluation.png",
      fileMime: "image/png",
      fileSize: 1200,
      incomingDocumentId: "doc-1",
    },
    children,
    today,
    timezone
  );
  assert.equal(withFile.open.length, 1);
  assert.equal(withFile.thread.pending?.key, pending.key);
  assert.equal(withFile.thread.pending?.title, pending.title);
  assert.equal(withFile.thread.pending?.description, pending.description);
  assert.equal(withFile.thread.pending?.childId, "child-ashley");
  assert.equal(withFile.thread.pending?.category, "therapy");
  assert.equal(withFile.thread.pending?.fileName, "ashley ot evaluation.png");
  assert.equal(withFile.thread.pending?.documentId, "doc-1");
  assert.equal(withFile.calendar, false);

  const fileFirst = applyDocumentTurn(
    empty,
    { fileName: "ashley ot evaluation.png", fileMime: "image/png", fileSize: 800, incomingDocumentId: "doc-2" },
    children,
    today,
    timezone
  );
  assert.equal(fileFirst.thread.pending?.title, "Ashley — Occupational Therapy Evaluation");
  assert.equal(fileFirst.thread.pending?.category, "therapy");
  assert.equal(fileFirst.thread.pending?.childId, "child-ashley");
  const describedAfter = applyDocumentTurn(
    fileFirst.thread,
    { text: sentence },
    children,
    today,
    timezone
  );
  assert.equal(describedAfter.open.length, 1);
  assert.equal(describedAfter.thread.pending?.key, fileFirst.thread.pending?.key);
  assert.equal(describedAfter.thread.pending?.documentId, "doc-2");
  assert.equal(describedAfter.thread.pending?.description, "Occupational therapy evaluation for Ashley");

  const blocked = applyDocumentTurn(
    described.thread,
    { text: sentence, fileName: "notes.xlsx", fileMime: "application/vnd.ms-excel", fileSize: 400 },
    children,
    today,
    timezone
  );
  assert.match(blocked.error ?? "", /isn't supported/);
  assert.equal(blocked.thread.pending?.key, pending.key);
  assert.equal(blocked.thread.pending?.fileName, null);
  assert.equal(documentFileProblem("notes.xlsx", "", 400)?.includes("replacement"), true);

  const replaced = applyDocumentTurn(
    withFile.thread,
    { fileName: "ashley-ot.docx", fileMime: "", fileSize: 5000, incomingDocumentId: "doc-3" },
    children,
    today,
    timezone
  );
  assert.equal(replaced.error, null);
  assert.equal(replaced.thread.pending?.key, withFile.thread.pending?.key);
  assert.equal(replaced.thread.pending?.fileName, "ashley-ot.docx");
  assert.equal(replaced.thread.pending?.documentId, "doc-3");
  assert.equal(replaced.thread.pending?.title, pending.title);
  assert.equal(replaced.thread.pending?.visibility, "parents_only");
  assert.equal(documentFileProblem("ashley-ot.docx", "", 5000), null);

  assert.equal(
    attachmentRouteKind({
      caption: sentence,
      fileName: "ashley ot evaluation.png",
      classifyType: "event",
      pendingDocument: true,
    }),
    "document"
  );
  const attached = await processChatAttachment({
    caseId: "case-1",
    timezone,
    caption: sentence,
    classify: {
      type: "event",
      confidence: 0.8,
      title: "ashley ot evaluation.png",
      description: "",
      category: "other",
      child_names: [],
      date: "2026-10-15",
      amount: null,
      vendor: null,
      start_time: null,
      end_time: null,
      location: null,
      is_all_day: false,
    },
    attachment: {
      document_id: "doc-1",
      file_name: "ashley ot evaluation.png",
      url: "/api/documents/doc-1/download",
    },
    children,
    today,
  });
  assert.equal(attached.kind, "document");
  assert.equal(attached.result?.plan.proposals.some((p) => p.type === "calendar_update"), false);
  const filedProposal = attached.result?.plan.proposals[0];
  assert.equal(filedProposal?.type, "log_document");
  assert.equal(filedProposal?.title, "Ashley — Occupational Therapy Evaluation");
  assert.equal(filedProposal?.category, "therapy");
  assert.equal(filedProposal?.visibility, "parents_only");
  assert.equal(filedProposal?.document_child_id, "child-ashley");
  assert.equal(attached.result?.child_ids[0], "child-ashley");

  const routed = routeChatIntent({
    message: sentence,
    children,
    timezone,
    today,
  });
  assert.deepEqual(
    routed.result.plan.proposals.map((p) => p.type),
    ["log_document"]
  );
  assert.equal(routed.result.plan.proposals[0]?.title, "Ashley — Occupational Therapy Evaluation");
  assert.equal(routed.result.child_ids[0], "child-ashley");
  assert.equal(routed.result.resolved_dates.length, 0);

  const appointment = routeChatIntent({
    message: "Add Ashley's therapy appointment Friday at 4 PM.",
    children,
    timezone,
    today,
  });
  assert.equal(appointment.result.plan.proposals.some((p) => p.type === "calendar_update"), true);
  assert.equal(appointment.result.plan.proposals.some((p) => p.type === "log_document"), false);

  const saved = withFile.thread.pending;
  assert.ok(saved);
  const item: SageItem = {
    id: "item-1",
    item_type: "document",
    domain: "general",
    summary: saved.title,
    evidence_excerpt: sentence,
    urgency: "normal",
    action_required: true,
    child_ids: [saved.childId ?? ""],
    tool_input: {},
    plan: { proposals: [proposalOf(saved)] },
    status: "pending",
    created_at: "2026-10-21T18:00:00Z",
  };
  const row = buildDocumentReviewRow(item, proposalOf(saved));
  assert.ok(row);
  assert.equal(row.title, "Ashley — Occupational Therapy Evaluation");
  assert.equal(row.description, "Occupational therapy evaluation for Ashley");
  assert.equal(row.category, "therapy");
  assert.equal(row.child_id, "child-ashley");
  assert.equal(row.visibility, "parents_only");
  assert.equal(row.file_name, "ashley ot evaluation.png");
  assert.notEqual(row.visibility, "family");

  const context: ConversationContext = {
    thread_subject: null,
    event: { subject: null, child: null, date: null, time: null, eventId: null },
    open_proposals: [
      {
        type: "log_document",
        text: saved.description,
        document: { ...saved, requiresApproval: true },
      },
    ],
  };
  const followUpText = "This evaluation was completed on October 15. Please include that in the description.";
  const follow = routeChatIntent({
    message: followUpText,
    conversation: context,
    children,
    timezone,
    today,
  });
  assert.equal(follow.handled, true);
  assert.equal(follow.control, "revise_document");
  assert.notEqual(follow.reply, "Got it — noted.");
  assert.equal(follow.result.plan.proposals.some((p) => p.type === "note_only"), false);
  assert.equal(follow.result.plan.proposals.some((p) => p.type === "log_document"), false);
  const revision = follow.revision?.document;
  assert.ok(revision);
  assert.match(revision.description, /Completed October 15, 2026\./);
  assert.equal(revision.key, saved.key);
  assert.equal(revision.documentId, "doc-1");
  assert.equal(revision.childId, "child-ashley");
  assert.equal(revision.category, "therapy");
  assert.equal(revision.visibility, "parents_only");
  assert.equal(revision.fileName, "ashley ot evaluation.png");
  const updated = applyRevisionToProposals([proposalOf(saved)], revision);
  assert.equal(updated.changed, true);
  assert.equal(updated.proposals.length, 2);
  const previous = updated.proposals[0] as SageProposal;
  const kept = updated.proposals[1] as SageProposal;
  assert.equal(isSupersededProposal(previous), true);
  assert.equal(isSupersededProposal(kept), false);
  assert.equal(kept.attached_document_id, "doc-1");
  assert.equal(kept.attached_file_name, "ashley ot evaluation.png");
  assert.equal(kept.document_child_id, "child-ashley");
  assert.equal(kept.category, "therapy");
  assert.equal(kept.visibility, "parents_only");
  assert.match(String(kept.description), /Completed October 15, 2026\./);
  const reviewed = buildDocumentReviewRow(item, kept);
  assert.equal(reviewed?.description, kept.description);
  assert.equal(reviewed?.child_id, "child-ashley");
  assert.equal(reviewed?.visibility, "parents_only");
  assert.equal(reviewed?.file_name, "ashley ot evaluation.png");

  const open = deriveOpenItems([
    {
      id: "item-1",
      created_at: "2026-10-21T18:00:00Z",
      status: "pending",
      plan: { proposals: updated.proposals },
    },
  ]);
  assert.equal(open.length, 1);
  assert.equal(open[0]?.type, "document");
  assert.match(open[0]?.title ?? "", /Occupational Therapy Evaluation/);
  assert.equal(open.some((entry) => entry.kind === "missing_information"), false);

  const textOnly: ConversationContext = {
    thread_subject: null,
    event: { subject: null, child: null, date: null, time: null, eventId: null },
    open_proposals: [{ type: "log_document", text: `File “${saved.title}”. ${saved.description}` }],
  };
  const fromText = routeChatIntent({
    message: followUpText,
    conversation: textOnly,
    children,
    timezone,
    today,
  });
  assert.equal(fromText.control, "revise_document");
  assert.match(fromText.revision?.document?.description ?? "", /Completed October 15, 2026\./);
  assert.equal(fromText.result.plan.proposals.some((p) => p.type === "note_only"), false);

  const noDate = routeChatIntent({
    message: "Please update the description.",
    conversation: context,
    children,
    timezone,
    today,
  });
  assert.equal(noDate.control, "revise_document");
  assert.equal(noDate.revision?.document?.description, saved.description);
  assert.doesNotMatch(noDate.revision?.document?.description ?? "", /Completed/);

  const other: DocumentProposalState = {
    ...saved,
    key: "other-document",
    title: "Avery — Speech Therapy Evaluation",
    description: "Speech therapy evaluation for Avery",
    category: "therapy",
    childId: "child-avery",
    childName: "Avery",
    documentId: "doc-9",
    fileName: "avery evaluation.pdf",
  };
  const ambiguous = routeChatIntent({
    message: "Please include that in the description.",
    conversation: {
      ...context,
      open_proposals: [
        context.open_proposals[0],
        { type: "log_document", text: other.description, document: other },
      ],
    },
    children,
    timezone,
    today,
  });
  assert.equal(ambiguous.control, "none");
  assert.equal(ambiguous.result.plan.proposals[0]?.type, "ask_clarification");
  assert.match(ambiguous.reply, /Which document/);
  assert.equal(ambiguous.result.plan.proposals.some((p) => p.type === "note_only"), false);
  assert.equal(ambiguous.result.plan.proposals.some((p) => p.type === "log_document"), false);

  const filedUpdate = interpretDocumentTurn({
    text: "This evaluation was completed October 15. Include that in the description.",
    children,
    pending: null,
    filed: saved,
    today,
    timezone,
  });
  assert.equal(filedUpdate.action, "create");
  if (filedUpdate.action === "create") {
    assert.equal(filedUpdate.proposal.updatesExisting, true);
    assert.equal(filedUpdate.proposal.documentId, saved.documentId);
    assert.equal(filedUpdate.proposal.fileName, saved.fileName);
    assert.notEqual(filedUpdate.proposal.key, saved.key);
    assert.equal(filedUpdate.proposal.requiresApproval, true);
    assert.match(filedUpdate.proposal.description, /Completed October 15, 2026\./);
  }

  const filedRoute = routeChatIntent({
    message: followUpText,
    conversation: {
      thread_subject: null,
      event: { subject: null, child: null, date: null, time: null, eventId: null },
      open_proposals: [],
      recent_document: saved,
    },
    children,
    timezone,
    today,
  });
  assert.equal(filedRoute.handled, true);
  assert.equal(filedRoute.control, "none");
  assert.equal(filedRoute.result.plan.proposals.length, 1);
  const filedEdit = filedRoute.result.plan.proposals[0];
  assert.equal(filedEdit?.type, "log_document");
  assert.equal(filedEdit?.requires_approval, true);
  assert.equal(filedEdit?.updatesExisting, true);
  assert.equal(filedEdit?.attached_document_id, "doc-1");
  assert.equal(filedEdit?.attached_file_name, "ashley ot evaluation.png");
  assert.equal(filedEdit?.document_child_id, "child-ashley");
  assert.equal(filedEdit?.visibility, "parents_only");
  assert.match(filedEdit?.description ?? "", /Completed October 15, 2026\./);
  const filedOpen = deriveOpenItems([
    {
      id: "filed-item",
      created_at: "2026-10-21T18:00:00Z",
      status: "pending",
      plan: { proposals: [{ ...proposalOf(saved), executed: true }] },
    },
    {
      id: "update-item",
      created_at: "2026-10-21T19:00:00Z",
      status: "pending",
      plan: { proposals: [filedEdit] },
    },
  ]);
  assert.equal(filedOpen.length, 1);
  assert.equal(filedOpen[0]?.type, "document");
  assert.equal(filedOpen[0]?.sageItemId, "update-item");

  const thinItem: SageItem = {
    ...item,
    child_ids: [],
    plan: { proposals: [] },
  };
  const thinProposal: SageProposal = {
    type: "log_document",
    draft: "File “ashley ot evaluation.png” in your documents.",
    depends_on: null,
    requires_approval: true,
    title: "ashley ot evaluation.png",
    description: "",
    category: "other",
    attached_document_id: "doc-1",
    attached_file_name: "ashley ot evaluation.png",
  };
  const repaired = buildDocumentReviewRow(thinItem, thinProposal, children);
  assert.ok(repaired);
  assert.equal(repaired.title, "Ashley — Occupational Therapy Evaluation");
  assert.equal(repaired.description, "Occupational therapy evaluation for Ashley");
  assert.equal(repaired.category, "therapy");
  assert.equal(repaired.child_id, "child-ashley");
  assert.equal(repaired.visibility, "parents_only");
  assert.equal(repaired.file_name, "ashley ot evaluation.png");

  const fileAfterSentence = await processChatAttachment({
    caseId: "case-1",
    timezone,
    caption: "",
    priorText: sentence,
    classify: {
      type: "event",
      confidence: 0.9,
      title: "ashley ot evaluation.png",
      description: "",
      category: "other",
      child_names: [],
      date: "2026-10-15",
      amount: null,
      vendor: null,
      start_time: null,
      end_time: null,
      location: null,
      is_all_day: false,
    },
    attachment: {
      document_id: "doc-1",
      file_name: "ashley ot evaluation.png",
      url: "/api/documents/doc-1/download",
    },
    children,
    today,
  });
  assert.equal(fileAfterSentence.kind, "document");
  assert.equal(fileAfterSentence.revisesExisting, false);
  assert.equal(fileAfterSentence.result?.plan.proposals.length, 1);
  assert.equal(fileAfterSentence.result?.plan.proposals[0]?.title, "Ashley — Occupational Therapy Evaluation");
  assert.equal(fileAfterSentence.result?.plan.proposals[0]?.document_child_id, "child-ashley");
  assert.equal(fileAfterSentence.result?.plan.proposals[0]?.category, "therapy");
  assert.equal(fileAfterSentence.result?.plan.proposals.some((p) => p.type === "calendar_update"), false);
  assert.equal(fileAfterSentence.result?.plan.proposals.some((p) => p.type === "note_only"), false);

  const fileOntoPending = await processChatAttachment({
    caseId: "case-1",
    timezone,
    caption: "",
    priorText: sentence,
    classify: {
      type: "document",
      confidence: 0.4,
      title: "ashley ot evaluation.png",
      description: "",
      category: "other",
      child_names: [],
      date: null,
      amount: null,
      vendor: null,
      start_time: null,
      end_time: null,
      location: null,
      is_all_day: false,
    },
    attachment: {
      document_id: "doc-1",
      file_name: "ashley ot evaluation.png",
      url: "/api/documents/doc-1/download",
    },
    children,
    pendingDocument: saved,
    today,
  });
  assert.equal(fileOntoPending.kind, "document");
  assert.equal(fileOntoPending.revisesExisting, true);
  assert.equal(fileOntoPending.result?.plan.proposals.length, 1);
  assert.equal(fileOntoPending.result?.plan.proposals[0]?.attached_document_id, "doc-1");
  assert.equal(fileOntoPending.result?.plan.proposals[0]?.title, saved?.title);
  assert.equal(attachmentFilingText("", sentence, true), "");
  assert.equal(attachmentFilingText("", sentence, false), sentence);

  const savedDoc = {
    id: "doc-1",
    title: "Ashley — Occupational Therapy Evaluation",
    description: "Occupational therapy evaluation for Ashley",
    category: "therapy",
    fileName: "ashley ot evaluation.png",
    childIds: ["child-ashley"],
    createdAt: "2026-10-16T18:00:00Z",
    visibility: "parents_only",
    uploadedBy: "parent-1",
  };
  const privateDoc = {
    ...savedDoc,
    id: "doc-private",
    title: "Ashley — Private Therapy Evaluation",
    visibility: "private",
    uploadedBy: "other-parent",
  };
  const schoolDoc = {
    id: "doc-school",
    title: "Avery — School Evaluation",
    description: "School evaluation for Avery",
    category: "school",
    fileName: "avery school evaluation.pdf",
    childIds: ["child-avery"],
    createdAt: "2026-10-20T18:00:00Z",
    visibility: "parents_only",
    uploadedBy: "parent-1",
  };
  const oldDoc = {
    ...savedDoc,
    id: "doc-old",
    title: "Ashley — Occupational Therapy Evaluation",
    createdAt: "2026-09-01T18:00:00Z",
  };
  const viewer = { userId: "parent-1", role: "parent" };
  assert.equal(
    documentAuthorizedForViewer(
      { visibility: privateDoc.visibility, uploadedBy: privateDoc.uploadedBy },
      viewer
    ),
    false
  );
  const visible = [savedDoc, privateDoc, schoolDoc, oldDoc].filter((doc) =>
    documentAuthorizedForViewer({ visibility: doc.visibility, uploadedBy: doc.uploadedBy }, viewer)
  );
  assert.equal(visible.some((doc) => doc.id === "doc-private"), false);

  const found = answerDocumentQuestion({
    message: "Find Ashley's most recent occupational therapy evaluation.",
    documents: visible,
    children,
    today,
    timezone,
    viewer,
  });
  assert.ok(found);
  assert.match(found, /Ashley — Occupational Therapy Evaluation/);
  assert.match(found, /\[\[doc:doc-1\|/);
  assert.doesNotMatch(found, /doc-private|doc-old|doc-school/);
  const foundParts = splitDocumentAnswer(found);
  assert.equal(foundParts.links[0]?.id, "doc-1");
  assert.equal(foundParts.text.includes("[[doc:"), false);

  const medical = answerDocumentQuestion({
    message: "Show me Ashley's medical records.",
    documents: visible,
    children,
    today,
    timezone,
    viewer,
  });
  assert.ok(medical);
  assert.match(medical, /Ashley — Occupational Therapy Evaluation/);
  assert.doesNotMatch(medical, /Avery/);

  const school = answerDocumentQuestion({
    message: "Where is Avery's school evaluation?",
    documents: visible,
    children,
    today,
    timezone,
    viewer,
  });
  assert.ok(school);
  assert.match(school, /\[\[doc:doc-school\|/);
  assert.doesNotMatch(school, /Ashley/);

  const lastWeek = answerDocumentQuestion({
    message: "Find the OT report I uploaded last week.",
    documents: visible,
    children,
    today,
    timezone,
    viewer,
  });
  assert.ok(lastWeek);
  assert.match(lastWeek, /\[\[doc:doc-1\|/);
  assert.doesNotMatch(lastWeek, /doc-old/);

  const none = answerDocumentQuestion({
    message: "Find Avery's occupational therapy evaluation.",
    documents: visible,
    children,
    today,
    timezone,
    viewer,
  });
  assert.equal(none, "I couldn't find a saved document that matches that.");
  assert.equal(splitDocumentAnswer(none ?? "").links.length, 0);

  const search = routeChatIntent({
    message: "Find Ashley's most recent occupational therapy evaluation.",
    children,
    documents: visible,
    viewerId: "parent-1",
    viewerRole: "parent",
    timezone,
    today,
  });
  assert.equal(search.handled, true);
  assert.equal(search.result.plan.status, "no_action");
  assert.equal(search.result.plan.proposals.length, 0);
  assert.equal(search.result.plan.proposals.some((p) => p.type === "note_only"), false);
  assert.notEqual(search.reply, "Got it — noted.");
  assert.match(search.reply, /\[\[doc:doc-1\|/);
  const searchItems = deriveOpenItems([
    {
      id: "search-item",
      created_at: "2026-10-21T18:00:00Z",
      status: "pending",
      plan: search.result.plan,
    },
  ]);
  assert.equal(searchItems.length, 0);

  const missing = routeChatIntent({
    message: "Find Avery's occupational therapy evaluation.",
    children,
    documents: visible,
    viewerId: "parent-1",
    viewerRole: "parent",
    timezone,
    today,
  });
  assert.equal(missing.handled, true);
  assert.equal(missing.result.plan.proposals.length, 0);
  assert.match(missing.reply, /couldn't find/i);
  assert.notEqual(missing.reply, "Got it — noted.");

  const savedEdit = routeChatIntent({
    message: followUpText,
    documents: [savedDoc],
    children,
    timezone,
    today,
  });
  assert.equal(savedEdit.handled, true);
  assert.equal(savedEdit.result.plan.proposals.length, 1);
  assert.equal(savedEdit.result.plan.proposals[0]?.type, "log_document");
  assert.equal(savedEdit.result.plan.proposals[0]?.updatesExisting, true);
  assert.equal(savedEdit.result.plan.proposals[0]?.attached_document_id, "doc-1");
  assert.equal(savedEdit.result.plan.proposals[0]?.requires_approval, true);
  assert.match(savedEdit.result.plan.proposals[0]?.description ?? "", /Completed October 15, 2026\./);
  assert.equal(savedEdit.result.plan.proposals.some((p) => p.type === "note_only"), false);

  const orphanEdit = routeChatIntent({
    message: followUpText,
    children,
    timezone,
    today,
  });
  assert.equal(orphanEdit.handled, true);
  assert.equal(orphanEdit.result.plan.proposals.length, 0);
  assert.notEqual(orphanEdit.reply, "Got it — noted.");

  console.log("document intent tests passed");
}

void main();
