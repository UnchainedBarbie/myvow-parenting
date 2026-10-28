import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import {
  buildIncomingContext,
  formatIncomingContext,
  type IncomingContext,
  type IncomingContextInput,
} from "@/lib/sage/incoming-context";
import {
  READING_SYSTEM_PROMPT,
  authorityLine,
  communicationBrief,
  composeBriefing,
  inboundNarration,
  normalizeReading,
  readIncomingCommunication,
  readingFromStorage,
  readingNeedsAttention,
} from "@/lib/sage/communication-reading";
import { performDocumentAnalysis, type AnalysisFile } from "@/lib/sage/document-analysis";
import { answerDocumentQuestion, type ReasonPacket } from "@/lib/sage/document-reason";
import { extractDocument } from "@/lib/documents/extract-document";

const SENDER = "parent-a";
const RECIPIENT = "parent-b";
const CASE = "case-1";
const MESSAGE_ID = "11111111-1111-4111-8111-111111111111";
const ORIGINAL = "we need to pick a new pediatrician for the children. can you review the list and provide feedback?";

function input(overrides: Partial<IncomingContextInput> = {}): IncomingContextInput {
  return {
    message: {
      id: MESSAGE_ID,
      case_id: CASE,
      conversation_id: "conv-1",
      sender_id: SENDER,
      direction: "incoming",
      original_content: ORIGINAL,
      created_at: "2026-10-23T15:00:00Z",
    },
    subject: "New doctor",
    recipientId: RECIPIENT,
    recipientRole: "parent",
    thread: [],
    documents: [
      {
        id: "doc-1",
        case_id: CASE,
        file_name: "Pediatrician listing.xlsx",
        mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        visibility: "parents_only",
        uploaded_by: RECIPIENT,
      },
    ],
    children: ["Ashley", "Avery"],
    authority: [],
    ...overrides,
  };
}

function context(overrides: Partial<IncomingContextInput> = {}): IncomingContext {
  const ctx = buildIncomingContext(input(overrides));
  assert.ok(ctx, "context builds for an incoming message");
  return ctx;
}

/** A model reply for the production message: a decision and a request for feedback on a file. */
const MULTI = JSON.stringify({
  intentions: [
    {
      kind: "decision_input",
      summary: "Co-Parent wants the two of you to choose a new doctor for the children.",
      asksRecipientTo: null,
      attachmentFileName: null,
    },
    {
      kind: "feedback_request",
      summary: "Co-Parent shared a list of options and wants your view on it.",
      asksRecipientTo: "review the list and share your feedback",
      attachmentFileName: "pediatrician listing.XLSX",
    },
  ],
  pendingDecisions: [{ topic: "choosing a new doctor for the children", participants: "both_parents", authorityCategory: "Medical" }],
  responseOptions: ["share your feedback on the list", "ask Co-Parent which practices they prefer"],
});

function spy(reply: string | Error) {
  const seen: { system: string; user: string }[] = [];
  return {
    seen,
    complete: async (system: string, user: string) => {
      seen.push({ system, user });
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
}

function sheet(): Buffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      ["Practice", "City", "Phone"],
      ["Alpha Pediatrics", "Denver", "303-555-0101"],
      ["Beta Clinic", "Aurora", "303-555-0102"],
    ]),
    "Options"
  );
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function incomingFile(overrides: Partial<AnalysisFile> = {}): AnalysisFile {
  return {
    id: "doc-1",
    fileName: "Pediatrician listing.xlsx",
    origin: "incoming",
    messageId: MESSAGE_ID,
    caseId: CASE,
    visibility: "parents_only",
    uploadedBy: RECIPIENT,
    status: "pending",
    linkedOnCase: true,
    ...overrides,
  };
}

async function main() {
  // Provenance: the packet is built from the recipient's side.
  {
    const ctx = context({
      thread: [
        { id: "m0", case_id: CASE, sender_id: SENDER, original_content: "Her checkup is due soon.", created_at: "2026-10-20T10:00:00Z" },
        { id: "m1", case_id: CASE, sender_id: RECIPIENT, original_content: "I can handle the paperwork.", created_at: "2026-10-21T10:00:00Z" },
        { id: MESSAGE_ID, case_id: CASE, sender_id: SENDER, original_content: ORIGINAL, created_at: "2026-10-23T15:00:00Z" },
        { id: "x", case_id: "other-case", sender_id: SENDER, original_content: "From another case", created_at: "2026-10-22T10:00:00Z" },
        { id: "blank", case_id: CASE, sender_id: SENDER, original_content: "  ", created_at: "2026-10-22T11:00:00Z" },
      ],
    });
    assert.equal(ctx.provenance.senderId, SENDER);
    assert.equal(ctx.provenance.recipientId, RECIPIENT);
    assert.equal(ctx.provenance.caseId, CASE);
    assert.equal(ctx.text, ORIGINAL, "the original words arrive intact");
    assert.deepEqual(
      ctx.history.map((turn) => [turn.from, turn.text]),
      [
        ["sender", "Her checkup is due soon."],
        ["recipient", "I can handle the paperwork."],
      ],
      "history is labelled from the recipient's side, without the message itself, other cases, or blanks"
    );
    assert.deepEqual(ctx.children, ["Ashley", "Avery"]);
  }

  // Perspective: the sender is not the recipient of their own message.
  assert.equal(buildIncomingContext(input({ recipientId: SENDER })), null);
  // A message sent from MyVow is one shared row stored as outgoing. It reaches the other parent.
  assert.ok(
    buildIncomingContext(input({ message: { ...input().message, direction: "outgoing" } })),
    "an in-app message from the other parent is incoming for the recipient"
  );
  assert.equal(
    buildIncomingContext(input({ message: { ...input().message, direction: "outgoing", sender_id: null } })),
    null,
    "an outgoing row with no sender cannot be attributed to a parent"
  );

  // Attachments: authorization, case, readability.
  {
    const ctx = context({
      documents: [
        { id: "a", case_id: CASE, file_name: "Pediatrician listing.xlsx", mime_type: null, visibility: "parents_only", uploaded_by: RECIPIENT },
        { id: "b", case_id: CASE, file_name: "Sender private note.pdf", mime_type: "application/pdf", visibility: "private", uploaded_by: SENDER },
        { id: "c", case_id: "other-case", file_name: "Other case.pdf", mime_type: "application/pdf", visibility: "family", uploaded_by: SENDER },
        { id: "d", case_id: CASE, file_name: "Old form.doc", mime_type: null, visibility: "family", uploaded_by: SENDER },
        { id: "a", case_id: CASE, file_name: "Pediatrician listing.xlsx", mime_type: null, visibility: "parents_only", uploaded_by: RECIPIENT },
      ],
    });
    assert.deepEqual(
      ctx.attachments.map((file) => [file.fileName, file.readable]),
      [
        ["Pediatrician listing.xlsx", true],
        ["Old form.doc", false],
      ],
      "private, cross-case, and duplicate files are left out; spreadsheets can be read on request"
    );
  }

  // Arrangement: unknown unless data exists.
  assert.equal(context().arrangement.status, "not_on_file");
  assert.equal(context({ authority: [{ category: "Medical", authority: "joint", notes: null }] }).arrangement.status, "on_file");

  // The model sees the exact message, the thread roles, files, and the arrangement state.
  {
    const ctx = context();
    const text = formatIncomingContext(ctx);
    assert.ok(text.includes(ORIGINAL));
    assert.ok(/recipient's co-parent/.test(text) && /RECIPIENT|Recipient/.test(text));
    assert.ok(text.includes("Pediatrician listing.xlsx"));
    assert.ok(/none on file\. Who decides is unknown/.test(text));
    assert.ok(/untrusted data/.test(text));
    assert.ok(text.includes("Ashley, Avery"));
  }

  // Reading: several intentions survive, attachment names are verified, authority is data-checked.
  {
    const fake = spy(MULTI);
    const ctx = context();
    const reading = await readIncomingCommunication(ctx, fake.complete);
    assert.ok(reading);
    assert.equal(fake.seen.length, 1);
    assert.equal(fake.seen[0].system, READING_SYSTEM_PROMPT);
    assert.ok(fake.seen[0].user.includes(ORIGINAL), "the model receives the exact message");
    assert.equal(reading.intentions.length, 2, "decision and feedback request stay separate");
    assert.deepEqual(reading.intentions.map((item) => item.kind), ["decision_input", "feedback_request"]);
    assert.equal(reading.intentions[1].attachmentFileName, "Pediatrician listing.xlsx");
    assert.equal(reading.pendingDecisions[0].participants, "both_parents");
    assert.deepEqual(
      reading.pendingDecisions[0].authority,
      { status: "not_established" },
      '"we" and a claimed category do not create authority when no arrangement is on file'
    );
    assert.deepEqual(Object.keys(reading).sort(), ["intentions", "pendingDecisions", "responseOptions"], "analysis only: no proposals or actions");
  }

  // Authority comes from the arrangement on file.
  {
    const joint = context({ authority: [{ category: "Medical", authority: "joint", notes: null }] });
    const jointReading = normalizeReading(MULTI, joint);
    assert.deepEqual(jointReading?.pendingDecisions[0].authority, { status: "confirmed_joint", category: "Medical" });
    assert.match(authorityLine(jointReading!.pendingDecisions[0], true), /lists medical as a joint decision/);

    const sole = context({ authority: [{ category: "medical", authority: "mother", notes: null }] });
    const soleReading = normalizeReading(MULTI, sole);
    assert.deepEqual(soleReading?.pendingDecisions[0].authority, { status: "arrangement_differs", category: "medical", listed: "mother" });
    assert.match(authorityLine(soleReading!.pendingDecisions[0], true), /check it before agreeing/);

    const other = context({ authority: [{ category: "Education", authority: "joint", notes: null }] });
    const otherReading = normalizeReading(MULTI, other);
    assert.deepEqual(otherReading?.pendingDecisions[0].authority, { status: "not_established" });
    assert.match(authorityLine(otherReading!.pendingDecisions[0], true), /lists no category/);

    const none = normalizeReading(MULTI, context());
    assert.match(authorityLine(none!.pendingDecisions[0], false), /No parenting arrangement is on file/);
  }

  // Normalization removes what the packet cannot support.
  {
    const ctx = context();
    const reading = normalizeReading(
      {
        intentions: [
          { kind: "made_up_kind", summary: "Co-Parent mentions a file.", asksRecipientTo: "", attachmentFileName: "invented.xlsx" },
          { kind: "question", summary: "   " },
          "nonsense",
        ],
        pendingDecisions: [{ topic: "", participants: "both_parents" }, { topic: "a topic", participants: "everyone" }],
        responseOptions: ["one", "", "two", "three", "four", "five"],
      },
      ctx
    );
    assert.ok(reading);
    assert.equal(reading.intentions.length, 1);
    assert.equal(reading.intentions[0].kind, "other");
    assert.equal(reading.intentions[0].attachmentFileName, null, "a file the message did not carry is dropped");
    assert.equal(reading.intentions[0].asksRecipientTo, null);
    assert.equal(reading.pendingDecisions.length, 1);
    assert.equal(reading.pendingDecisions[0].participants, "unclear");
    assert.equal(reading.responseOptions.length, 4);
    assert.equal(normalizeReading({ intentions: [] }, ctx), null);
    assert.equal(normalizeReading("not json", ctx), null);
    assert.equal(normalizeReading(null, ctx), null);
  }

  // The briefing keeps the sender's request apart, names the open decision, and leaves the file closed.
  {
    const ctx = context();
    const reading = normalizeReading(MULTI, ctx)!;
    const briefing = composeBriefing(reading, ctx);
    assert.match(briefing, /Co-Parent wants the two of you to choose a new doctor/);
    assert.match(briefing, /Co-Parent is asking you to review the list and share your feedback\./);
    assert.match(briefing, /Open decision: choosing a new doctor for the children\./);
    assert.match(briefing, /inviting you to decide it together/);
    assert.match(briefing, /No parenting arrangement is on file/);
    assert.match(briefing, /Pediatrician listing\.xlsx came with it\. I have not opened it yet\./);
    assert.match(briefing, /Ways to respond: share your feedback on the list; ask Co-Parent which practices they prefer\./);
    assert.match(briefing, /Nothing has been decided, sent, or saved\.$/);
    assert.ok(!/303-555|Row \d|Alpha|Beta/.test(briefing), "the briefing carries no spreadsheet contents");
    assert.ok(!/\byou (asked|want)\b/i.test(briefing), "the sender's request is never phrased as the recipient's own");

    const unreadable = context({
      documents: [{ id: "d", case_id: CASE, file_name: "Old form.doc", mime_type: null, visibility: "family", uploaded_by: SENDER }],
    });
    assert.match(composeBriefing(normalizeReading(MULTI, unreadable)!, unreadable), /Old form\.doc came with it and is saved\. I cannot read this file type\./);
  }

  // Attention and narration follow the reading; a failed reading keeps the existing line.
  {
    const ctx = context();
    const reading = normalizeReading(MULTI, ctx)!;
    assert.equal(readingNeedsAttention(reading), true);
    assert.equal(
      readingNeedsAttention(
        normalizeReading({ intentions: [{ kind: "information_share", summary: "Co-Parent says the visit went well." }] }, ctx)
      ),
      false
    );
    assert.equal(readingNeedsAttention(null), false);
    const withReply = inboundNarration({ reading, ctx, replyReady: true, fallback: "fallback" });
    assert.match(withReply, /A reply is ready for you to review\.$/);
    assert.equal(inboundNarration({ reading: null, ctx, replyReady: true, fallback: "fallback" }), "fallback");
    assert.equal(inboundNarration({ reading, ctx: null, replyReady: false, fallback: "fallback" }), "fallback");
    for (const reply of [new Error("down"), "not json", JSON.stringify({ intentions: [] })]) {
      assert.equal(await readIncomingCommunication(ctx, spy(reply).complete), null);
    }
  }

  // A stored reading is re-checked against today's attachments and arrangement.
  {
    const joint = context({ authority: [{ category: "Medical", authority: "joint", notes: null }] });
    const stored = normalizeReading(MULTI, joint)!;
    assert.equal(readingFromStorage(stored, joint)?.pendingDecisions[0].authority.status, "confirmed_joint");
    assert.equal(
      readingFromStorage(stored, context())?.pendingDecisions[0].authority.status,
      "not_established",
      "an arrangement that changed no longer confirms the stored claim"
    );
    assert.equal(readingFromStorage(null, joint), null);
  }

  // Document analysis: the co-parent's request travels with the file and stays apart from the parent's question.
  {
    const ctx = context();
    const brief = communicationBrief(ctx, normalizeReading(MULTI, ctx));
    assert.ok(brief.block.includes(ORIGINAL));
    assert.match(brief.block, /their request, not the parent's own/);
    assert.equal(brief.asks, "review the list and share your feedback");

    const packets: ReasonPacket[] = [];
    const reads = { n: 0 };
    const own = "what do you think of the list?";
    const reply = await performDocumentAnalysis({
      message: own,
      files: [incomingFile({ loadBrief: async () => brief })],
      viewer: { userId: RECIPIENT, role: "parent" },
      caseId: CASE,
      loadBytes: async () => {
        reads.n += 1;
        return sheet();
      },
      reason: async (packet) => {
        packets.push(packet);
        return null;
      },
    });
    assert.ok(reply);
    assert.equal(packets.length, 1);
    assert.equal(packets[0].question, own, "the parent's own question is not replaced by the sender's message");
    assert.equal(packets[0].communication?.block, brief.block);
    assert.match(reply.reply, /^Pediatrician listing\.xlsx came with Co-Parent's request that you review the list and share your feedback\./);
    assert.match(reply.reply, /Nothing is decided by this answer\./);
    assert.ok(!/303-555/.test(reply.reply), "contact details are not dumped");

    // Without a message behind the file, the earlier behavior stays.
    const plain = await performDocumentAnalysis({
      message: own,
      files: [incomingFile()],
      viewer: { userId: RECIPIENT, role: "parent" },
      caseId: CASE,
      loadBytes: async () => sheet(),
    });
    assert.ok(plain && !/came with/.test(plain.reply));

    // A brief that fails to load leaves the answer in its earlier form.
    const failed = await performDocumentAnalysis({
      message: own,
      files: [incomingFile({ loadBrief: async () => { throw new Error("down"); } })],
      viewer: { userId: RECIPIENT, role: "parent" },
      caseId: CASE,
      loadBytes: async () => sheet(),
    });
    assert.ok(failed && !/came with/.test(failed.reply));

    // Access still decides whether the file is read at all.
    const denied = await performDocumentAnalysis({
      message: own,
      files: [incomingFile({ loadBrief: async () => brief, visibility: "private", uploadedBy: SENDER })],
      viewer: { userId: RECIPIENT, role: "parent" },
      caseId: CASE,
      loadBytes: async () => {
        reads.n += 1;
        return sheet();
      },
    });
    assert.match(denied?.reply ?? "", /don't have access/);
    assert.equal(reads.n, 1, "a denied file is never opened");
  }

  // Names the co-parent's message supplies count as grounded for the model's framing.
  {
    const extracted = await extractDocument(sheet(), "Pediatrician listing.xlsx", {});
    const framed = "Ashley Rivera needs a doctor soon, so the open question is which practice to pick.";
    const briefWithName = { block: "Co-parent's message: Ashley Rivera needs a doctor.", asks: null };
    const accepted = await answerDocumentQuestion({
      question: "what do you think?",
      fileName: "Pediatrician listing.xlsx",
      extracted,
      reason: async () => framed,
      communication: briefWithName,
    });
    assert.ok(accepted.includes(framed));
    const withoutContext = await answerDocumentQuestion({
      question: "what do you think?",
      fileName: "Pediatrician listing.xlsx",
      extracted,
      reason: async () => framed,
    });
    assert.ok(!withoutContext.includes(framed), "a name found only in the message still needs the message to ground it");
  }

  // The interpretation layer holds no topic or phrase rules.
  for (const path of ["lib/sage/communication-reading.ts", "lib/sage/incoming-context.ts"]) {
    const source = readFileSync(path, "utf8");
    assert.ok(!/pediatric/i.test(source), `${path} names no topic`);
    assert.ok(!/review the list/i.test(source), `${path} matches no phrase`);
    assert.ok(!/\\bwe\\b|\\bour\\b/.test(source), `${path} tests no pronoun`);
  }

  console.log("communication reading tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
