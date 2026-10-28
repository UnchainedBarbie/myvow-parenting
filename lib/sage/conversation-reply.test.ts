import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeDb } from "@/lib/messages/fake-admin";
import { processChatMessage } from "@/lib/sage/chat";
import { routeChatIntent, messageAnswerCandidate, type KnownCoparent } from "@/lib/sage/chat-intent";
import {
  anthropicConversationModel,
  buildConversationPacket,
  conversationFallbackReply,
  readTurnFromText,
  replyRequestBody,
  turnRequestBody,
  type ConversationModel,
  type ConversationPacket,
  type TaskTurnReading,
} from "@/lib/sage/conversation-reply";
import type { ConversationContext } from "@/lib/sage/conversation-context";
import { loadSessionTurns } from "@/lib/sage/session-turns";
import { deriveWorkingMemory } from "@/lib/sage/working-memory";
import { shouldPreserveOpenWork } from "@/lib/sage/chat-intent";

/**
 * The model is replaced by a test double. The double stands in for the model's judgement about a
 * message, so a test can say what the model answered. The product code under test never reads the
 * words of a message to decide anything.
 */

const TODAY = new Date("2026-10-23T18:00:00Z");
const kevinContact: KnownCoparent = { name: "Kevin", email: "kevin@example.com" };
const ashleyContact: KnownCoparent = { name: "Ashley", email: "ashley@example.com" };

function context(over: Partial<ConversationContext> = {}): ConversationContext {
  return {
    thread_subject: null,
    event: { subject: null, child: null, date: null, time: null, eventId: null },
    open_proposals: [],
    ...over,
  };
}

function messageQuestionMemory(recipient: KnownCoparent) {
  return deriveWorkingMemory([
    {
      itemId: "item-msg",
      itemType: "message",
      proposals: [
        {
          id: "ask-msg",
          type: "ask_clarification",
          draft: `What should I tell ${recipient.name}? I won't invent the details.`,
          audience: "parent",
          clarifies: "message",
          recipient_name: recipient.name,
          recipient_email: recipient.email,
          requires_approval: true,
        },
      ],
    },
  ]);
}

const executedCalendarMemory = deriveWorkingMemory([
  {
    itemId: "item-cal",
    itemType: "calendar_event",
    proposals: [
      {
        id: "cal-1",
        type: "calendar_update",
        draft: "Add to calendar: Ashley OT, Friday at 4:30 PM.",
        title: "Ashley OT",
        approved: true,
        executed: true,
        status: "executed",
        result_event_id: "event-1",
      },
    ],
  },
]);

type Recorder = {
  model: ConversationModel;
  replies: ConversationPacket[];
  reads: ConversationPacket[];
};

/** `readings` says what the model answered for a message when asked about the pending question. */
function double(opts: { reply?: string | null; readings?: Record<string, TaskTurnReading | null> } = {}): Recorder {
  const replies: ConversationPacket[] = [];
  const reads: ConversationPacket[] = [];
  return {
    replies,
    reads,
    model: {
      reply: async (packet) => {
        replies.push(packet);
        return opts.reply === undefined ? "MODEL-REPLY" : opts.reply;
      },
      readTurn: async (packet) => {
        reads.push(packet);
        return opts.readings?.[packet.message] ?? null;
      },
    },
  };
}

function forbidden(): Recorder {
  const recorder = double();
  recorder.model = {
    reply: async () => {
      throw new Error("the conversational model must not run for an action turn");
    },
    readTurn: async () => {
      throw new Error("the turn reader must not run without an open question");
    },
  };
  return recorder;
}

async function chat(
  message: string,
  over: {
    conversation?: ConversationContext | null;
    coparents?: KnownCoparent[];
    recentTurns?: { role: "parent" | "sage"; text: string }[];
    viewerId?: string;
    model: ConversationModel | null;
  }
) {
  return processChatMessage({
    message,
    case_id: "case-1",
    timezone: "America/Denver",
    conversation: over.conversation ?? null,
    coparents: over.coparents ?? [kevinContact],
    children: [{ id: "child-1", name: "Ashley Example" }],
    viewerId: over.viewerId ?? "parent-ashley",
    viewerRole: "parent",
    recentTurns: over.recentTurns,
    reasonAboutDocument: null,
    shadow: false,
    today: TODAY,
    conversationModel: over.model,
  });
}

function assertConversationOnly(result: Awaited<ReturnType<typeof chat>>) {
  assert.equal(result.actions.length, 0, "a conversational turn creates no cards");
  assert.equal(result.result.plan.proposals.length, 0, "a conversational turn creates no proposals");
  assert.equal(result.result.plan.status, "no_action");
  assert.equal(result.control, "none");
  assert.equal(result.revision, null);
}

const MENU = /calendar event|log an expense|file a document|draft a message|I didn't take an action/i;

async function main() {
  delete process.env.ANTHROPIC_API_KEY;

  // --- Ordinary conversation: no action, a model reply, no menu --------------------------------
  for (const message of ["How was your weekend?", "I'm frustrated with my co-parent.", "asshole"]) {
    const spoken = double({ reply: "A reply written for this parent." });
    const result = await chat(message, { model: spoken.model });
    assert.equal(result.reply, "A reply written for this parent.");
    assertConversationOnly(result);
    assert.equal(spoken.replies.length, 1);
    assert.equal(spoken.replies[0].message, message);
    assert.equal(spoken.reads.length, 0, "no question is open, so nothing reads the turn against one");
    assert.doesNotMatch(result.reply, MENU);
    // Mentioning the co-parent is not a request to contact them.
    assert.equal(result.result.plan.proposals.some((proposal) => proposal.type === "reply_coparent"), false);
  }

  // --- A new private session: nothing carried in -----------------------------------------------
  {
    const spoken = double();
    await chat("asshole", { model: spoken.model, conversation: null, recentTurns: [] });
    const packet = spoken.replies[0];
    assert.deepEqual(packet.recentTurns, []);
    assert.equal(packet.pendingQuestion, null);
    assert.deepEqual(packet.pendingCards, []);
    assert.deepEqual(packet.completed, []);
  }

  // --- After an approved calendar action --------------------------------------------------------
  {
    const spoken = double({ reply: "Sage speaking." });
    const conversation = context({ memory: executedCalendarMemory });
    const before = JSON.stringify(executedCalendarMemory);
    const result = await chat("asshole", { model: spoken.model, conversation });
    assert.equal(result.reply, "Sage speaking.");
    assertConversationOnly(result);
    // The system's record of the completed event is available, and nothing new was proposed.
    assert.deepEqual(spoken.replies[0].completed, [{ kind: "calendar", title: "Ashley OT" }]);
    assert.equal(JSON.stringify(executedCalendarMemory), before, "the saved work is untouched");
    assert.equal(shouldPreserveOpenWork("asshole", executedCalendarMemory, result.result.plan.proposals), true);
  }

  // --- An open message question ------------------------------------------------------------------
  {
    const memory = messageQuestionMemory(kevinContact);
    const question = memory.clarification?.question ?? "";
    assert.ok(question);
    const before = JSON.stringify(memory);
    for (const aside of ["asshole", "I'm just tired today."]) {
      const spoken = double({ reply: "Sage listening.", readings: { [aside]: "other" } });
      const result = await chat(aside, {
        model: spoken.model,
        conversation: context({ memory }),
        coparents: [kevinContact],
      });
      assert.equal(result.reply, "Sage listening.");
      assertConversationOnly(result);
      assert.equal(spoken.reads.length, 1, "the turn is read against the open question");
      assert.equal(spoken.reads[0].pendingQuestion, question);
      assert.equal(spoken.replies[0].pendingQuestion, question, "the reply still sees the question as pending");
      assert.equal(JSON.stringify(memory), before, "the open question is preserved");
      assert.equal(shouldPreserveOpenWork(aside, memory, result.result.plan.proposals), true);
    }

    // A genuine answer still becomes a draft that waits for approval.
    const answering = double({ readings: { "I can take Friday.": "answers_pending_question" } });
    const answer = await chat("I can take Friday.", {
      model: answering.model,
      conversation: context({ memory }),
    });
    const draft = answer.result.plan.proposals.find((proposal) => proposal.type === "reply_coparent");
    assert.ok(draft);
    assert.equal(draft.draft, "I can take Friday.");
    assert.equal(draft.recipient_email, "kevin@example.com");
    assert.equal(draft.requires_approval, true);
    assert.equal("executed" in draft, false);
    assert.equal(answering.replies.length, 0, "the answer is not also answered conversationally");
    assert.match(answer.reply, /Nothing is sent until you review it and choose Send/);

    // When the turn cannot be read, the existing slot filling stands. The draft still needs approval.
    const unread = double({ readings: {} });
    const fallback = await chat("asshole", { model: unread.model, conversation: context({ memory }) });
    // Text with no content for a message is never turned into a draft, even when the turn is unread.
    assert.equal(fallback.result.plan.proposals.length, 0);
    assert.match(fallback.reply, /What do you want Kevin to know or do\?/);
    const withoutModel = await chat("I can take Friday.", { model: null, conversation: context({ memory }) });
    assert.ok(withoutModel.result.plan.proposals.some((proposal) => proposal.type === "reply_coparent"));
    assert.equal(messageAnswerCandidate("asshole", memory)?.name, "Kevin");
    assert.equal(messageAnswerCandidate("add it to the calendar for friday", memory), null);
    assert.equal(messageAnswerCandidate("hello", deriveWorkingMemory([])), null);
  }

  // --- Failure handling ----------------------------------------------------------------------------
  {
    const failing = double({ reply: null });
    const result = await chat("How was your weekend?", { model: failing.model });
    assertConversationOnly(result);
    assert.doesNotMatch(result.reply, MENU);
    assert.match(result.reply, /haven't changed anything/i);
    assert.doesNotMatch(result.reply, /noted|saved|sent|filed|logged|added/i);

    const throwing: ConversationModel = {
      reply: async () => {
        throw new Error("network down");
      },
      readTurn: async () => null,
    };
    const thrown = await chat("How was your weekend?", { model: throwing });
    assert.equal(thrown.reply, result.reply);
    const none = await chat("How was your weekend?", { model: null });
    assert.equal(none.reply, result.reply);

    const memory = messageQuestionMemory(kevinContact);
    const withQuestion = await chat("hmm", {
      model: double({ reply: null, readings: { hmm: "other" } }).model,
      conversation: context({ memory }),
    });
    assert.match(withQuestion.reply, /Your earlier question is still open: What should I tell Kevin/);
    assert.equal(conversationFallbackReply(null), result.reply);
  }

  // --- Existing structured actions are untouched ------------------------------------------------------
  {
    const never = forbidden();
    const calendar = await chat("Ashley needs to be at school at 6 pm tomorrow.", { model: never.model });
    assert.deepEqual(
      calendar.result.plan.proposals.map((proposal) => proposal.type),
      ["calendar_update"]
    );
    const messaging = await chat("Kevin needs to know about Ashley's appointment.", {
      model: never.model,
      conversation: context({ event: { subject: "appointment", child: "Ashley", date: "2026-10-22", time: "4:30 PM" } }),
    });
    assert.ok(messaging.result.plan.proposals.some((proposal) => proposal.type === "reply_coparent"));
    const document = await chat("Save this as a document for Ashley.", { model: never.model });
    assert.ok(document.result.plan.proposals.some((proposal) => proposal.type === "log_document"));
    const cancel = await chat("don't send that message", {
      model: never.model,
      conversation: context({ open_proposals: [{ type: "reply_coparent", text: "Ashley has an OT appointment." }] }),
    });
    assert.equal(cancel.control, "cancel_message");

    const expense = routeChatIntent({
      message: "I paid $45 for Ashley's dentist visit.",
      coparents: [kevinContact],
      timezone: "America/Denver",
      today: TODAY,
    });
    assert.ok(expense.result.plan.proposals.some((proposal) => proposal.type === "log_expense"));
  }

  // --- Two parents, two private sessions ---------------------------------------------------------------
  {
    const db = new FakeDb();
    db.seed("sage_journal_messages", [
      { session_id: "session-ashley", user_id: "parent-ashley", role: "user", content: "ASHLEY-SAID-THIS", created_at: "2026-10-23T10:00:00Z" },
      { session_id: "session-ashley", user_id: "parent-ashley", role: "sage", content: "SAGE-TO-ASHLEY", created_at: "2026-10-23T10:01:00Z" },
      { session_id: "session-kevin", user_id: "parent-kevin", role: "user", content: "KEVIN-SAID-THIS", created_at: "2026-10-23T10:02:00Z" },
      { session_id: "session-kevin", user_id: "parent-kevin", role: "sage", content: "SAGE-TO-KEVIN", created_at: "2026-10-23T10:03:00Z" },
      // A row that does not belong to the signed-in parent never reaches them, even inside their session id.
      { session_id: "session-ashley", user_id: "parent-kevin", role: "user", content: "KEVIN-STRAY-ROW", created_at: "2026-10-23T10:04:00Z" },
    ]);
    const admin = db as unknown as Parameters<typeof loadSessionTurns>[0];
    const ashleyTurns = await loadSessionTurns(admin, "session-ashley", "parent-ashley", "current");
    const kevinTurns = await loadSessionTurns(admin, "session-kevin", "parent-kevin", "current");
    assert.deepEqual(ashleyTurns, [
      { role: "parent", text: "ASHLEY-SAID-THIS" },
      { role: "sage", text: "SAGE-TO-ASHLEY" },
    ]);
    assert.deepEqual(kevinTurns, [
      { role: "parent", text: "KEVIN-SAID-THIS" },
      { role: "sage", text: "SAGE-TO-KEVIN" },
    ]);

    const forAshley = double({ readings: { hmm: "other" } });
    const forKevin = double({ readings: { hmm: "other" } });
    const ashleyMemory = messageQuestionMemory(kevinContact);
    const kevinMemory = messageQuestionMemory(ashleyContact);
    await chat("hmm", {
      model: forAshley.model,
      viewerId: "parent-ashley",
      coparents: [kevinContact],
      recentTurns: ashleyTurns,
      conversation: context({ memory: ashleyMemory }),
    });
    await chat("hmm", {
      model: forKevin.model,
      viewerId: "parent-kevin",
      coparents: [ashleyContact],
      recentTurns: kevinTurns,
      conversation: context({ memory: kevinMemory }),
    });
    const ashleyPrompt = JSON.stringify(replyRequestBody(forAshley.replies[0]));
    const kevinPrompt = JSON.stringify(replyRequestBody(forKevin.replies[0]));
    assert.match(ashleyPrompt, /ASHLEY-SAID-THIS/);
    assert.match(ashleyPrompt, /Parent: ASHLEY-SAID-THIS/);
    assert.match(ashleyPrompt, /Sage: SAGE-TO-ASHLEY/);
    assert.doesNotMatch(ashleyPrompt, /KEVIN-SAID-THIS|SAGE-TO-KEVIN|KEVIN-STRAY-ROW/);
    assert.match(kevinPrompt, /Parent: KEVIN-SAID-THIS/);
    assert.match(kevinPrompt, /Sage: SAGE-TO-KEVIN/);
    assert.doesNotMatch(kevinPrompt, /ASHLEY-SAID-THIS|SAGE-TO-ASHLEY|KEVIN-STRAY-ROW/);
    assert.equal(forAshley.replies[0].coparent, "Kevin");
    assert.equal(forKevin.replies[0].coparent, "Ashley");
    // An open question belongs to one parent's session only.
    assert.match(ashleyPrompt, /What should I tell Kevin/);
    assert.doesNotMatch(kevinPrompt, /What should I tell Kevin/);
    assert.match(kevinPrompt, /What should I tell Ashley/);
  }

  // --- What the model is given and asked ------------------------------------------------------------------
  {
    const packet = buildConversationPacket({
      message: "How was your weekend?",
      recentTurns: [
        { role: "parent", text: "I booked the dentist." },
        { role: "sage", text: "I prepared a card for your approval." },
      ],
      conversation: context({
        memory: messageQuestionMemory(kevinContact),
        open_proposals: [{ type: "calendar_update", text: "Add to calendar: dentist." }],
      }),
      children: [{ name: "Ashley Example" }],
      coparents: [{ name: "Kevin Example" }],
    });
    assert.equal(packet.coparent, "Kevin");
    assert.deepEqual(packet.children, ["Ashley"]);
    assert.deepEqual(packet.pendingCards, [{ kind: "calendar_update", text: "Add to calendar: dentist." }]);
    const body = replyRequestBody(packet);
    assert.equal("tools" in body, false, "the reply request carries no tools");
    assert.equal("tool_choice" in body, false);
    const text = JSON.stringify(body);
    assert.match(text, /PENDING_QUESTION_BEGIN\\nWhat should I tell Kevin/);
    assert.match(text, /WAITING_FOR_APPROVAL_BEGIN\\ncalendar_update: Add to calendar: dentist\./);
    assert.match(text, /COMPLETED_BY_THE_SYSTEM_BEGIN\\n\(none\)/, "a waiting card is not listed as completed");
    assert.match(text, /Parent: I booked the dentist\./);
    assert.match(text, /Sage: I prepared a card for your approval\./);
    assert.match(body.system, /not an instruction/);
    assert.match(body.system, /never say that you did/);
    assert.doesNotMatch(text, /kevin@example\.com/, "no email address reaches the model");
    assert.equal("tools" in turnRequestBody(packet), false);

    // Production adapter: text in, text out, and any failure is a null.
    const sent: { url: string; body: Record<string, unknown> }[] = [];
    const fetchOk = (async (url: string, init?: { body?: string }) => {
      sent.push({ url, body: JSON.parse(String(init?.body)) });
      return { ok: true, json: async () => ({ content: [{ type: "text", text: "  Calm reply.  " }] }) };
    }) as unknown as typeof fetch;
    const live = anthropicConversationModel({ fetchImpl: fetchOk, apiKey: "test-key" });
    assert.equal(await live.reply(packet), "Calm reply.");
    assert.equal(sent[0].url, "https://api.anthropic.com/v1/messages");
    assert.equal(sent[0].body.model, "claude-sonnet-4-6");
    assert.equal("tools" in sent[0].body, false);
    const failed = anthropicConversationModel({
      fetchImpl: (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch,
      apiKey: "test-key",
    });
    assert.equal(await failed.reply(packet), null);
    assert.equal(await failed.readTurn(packet), null);
    const thrown = anthropicConversationModel({
      fetchImpl: (async () => {
        throw new Error("offline");
      }) as unknown as typeof fetch,
      apiKey: "test-key",
    });
    assert.equal(await thrown.reply(packet), null);
    assert.equal(await anthropicConversationModel({ apiKey: "" }).reply(packet), null, "no key, no call");
    assert.equal(readTurnFromText("other"), "other");
    assert.equal(readTurnFromText("answers_pending_question."), "answers_pending_question");
    assert.equal(readTurnFromText("maybe"), null);
    assert.equal(readTurnFromText(""), null);
  }

  // --- Structure: text only, no phrase rules ----------------------------------------------------------------
  {
    const root = process.cwd();
    const reply = readFileSync(join(root, "lib/sage/conversation-reply.ts"), "utf8");
    const code = reply.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.equal(/\btools\s*:/.test(code), false, "the responder sends no tool definitions");
    assert.equal(/tool_choice/.test(code), false);
    assert.equal(/\.insert\(|\.update\(|\.delete\(/.test(code), false, "the responder writes nothing");
    assert.equal(/getServiceRoleClient/.test(code.replace(/import type[^\n]*\n/g, "")), false);
    for (const file of ["lib/sage/conversation-reply.ts", "lib/sage/chat.ts"]) {
      const source = readFileSync(join(root, file), "utf8");
      assert.equal(/asshole|weekend|pediatric|profan|swear/i.test(source), false, `${file} holds no example-specific rules`);
    }
    const route = readFileSync(join(root, "app/api/sage/messages/route.ts"), "utf8");
    assert.match(route, /loadSessionTurns\(admin, sessionId, user\.id, trimmed\)/);
    const chatSource = readFileSync(join(root, "lib/sage/chat.ts"), "utf8");
    assert.match(chatSource, /model\.reply\(packet\(\)\)/);
    assert.equal(/FALLBACK_REPLY|didn't take an action/.test(chatSource), false);
  }

  console.log("conversation reply tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
