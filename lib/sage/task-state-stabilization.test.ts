import assert from "node:assert/strict";
import { FakeDb } from "@/lib/messages/fake-admin";
import { chooseActiveCase, resolveActiveCase } from "@/lib/cases/resolve-active-case";
import { processChatMessage } from "@/lib/sage/chat";
import { routeChatIntent, type KnownCoparent } from "@/lib/sage/chat-intent";
import {
  closeAnsweredQuestions,
  openParentQuestions,
  reopenOwnQuestions,
  repeatsOpenQuestion,
  resolveOwnQuestions,
  turnRepeatsOpenQuestions,
} from "@/lib/sage/clarification-lifecycle";
import { formatConversationContext, loadConversationContext } from "@/lib/sage/conversation-context";
import type { ConversationModel } from "@/lib/sage/conversation-reply";
import { loadLatestOpenDocument, reviseLatestOpenDocument } from "@/lib/sage/document-records";
import {
  latestRevisableDraft,
  openReplyProposal,
  revisePendingDraft,
  type RevisableDraft,
  type Redrafter,
} from "@/lib/sage/open-drafts";
import { isLiveProposal, proposalState } from "@/lib/sage/proposal-lifecycle";
import { isResolvedProposal } from "@/lib/sage/proposal-resolution";
import { loadSessionItems } from "@/lib/sage/session-items";
import { deriveWorkingMemory } from "@/lib/sage/working-memory";

/**
 * The dentist-session failure, reproduced against an in-memory database.
 *
 * The model is a test double that answers honestly about the parent's message. Nothing here reads
 * the words of a message to decide a result: the product code is given the same context the
 * production route gives it, and the assertions check what it saves and what it leaves alone.
 */

const PARENT = "parent-ashley";
const OTHER_PARENT = "parent-kevin";
const SESSION = "session-dentist";
const OTHER_SESSION = "session-other";
const CASE = "case-1";
const TODAY = new Date("2026-10-28T18:00:00Z");
const kevin: KnownCoparent = { name: "Kevin", email: "kevin@example.com" };

type Admin = Parameters<typeof closeAnsweredQuestions>[0];

function asAdmin(db: FakeDb): Admin {
  return db as unknown as Admin;
}

const ASK_EXPENSE = "What was the amount of this expense?";

function dentistDb(): FakeDb {
  const db = new FakeDb();
  db.seed("sage_sessions", [
    { id: SESSION, user_id: PARENT, title: "Dentist" },
    { id: OTHER_SESSION, user_id: PARENT, title: "School" },
  ]);
  db.seed("sage_items", [
    {
      id: "item-cal",
      case_id: CASE,
      visible_to: PARENT,
      source_type: "chat",
      item_type: "calendar_event",
      summary: "Ashley dentist, Friday 3 PM",
      created_at: "2026-10-28T10:00:00.000Z",
      plan: {
        status: "ready",
        proposals: [
          {
            id: "cal-1",
            type: "calendar_update",
            draft: "Add to calendar: Ashley dentist, Friday at 3:00 PM.",
            title: "Ashley dentist",
            approved: true,
            executed: true,
            status: "executed",
            result_event_id: "event-1",
          },
        ],
      },
    },
    {
      id: "item-exp",
      case_id: CASE,
      visible_to: PARENT,
      source_type: "chat",
      item_type: "expense",
      summary: "Dentist expense",
      created_at: "2026-10-28T11:00:00.000Z",
      plan: {
        status: "ready",
        proposals: [
          {
            id: "ask-exp",
            type: "ask_clarification",
            draft: ASK_EXPENSE,
            audience: "parent",
            clarifies: "expense",
            depends_on: "amount",
            requires_approval: true,
          },
        ],
      },
    },
    {
      id: "item-doc",
      case_id: CASE,
      visible_to: PARENT,
      source_type: "chat",
      item_type: "document",
      summary: "Dental records",
      created_at: "2026-10-28T11:30:00.000Z",
      plan: {
        status: "ready",
        proposals: [
          {
            id: "doc-1",
            type: "log_document",
            draft: "File “Dental records”.",
            title: "Dental records",
            attached_document_id: "document-1",
            requires_approval: true,
          },
        ],
      },
    },
    {
      id: "item-msg",
      case_id: CASE,
      visible_to: PARENT,
      source_type: "chat",
      item_type: "message",
      summary: "Message to Kevin",
      created_at: "2026-10-28T11:45:00.000Z",
      plan: {
        status: "ready",
        proposals: [
          {
            id: "msg-1",
            type: "reply_coparent",
            draft: "I can take Friday.",
            recipient_name: "Kevin",
            recipient_email: "kevin@example.com",
            draft_origin: "parent_text",
            requires_approval: true,
          },
        ],
      },
    },
    // Another session of the same parent, with its own pending document.
    {
      id: "item-doc-other",
      case_id: CASE,
      visible_to: PARENT,
      source_type: "chat",
      item_type: "document",
      summary: "School form",
      created_at: "2026-10-28T12:00:00.000Z",
      plan: {
        status: "ready",
        proposals: [
          {
            id: "doc-other",
            type: "log_document",
            draft: "File “School form”.",
            title: "School form",
            attached_document_id: "document-2",
            requires_approval: true,
          },
        ],
      },
    },
    // The other parent's private item in the same case.
    {
      id: "item-doc-kevin",
      case_id: CASE,
      visible_to: OTHER_PARENT,
      source_type: "chat",
      item_type: "document",
      summary: "Private note",
      created_at: "2026-10-28T12:30:00.000Z",
      plan: {
        status: "ready",
        proposals: [
          {
            id: "doc-kevin",
            type: "log_document",
            draft: "File “Kevin private”.",
            title: "Kevin private",
            attached_document_id: "document-3",
            requires_approval: true,
          },
        ],
      },
    },
  ]);
  const link = (id: string, session: string, user: string, itemId: string, minute: number) => ({
    id,
    session_id: session,
    user_id: user,
    role: "user",
    content: `message ${id}`,
    sage_item_id: itemId,
    created_at: `2026-10-28T10:${String(minute).padStart(2, "0")}:00.000Z`,
  });
  db.seed("sage_journal_messages", [
    link("j-cal", SESSION, PARENT, "item-cal", 1),
    link("j-exp", SESSION, PARENT, "item-exp", 2),
    link("j-doc", SESSION, PARENT, "item-doc", 3),
    link("j-msg", SESSION, PARENT, "item-msg", 4),
    link("j-doc-other", OTHER_SESSION, PARENT, "item-doc-other", 5),
    link("j-doc-kevin", "session-kevin", OTHER_PARENT, "item-doc-kevin", 6),
  ]);
  return db;
}

function planOf(db: FakeDb, id: string): string {
  return JSON.stringify(db.table("sage_items").find((row) => row.id === id)?.plan);
}

function statusOf(db: FakeDb, itemId: string, proposalIndex = 0): unknown {
  const plan = db.table("sage_items").find((row) => row.id === itemId)?.plan as {
    proposals: { status?: unknown }[];
  };
  return plan.proposals[proposalIndex]?.status;
}

/** What the model double answers for a message. It answers honestly about the parent's own words. */
type ModelReading = {
  item_type?: string;
  action_required?: boolean;
  tool_name?: string | null;
  summary?: string;
};

function installModel(readings: Record<string, ModelReading>) {
  const prompts: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes("api.anthropic.com")) {
      return new Response(JSON.stringify({ message: "offline" }), { status: 500 });
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: { content?: string }[] };
    const prompt = body.messages?.[0]?.content ?? "";
    prompts.push(prompt);
    const turnLines = prompt.split("\n").filter((line) => /From: .*?\(.*?\): /.test(line));
    const current = (turnLines[turnLines.length - 1] ?? "").replace(/^.*?\(.*?\): /, "").trim();
    const reading = readings[current] ?? {};
    const payload = {
      intent: {
        item_type: reading.item_type ?? "information_only",
        domain: "general",
        summary: reading.summary ?? "The parent shared a thought.",
        evidence_excerpt: "",
        tool_name: reading.tool_name ?? null,
        action_required: reading.action_required ?? false,
        action_type: null,
        urgency: "normal",
        confidence: 0.9,
      },
      entities: { children: [], people: [], dates: [], amounts: [], merchants: [], providers: [], documents: [] },
      reasoning: { signals: [] },
    };
    return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(payload) }] }), {
      status: 200,
    });
  }) as typeof fetch;
  return {
    prompts,
    restore() {
      globalThis.fetch = realFetch;
    },
  };
}

function speaker(): ConversationModel {
  return {
    reply: async () => "Sage is listening.",
    readTurn: async () => null,
  };
}

async function sendChat(db: FakeDb, message: string) {
  const conversation = await loadConversationContext(asAdmin(db) as never, SESSION, PARENT, "America/Denver", TODAY);
  const result = await processChatMessage({
    message,
    case_id: CASE,
    timezone: "America/Denver",
    conversation,
    coparents: [kevin],
    children: [{ id: "child-1", name: "Ashley Example" }],
    viewerId: PARENT,
    viewerRole: "parent",
    reasonAboutDocument: null,
    shadow: false,
    today: TODAY,
    conversationModel: speaker(),
  });
  return { result, conversation };
}

/** A proposal from a stored plan, wrapped as the route's revisable-draft target. */
function draftTarget(db: FakeDb, itemId: string, source = "chat"): RevisableDraft {
  const row = db.table("sage_items").find((item) => item.id === itemId)!;
  const plan = row.plan as { proposals: Record<string, unknown>[] };
  const proposal = plan.proposals[0];
  return {
    itemId,
    summary: String(row.summary ?? ""),
    proposalType: proposal.type as RevisableDraft["proposalType"],
    proposalIndex: 0,
    currentDraft: String(proposal.draft ?? ""),
    sourceType: source,
    audience: (proposal.audience as RevisableDraft["audience"]) ?? null,
    plan: row.plan as Record<string, unknown>,
    proposals: plan.proposals.map((p) => ({ ...p })),
  };
}

async function main() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:9";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
  process.env.ANTHROPIC_API_KEY = "test-key";

  // --- 1. One definition of live and closed ---------------------------------------------------------------
  {
    const states: [Record<string, unknown>, string][] = [
      [{ type: "ask_clarification" }, "open"],
      [{ type: "ask_clarification", status: "save_failed" }, "open"],
      [{ status: "completed" }, "completed"],
      [{ status: "dismissed" }, "dismissed"],
      [{ status: "waived_by_user" }, "dismissed"],
      [{ status: "declined" }, "declined"],
      [{ status: "canceled" }, "canceled"],
      [{ status: "cancelled" }, "canceled"],
      [{ status: "superseded" }, "superseded"],
      [{ superseded_by: "next" }, "superseded"],
      [{ status: "expired" }, "expired"],
      [{ status: "executed" }, "executed"],
      [{ executed: true }, "executed"],
      [{ status: "approved" }, "approved"],
      [{ approved_at: "2026-10-28T10:00:00Z" }, "approved"],
    ];
    for (const [proposal, expected] of states) {
      assert.equal(proposalState(proposal), expected, JSON.stringify(proposal));
      assert.equal(isLiveProposal(proposal), expected === "open", JSON.stringify(proposal));
    }

    // Every consumer reads the same list: ended work is closed in the context, the memory, and the resolver.
    for (const status of ["completed", "dismissed", "declined", "canceled", "superseded", "expired", "waived_by_user"]) {
      const db = dentistDb();
      const item = db.table("sage_items").find((row) => row.id === "item-exp")!;
      (item.plan as { proposals: Record<string, unknown>[] }).proposals[0].status = status;
      const context = await loadConversationContext(asAdmin(db) as never, SESSION, PARENT, "America/Denver", TODAY);
      assert.equal(
        context.open_proposals.some((open) => open.text.includes("amount")),
        false,
        `${status} question is no longer an open proposal`
      );
      assert.equal(context.memory?.clarification ?? null, null, `${status} question is not the open clarification`);
      assert.doesNotMatch(formatConversationContext(context), /expense/i, `${status} question stays out of the model's context`);
      assert.equal(isResolvedProposal({ type: "ask_clarification", status } as never), true, `${status} is resolved`);
    }

    // Legitimate pending work keeps its meaning.
    const live = await loadConversationContext(asAdmin(dentistDb()) as never, SESSION, PARENT, "America/Denver", TODAY);
    assert.ok(live.open_proposals.some((open) => open.text.includes("amount")), "the pending question stays open");
    assert.equal(live.memory?.clarification?.kind, "expense");
    assert.equal(live.memory?.clarification?.proposalId, "ask-exp");
  }

  // --- 2. The dentist session: unrelated text creates no expense and no message ----------------------------
  {
    const db = dentistDb();
    const model = installModel({
      asshole: {
        item_type: "information_only",
        action_required: false,
        // The model's own summary mentions the open expense question it was shown.
        summary: "The parent is frustrated; an expense question about the dentist is still open.",
      },
      "Kevin and I disagree about whether Ashley needs to see the pediatrician.": {
        item_type: "concern",
        action_required: false,
        summary: "The parent disagrees with the co-parent about a pediatrician visit.",
      },
    });
    try {
      const before = JSON.stringify(db.table("sage_items"));
      for (const round of [1, 2, 3]) {
        const { result, conversation } = await sendChat(db, "asshole");
        assert.ok(
          conversation.open_proposals.some((open) => open.text.includes("amount")),
          "the stale expense question reaches the model as context"
        );
        assert.equal(result.result.plan.proposals.length, 0, `round ${round}: no proposal`);
        assert.equal(result.actions.length, 0, `round ${round}: no cards`);
        assert.equal(result.result.interpretation.intent.item_type === "expense", false, `round ${round}: not an expense`);
        assert.equal(
          result.result.plan.proposals.some((p) => p.type === "log_expense" || p.type === "reply_coparent"),
          false
        );
        assert.equal(result.reply, "Sage is listening.", "the conversational responder answers");
        // The route saves an item only for a plan with proposals, so nothing new is stored.
        assert.equal(JSON.stringify(db.table("sage_items")), before, `round ${round}: stored work is unchanged`);
      }
      assert.ok(model.prompts.length > 0 && model.prompts.every((p) => /\[conversation\]/.test(p)));

      // A substantive disagreement about a pediatrician is not an expense either.
      const disagreement = await sendChat(db, "Kevin and I disagree about whether Ashley needs to see the pediatrician.");
      assert.equal(disagreement.result.result.interpretation.intent.item_type === "expense", false);
      assert.equal(disagreement.result.result.expense_category, undefined);
      assert.equal(
        disagreement.result.result.plan.proposals.some((p) => p.type === "log_expense" || p.type === "ask_clarification"),
        false,
        "no expense and no new question"
      );
      assert.equal(JSON.stringify(db.table("sage_items")), before);
    } finally {
      model.restore();
    }
  }

  // --- 3. Unrelated free text never revises a question addressed to the parent ------------------------------
  {
    const db = dentistDb();
    // The newest open reply or question in the session is the expense question and an outgoing message.
    const found = await latestRevisableDraft(asAdmin(db), SESSION, PARENT);
    assert.equal(found?.itemId, "item-msg", "only the outgoing draft can be revised");
    assert.equal(found?.proposalType, "reply_coparent");

    // With the outgoing draft closed, the parent's question is the only open item, and nothing is revisable.
    const msg = db.table("sage_items").find((row) => row.id === "item-msg")!;
    (msg.plan as { proposals: Record<string, unknown>[] }).proposals[0].status = "executed";
    assert.equal(await latestRevisableDraft(asAdmin(db), SESSION, PARENT), null);
    assert.equal(await latestRevisableDraft(asAdmin(db), SESSION, PARENT, { blockedOnly: true }), null);

    // A forged target for the question is refused, and the writer never runs.
    let writerCalls = 0;
    const redraft: Redrafter = async () => {
      writerCalls += 1;
      return "rewritten";
    };
    const before = planOf(db, "item-exp");
    const revised = await revisePendingDraft({
      admin: asAdmin(db),
      userId: PARENT,
      guidance: "asshole",
      target: draftTarget(db, "item-exp"),
      redraft,
    });
    assert.equal(revised, null);
    assert.equal(writerCalls, 0);
    assert.equal(planOf(db, "item-exp"), before, "the question text is untouched");

    // A question to the co-parent (not from chat, audience co-parent) remains an outgoing draft.
    assert.ok(openReplyProposal({ type: "ask_clarification", audience: "coparent", draft: "When?" }, "email"));
    assert.equal(openReplyProposal({ type: "ask_clarification", audience: "parent", draft: "When?" }, "email"), null);
    assert.equal(openReplyProposal({ type: "ask_clarification", draft: "What amount?" }, "chat"), null);

    // Revising an outgoing draft still works.
    const outgoing = dentistDb();
    const draft = await latestRevisableDraft(asAdmin(outgoing), SESSION, PARENT);
    assert.ok(draft);
    const result = await revisePendingDraft({
      admin: asAdmin(outgoing),
      userId: PARENT,
      guidance: "Add that I can pick up at 4.",
      target: draft,
      redraft: async () => "I can take Friday and pick up at 4.",
    });
    assert.ok(result);
    assert.match(result.reply, /Added that to your reply to Co-Parent/);
    const stored = (outgoing.table("sage_items").find((row) => row.id === "item-msg")!.plan as {
      proposals: Record<string, unknown>[];
    }).proposals;
    assert.equal(stored.length, 2, "the old draft is frozen and a replacement is added");
    assert.equal(proposalState(stored[0]), "superseded");
    assert.equal(stored[1].revised_text, "I can take Friday and pick up at 4.");
    assert.equal(planOf(outgoing, "item-exp"), planOf(dentistDb(), "item-exp"), "the question is untouched");
  }

  // --- 4. A turn closes the question it answers, and only that one -----------------------------------------------
  {
    const db = dentistDb();
    // A newer calendar question sits after the older expense question.
    db.seed("sage_items", [
      {
        id: "item-cal-ask",
        case_id: CASE,
        visible_to: PARENT,
        source_type: "chat",
        item_type: "calendar_event",
        summary: "Which event?",
        created_at: "2026-10-28T11:50:00.000Z",
        plan: {
          status: "ready",
          proposals: [
            {
              id: "ask-cal",
              type: "ask_clarification",
              draft: "What time is the orthodontist?",
              audience: "parent",
              clarifies: "calendar",
              requires_approval: true,
            },
          ],
        },
      },
    ]);
    db.seed("sage_journal_messages", [
      {
        id: "j-cal-ask",
        session_id: SESSION,
        user_id: PARENT,
        role: "sage",
        content: "What time?",
        sage_item_id: "item-cal-ask",
        created_at: "2026-10-28T10:07:00.000Z",
      },
    ]);
    const snapshots = Object.fromEntries(
      ["item-cal", "item-doc", "item-msg", "item-cal-ask", "item-doc-other", "item-doc-kevin"].map((id) => [id, planOf(db, id)])
    );

    // A genuine expense request still works and yields an expense proposal.
    const request = routeChatIntent({
      message: "I paid $85 for Ashley's dentist visit.",
      conversation: await loadConversationContext(asAdmin(db) as never, SESSION, PARENT, "America/Denver", TODAY),
      coparents: [kevin],
      children: [{ id: "child-1", name: "Ashley Example" }],
      today: TODAY,
    });
    assert.ok(request.handled);
    assert.ok(request.result.plan.proposals.some((p) => p.type === "log_expense"), "a genuine expense request still works");

    // The parent answers the expense question. The router names the question it read.
    const conversation = await loadConversationContext(asAdmin(db) as never, SESSION, PARENT, "America/Denver", TODAY);
    // The newest question belongs to the calendar, so the expense question is not the live focus for a time answer.
    const answer = routeChatIntent({
      message: "$85",
      conversation: { ...conversation, memory: deriveWorkingMemory([
        {
          itemId: "item-exp",
          itemType: "expense",
          proposals: (db.table("sage_items").find((row) => row.id === "item-exp")!.plan as { proposals: Record<string, unknown>[] }).proposals,
        },
      ]) },
      coparents: [kevin],
      children: [{ id: "child-1", name: "Ashley Example" }],
      today: TODAY,
    });
    assert.ok(answer.handled);
    assert.ok(answer.result.plan.proposals.some((p) => p.type === "log_expense"), "an answer to the expense question still works");
    assert.equal(answer.answers, "ask-exp");

    const closed = await closeAnsweredQuestions(asAdmin(db), {
      sessionId: SESSION,
      userId: PARENT,
      turnProposals: answer.result.plan.proposals,
      answersProposalId: answer.answers,
      itemType: "expense",
    });
    assert.deepEqual(closed.map((question) => question.proposalId), ["ask-exp"]);
    assert.equal(statusOf(db, "item-exp"), "completed", "the expense question is closed");
    assert.equal(statusOf(db, "item-cal-ask"), undefined, "the newer calendar question is untouched");
    for (const [id, snapshot] of Object.entries(snapshots)) {
      assert.equal(planOf(db, id), snapshot, `${id} is unchanged`);
    }

    // A calendar turn with no id closes the calendar question and leaves the others.
    const calendarClosed = await closeAnsweredQuestions(asAdmin(db), {
      sessionId: SESSION,
      userId: PARENT,
      turnProposals: [{ type: "calendar_update", draft: "Orthodontist Friday at 4:30 PM." }],
    });
    assert.deepEqual(calendarClosed.map((question) => question.proposalId), ["ask-cal"]);
    assert.equal(statusOf(db, "item-cal-ask"), "completed");
    assert.equal(planOf(db, "item-doc"), snapshots["item-doc"]);
    assert.equal(planOf(db, "item-msg"), snapshots["item-msg"]);

    // A turn that completes nothing closes nothing.
    const none = await closeAnsweredQuestions(asAdmin(db), {
      sessionId: SESSION,
      userId: PARENT,
      turnProposals: [{ type: "note_only", draft: "Noted." }],
    });
    assert.deepEqual(none, []);
  }

  // --- 5. Completing or dismissing a proposal resolves its own question ----------------------------------------
  {
    const plan = [
      { id: "p-exp", type: "log_expense", draft: "Dentist $85", requires_approval: true },
      { id: "q-exp", type: "ask_clarification", draft: "Who paid?", audience: "parent", clarifies: "expense" },
      { id: "q-cal", type: "ask_clarification", draft: "What time?", audience: "parent", clarifies: "calendar" },
      { id: "q-out", type: "ask_clarification", draft: "When is it?", audience: "coparent", clarifies: "expense" },
    ];
    const opts = { itemType: "expense", sourceType: "chat", now: "2026-10-28T20:00:00.000Z" };
    const done = resolveOwnQuestions(plan, 0, "completed", opts);
    assert.deepEqual(done.resolved, [1], "only the same-kind question to the parent closes");
    assert.equal(proposalState(done.proposals[1]), "completed");
    assert.equal(done.proposals[1].closed_with, "p-exp");
    assert.equal(isLiveProposal(done.proposals[2]), true, "an unrelated question stays open");
    assert.equal(isLiveProposal(done.proposals[3]), true, "a question to the co-parent is not the parent's");

    const dismissed = resolveOwnQuestions(plan, 0, "dismissed", opts);
    assert.equal(proposalState(dismissed.proposals[1]), "dismissed");

    // Undoing the proposal reopens only what it closed.
    const reopened = reopenOwnQuestions(dismissed.proposals, 0);
    assert.deepEqual(reopened.reopened, [1]);
    assert.equal(isLiveProposal(reopened.proposals[1]), true);
    assert.equal("closed_with" in reopened.proposals[1], false);

    // A question the parent closed on their own stays closed through an undo.
    const parentClosed = plan.map((p) => ({ ...p }));
    parentClosed[1] = { ...parentClosed[1], status: "waived_by_user" } as never;
    assert.deepEqual(reopenOwnQuestions(parentClosed, 0).reopened, []);

    // Another live proposal of the same kind keeps the question open.
    const twoExpenses = [
      { id: "a", type: "log_expense", draft: "A" },
      { id: "b", type: "log_expense", draft: "B" },
      { id: "q", type: "ask_clarification", draft: "Which?", audience: "parent", clarifies: "expense" },
    ];
    assert.deepEqual(resolveOwnQuestions(twoExpenses, 0, "completed", opts).resolved, []);
  }

  // --- 6. A repeated question is not saved a second time ----------------------------------------------------------
  {
    const db = dentistDb();
    const open = openParentQuestions(await loadSessionItems(asAdmin(db), SESSION, PARENT));
    assert.equal(repeatsOpenQuestion(open, { kind: "expense", text: ASK_EXPENSE }), true);
    assert.equal(repeatsOpenQuestion(open, { kind: "expense", text: "What was the amount?  " }), false);
    assert.equal(repeatsOpenQuestion(open, { kind: "calendar", text: ASK_EXPENSE }), false);
    assert.equal(
      await turnRepeatsOpenQuestions(asAdmin(db), {
        sessionId: SESSION,
        userId: PARENT,
        turnProposals: [
          { type: "ask_clarification", draft: ASK_EXPENSE, audience: "parent", clarifies: "expense" },
        ],
        itemType: "expense",
        sourceType: "chat",
      }),
      true
    );
    assert.equal(
      await turnRepeatsOpenQuestions(asAdmin(db), {
        sessionId: SESSION,
        userId: PARENT,
        turnProposals: [
          { type: "ask_clarification", draft: ASK_EXPENSE, audience: "parent", clarifies: "expense" },
          { type: "log_expense", draft: "Dentist" },
        ],
        itemType: "expense",
        sourceType: "chat",
      }),
      false,
      "a turn that adds anything new is saved"
    );
  }

  // --- 7. Documents and history stay inside the parent and the session ------------------------------------------
  {
    const db = dentistDb();
    const here = await loadLatestOpenDocument(asAdmin(db) as never, CASE, PARENT, SESSION);
    assert.equal(here?.documentId, "document-1");
    const other = await loadLatestOpenDocument(asAdmin(db) as never, CASE, PARENT, OTHER_SESSION);
    assert.equal(other?.documentId, "document-2", "another session sees its own pending document");
    const sessionless = await loadLatestOpenDocument(asAdmin(db) as never, CASE, PARENT, null);
    assert.equal(sessionless, null, "a chat with no session sees no session's document");
    const kevinHere = await loadLatestOpenDocument(asAdmin(db) as never, CASE, OTHER_PARENT, SESSION);
    assert.equal(kevinHere, null, "another parent never reads this session's documents");
    const kevinOwn = await loadLatestOpenDocument(asAdmin(db) as never, CASE, OTHER_PARENT, "session-kevin");
    assert.equal(kevinOwn?.documentId, "document-3");
    const crossRead = await loadLatestOpenDocument(asAdmin(db) as never, CASE, PARENT, "session-kevin");
    assert.equal(crossRead, null, "a session the parent does not own yields nothing");

    // Revising from one session leaves the other session's pending document alone.
    const otherBefore = planOf(db, "item-doc-other");
    const revision = {
      key: "pending-document",
      title: "Dental records, 2026",
      description: "Updated",
      category: "medical",
      visibility: "parents_only" as const,
      childId: null,
      childName: null,
      fileName: null,
      documentId: "document-1",
      updatesExisting: false,
    };
    const applied = await reviseLatestOpenDocument(asAdmin(db) as never, CASE, PARENT, revision, SESSION);
    assert.equal(applied?.id, "item-doc");
    assert.equal(planOf(db, "item-doc-other"), otherBefore);
    assert.equal(planOf(db, "item-doc-kevin"), planOf(dentistDb(), "item-doc-kevin"));
    const misdirected = await reviseLatestOpenDocument(asAdmin(db) as never, CASE, PARENT, { ...revision, documentId: "document-3", title: "x" }, "session-kevin");
    assert.equal(misdirected, null);

    // Private Sage history is read through the same session link.
    const mine = await loadSessionItems(asAdmin(db), SESSION, PARENT);
    assert.deepEqual(mine.map((row) => row.id).sort(), ["item-cal", "item-doc", "item-exp", "item-msg"]);
    assert.deepEqual((await loadSessionItems(asAdmin(db), SESSION, OTHER_PARENT)).map((row) => row.id), []);
    const contextOther = await loadConversationContext(asAdmin(db) as never, OTHER_SESSION, PARENT, "America/Denver", TODAY);
    assert.equal(contextOther.open_proposals.some((open) => /amount|Dental/.test(open.text)), false);
  }

  // --- 8. The case comes from the signed-in parent, never from an arbitrary row ----------------------------------------
  {
    const a = { case_id: "case-a", role: "parent" };
    const b = { case_id: "case-b", role: "parent" };
    assert.equal(chooseActiveCase([]).status, "none");
    assert.deepEqual(chooseActiveCase([a]), { status: "resolved", caseId: "case-a", role: "parent", via: "only_membership" });
    // Order of the rows never changes the answer.
    assert.equal(chooseActiveCase([a, b]).status, "ambiguous");
    assert.equal(chooseActiveCase([b, a]).status, "ambiguous");
    assert.equal(chooseActiveCase([a, b], { requestedCaseId: "case-b" }).caseId, "case-b");
    assert.equal(chooseActiveCase([b, a], { requestedCaseId: "case-b" }).caseId, "case-b");
    assert.equal(chooseActiveCase([a, b], { requestedCaseId: "case-z" }).status, "ambiguous", "a case the parent is not in is ignored");
    assert.equal(chooseActiveCase([a, b], { sessionCaseIds: ["case-a"] }).caseId, "case-a");
    assert.equal(chooseActiveCase([a, b], { sessionCaseIds: ["case-a", "case-b"] }).status, "ambiguous");
    assert.equal(chooseActiveCase([a, b], { sessionCaseIds: ["case-z"] }).status, "ambiguous");
    assert.equal(chooseActiveCase([a, a]).caseId, "case-a", "a repeated membership row is one case");

    const db = new FakeDb();
    db.seed("case_members", [
      { user_id: PARENT, case_id: "case-a", role: "parent" },
      { user_id: PARENT, case_id: "case-b", role: "parent" },
      { user_id: OTHER_PARENT, case_id: "case-a", role: "parent" },
    ]);
    const ambiguous = await resolveActiveCase(asAdmin(db) as never, PARENT);
    assert.equal(ambiguous.status, "ambiguous");
    const single = await resolveActiveCase(asAdmin(db) as never, OTHER_PARENT);
    assert.equal(single.caseId, "case-a");
    const none = await resolveActiveCase(asAdmin(db) as never, "stranger");
    assert.equal(none.status, "none");

    // The session the parent is working in names its case.
    db.seed("sage_items", [{ id: "s-item", case_id: "case-b", visible_to: PARENT }]);
    db.seed("sage_journal_messages", [
      { id: "j1", session_id: "s-b", user_id: PARENT, role: "user", sage_item_id: "s-item" },
    ]);
    const bySession = await resolveActiveCase(asAdmin(db) as never, PARENT, { sessionId: "s-b" });
    assert.deepEqual(
      { status: bySession.status, caseId: bySession.caseId },
      { status: "resolved", caseId: "case-b" }
    );
    const emptySession = await resolveActiveCase(asAdmin(db) as never, PARENT, { sessionId: "s-empty" });
    assert.equal(emptySession.status, "ambiguous");
  }

  console.log("task-state-stabilization tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
