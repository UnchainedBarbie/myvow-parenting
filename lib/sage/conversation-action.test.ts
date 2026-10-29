import assert from "node:assert/strict";
import { FakeDb } from "@/lib/messages/fake-admin";
import { processChatMessage } from "@/lib/sage/chat";
import { isMessageDraftRequest, routeChatIntent, type KnownCoparent } from "@/lib/sage/chat-intent";
import {
  buildContextFrame,
  coparentFacts,
  hasConversationSubstance,
  hasEstablishedSchedule,
  relevantParentFacts,
  sageOnlyFacts,
  type ContextFrame,
} from "@/lib/sage/context-frame";
import {
  cleanDraft,
  draftUsesConversation,
  parseActionInterpretation,
  type ConversationActionModel,
} from "@/lib/sage/conversation-action";
import type { ConversationContext } from "@/lib/sage/conversation-context";
import type { ConversationTurn } from "@/lib/sage/conversation-reply";
import { loadSessionTurns } from "@/lib/sage/session-turns";

/**
 * Conversation-to-action continuity. The model is a test double that answers honestly about the
 * frame it was given. Nothing here teaches the product a pediatrician phrase; the assertions check
 * that the conversation's meaning reached the draft, and that the doctor-appointment template did not.
 */

const TODAY = new Date("2026-10-28T18:00:00Z");
const kevin: KnownCoparent = { name: "Kevin", email: "kevin@example.com" };
const ashley = { id: "child-1", name: "Ashley Example" };

const PEDIATRICIAN_TURNS: ConversationTurn[] = [
  {
    role: "parent",
    text: "Kevin and I have not agreed on a new pediatrician for Ashley.",
  },
  {
    role: "sage",
    text: "That sounds hard. What have you already tried?",
  },
  {
    role: "parent",
    text: "I sent him two other pediatrician options last week. He will not consider them.",
  },
  {
    role: "sage",
    text: "So the options are on the table and he has not been willing to look at them.",
  },
  {
    role: "parent",
    text: "The disagreement also involves the previous practice's vaccination policy. I want his position clarified and in writing.",
  },
  {
    role: "sage",
    text: "I can help you think through how to ask for that.",
  },
];

const DRAFT_REQUEST =
  "Please draft a message asking Kevin to clarify whether agreement on a new pediatrician depends on vaccination decisions.";

const CONVERSATION_DRAFT =
  "Please clarify in writing whether agreement on a new pediatrician depends on vaccination decisions. We have not agreed on a new pediatrician. I provided other pediatrician options and my understanding is that you have not been willing to consider them. There is also disagreement about the previous practice's vaccination policy. I am asking for your position in writing.";

function emptyConversation(): ConversationContext {
  return {
    thread_subject: null,
    event: { subject: null, child: null, date: null, time: null, eventId: null },
    open_proposals: [],
  };
}

function actionModel(opts?: {
  failInterpret?: boolean;
  failDraft?: boolean;
  kind?: "message" | "calendar" | "expense" | "conversation";
  draft?: string | null;
}): { model: ConversationActionModel; frames: ContextFrame[] } {
  const frames: ContextFrame[] = [];
  return {
    frames,
    model: {
      interpret: async (frame) => {
        frames.push(frame);
        if (opts?.failInterpret) return null;
        const kind = opts?.kind ?? "message";
        return {
          kind,
          outcome:
            kind === "message"
              ? "Ask Kevin to clarify in writing whether agreement on a new pediatrician depends on vaccination decisions."
              : kind === "expense"
                ? "Log the dentist expense."
                : kind === "calendar"
                  ? "Add the dentist visit to the calendar."
                  : "Continue the conversation.",
          refersTo: kind === "message" ? "the ongoing pediatrician disagreement" : null,
          grounding: kind === "message" ? "conversation" : kind === "calendar" ? "calendar_event" : "insufficient",
          relevantFactIndexes: frame.facts
            .map((fact, index) => (fact.speaker === "parent" ? index : -1))
            .filter((index) => index >= 0),
          uncertain: ["whether Kevin will agree"],
          disputed: ["that Kevin refuses to consider the options", "the previous practice's vaccination policy"],
          recipientName: "Kevin",
        };
      },
      draftMessage: async () => {
        if (opts?.failDraft) return null;
        return opts?.draft === undefined ? CONVERSATION_DRAFT : opts.draft;
      },
    },
  };
}

async function chat(
  message: string,
  over: {
    recentTurns?: ConversationTurn[];
    conversation?: ConversationContext | null;
    coparents?: KnownCoparent[];
    viewerId?: string;
    action: ConversationActionModel | null;
  }
) {
  return processChatMessage({
    message,
    case_id: "case-1",
    timezone: "America/Denver",
    conversation: over.conversation ?? emptyConversation(),
    coparents: over.coparents ?? [kevin],
    children: [ashley],
    viewerId: over.viewerId ?? "parent-ashley",
    viewerRole: "parent",
    recentTurns: over.recentTurns ?? PEDIATRICIAN_TURNS,
    sessionId: "session-ashley",
    reasonAboutDocument: null,
    shadow: false,
    today: TODAY,
    conversationModel: null,
    conversationActionModel: over.action,
  });
}

const APPOINTMENT_TEMPLATE = /doctor appointment/i;

async function main() {
  delete process.env.ANTHROPIC_API_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:9";
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "test-key";

  // --- Root cause: the router no longer fills a doctor-appointment template from "pediatrician" ------
  {
    const routed = routeChatIntent({
      message: DRAFT_REQUEST,
      coparents: [kevin],
      children: [ashley],
      today: TODAY,
    });
    const drafts = routed.result.plan.proposals.filter((proposal) => proposal.type === "reply_coparent");
    assert.equal(drafts.length, 0, "no message card from a medical noun");
    assert.equal(
      routed.result.plan.proposals.some((proposal) => /doctor appointment/i.test(proposal.draft ?? "")),
      false
    );
    assert.equal(isMessageDraftRequest(DRAFT_REQUEST), true);
  }

  // --- ContextFrame keeps parent, Sage, and co-parent statements apart -------------------------------
  {
    const frame = buildContextFrame({
      parentId: "parent-ashley",
      caseId: "case-1",
      sessionId: "session-ashley",
      message: DRAFT_REQUEST,
      recentTurns: [
        ...PEDIATRICIAN_TURNS,
        { role: "parent", text: "Kevin said the old office will not accept us over vaccines." },
      ],
      children: [ashley],
      coparents: [kevin],
    });
    assert.equal(frame.parentId, "parent-ashley");
    assert.equal(frame.caseId, "case-1");
    assert.equal(frame.sessionId, "session-ashley");
    assert.ok(frame.capabilities.includes("message"));
    assert.equal(hasConversationSubstance(frame), true);
    assert.ok(relevantParentFacts(frame).some((fact) => /have not agreed on a new pediatrician/i.test(fact.text)));
    assert.ok(sageOnlyFacts(frame).every((fact) => fact.speaker === "sage"));
    assert.ok(sageOnlyFacts(frame).some((fact) => /That sounds hard/i.test(fact.text)));
    assert.equal(
      frame.facts.some((fact) => fact.speaker === "parent" && /That sounds hard/i.test(fact.text)),
      false,
      "Sage's wording is not stored as a parent fact"
    );
    assert.deepEqual(coparentFacts(frame), []);
    assert.equal(hasEstablishedSchedule(emptyConversation()), false);
    assert.equal(
      hasEstablishedSchedule({
        thread_subject: null,
        event: { subject: "Doctor Appointment", child: "Ashley", date: null, time: null, eventId: null },
        open_proposals: [],
      }),
      false,
      "a medical noun in the event subject is not a scheduled event"
    );
    assert.equal(
      hasEstablishedSchedule({
        thread_subject: "OT",
        event: { subject: "OT appointment", child: "Ashley", date: "2026-10-20", time: "4:30 PM", eventId: "evt-ot" },
        open_proposals: [],
      }),
      true
    );
  }

  // --- The confirmed pediatrician failure -----------------------------------------------------------
  {
    const spoken = actionModel();
    const result = await chat(DRAFT_REQUEST, { action: spoken.model });
    const card = result.result.plan.proposals.find((proposal) => proposal.type === "reply_coparent");
    assert.ok(card, "the request is identified as message drafting");
    assert.equal(result.result.plan.proposals.some((proposal) => proposal.type === "calendar_update"), false);
    assert.equal(card.requires_approval, true);
    const stored = card as { executed?: unknown; approved?: unknown };
    assert.equal(stored.executed, undefined);
    assert.equal(stored.approved, undefined);
    assert.equal(card.recipient_email, "kevin@example.com");
    assert.equal(card.draft_origin, "sage_wording");
    assert.doesNotMatch(card.draft ?? "", APPOINTMENT_TEMPLATE);
    assert.doesNotMatch(card.draft ?? "", /has a doctor appointment/i);
    assert.match(card.draft ?? "", /pediatrician/i);
    assert.match(card.draft ?? "", /vaccin/i);
    assert.match(card.draft ?? "", /in writing|clarify/i);
    assert.doesNotMatch(card.draft ?? "", /refuses|will not consider/i);
    assert.match(result.reply, /Nothing is sent until you review it and choose Send/i);
    assert.equal(spoken.frames.length, 1, "the earlier conversation reached the interpreter");
    const parentLines = spoken.frames[0].facts.filter((fact) => fact.speaker === "parent").map((fact) => fact.text);
    assert.ok(parentLines.some((line) => /have not agreed on a new pediatrician/i.test(line)));
    assert.ok(parentLines.some((line) => /two other pediatrician options/i.test(line)));
    assert.ok(parentLines.some((line) => /vaccination policy/i.test(line)));
    assert.ok(spoken.frames[0].facts.some((fact) => fact.speaker === "sage"));
    assert.equal(draftUsesConversation(card.draft ?? "", { ...spoken.frames[0], interpretation: {
      kind: "message",
      outcome: "Ask Kevin to clarify in writing whether agreement on a new pediatrician depends on vaccination decisions.",
      refersTo: "the ongoing pediatrician disagreement",
      grounding: "conversation",
      relevantFactIndexes: [],
      uncertain: [],
      disputed: [],
      recipientName: "Kevin",
    } }), true);
  }

  // --- "Can you draft something?" after the same conversation --------------------------------------
  {
    const spoken = actionModel();
    const result = await chat("Can you draft something?", { action: spoken.model });
    const card = result.result.plan.proposals.find((proposal) => proposal.type === "reply_coparent");
    assert.ok(card);
    assert.doesNotMatch(card.draft ?? "", APPOINTMENT_TEMPLATE);
    assert.match(card.draft ?? "", /pediatrician/i);
    assert.equal(spoken.frames[0].requestText, "Can you draft something?");
  }

  // --- A new unrelated request after the same conversation -----------------------------------------
  {
    const spoken = actionModel({ kind: "calendar" });
    const result = await chat("Add Ashley's dentist on Friday at 3:00 PM.", { action: spoken.model });
    assert.ok(result.result.plan.proposals.some((proposal) => proposal.type === "calendar_update"));
    assert.equal(
      result.result.plan.proposals.some((proposal) => proposal.type === "reply_coparent"),
      false,
      "a calendar request does not draft the pediatrician message"
    );
  }

  // --- The parent changes their mind about the desired action --------------------------------------
  {
    const spoken = actionModel({ kind: "expense" });
    const result = await chat("I paid $85 for Ashley's dentist visit instead.", { action: spoken.model });
    assert.ok(result.result.plan.proposals.some((proposal) => proposal.type === "log_expense"));
    assert.equal(result.result.plan.proposals.some((proposal) => proposal.type === "reply_coparent"), false);
  }

  // --- Two parents, two private histories ----------------------------------------------------------
  {
    const db = new FakeDb();
    db.seed("sage_journal_messages", [
      {
        id: "a1",
        session_id: "session-ashley",
        user_id: "parent-ashley",
        role: "user",
        content: "Kevin will not consider the pediatrician options I sent.",
      },
      {
        id: "k1",
        session_id: "session-kevin",
        user_id: "parent-kevin",
        role: "user",
        content: "I need to talk about the soccer schedule privately.",
      },
    ]);
    const admin = db as unknown as Parameters<typeof loadSessionTurns>[0];
    const ashleyTurns = await loadSessionTurns(admin, "session-ashley", "parent-ashley", "now", {
      limit: 16,
      maxChars: 800,
    });
    const kevinTurns = await loadSessionTurns(admin, "session-kevin", "parent-kevin", "now", {
      limit: 16,
      maxChars: 800,
    });
    const ashleyFrame = buildContextFrame({
      parentId: "parent-ashley",
      caseId: "case-1",
      sessionId: "session-ashley",
      message: DRAFT_REQUEST,
      recentTurns: ashleyTurns,
    });
    const kevinFrame = buildContextFrame({
      parentId: "parent-kevin",
      caseId: "case-1",
      sessionId: "session-kevin",
      message: "Can you draft something?",
      recentTurns: kevinTurns,
    });
    assert.ok(ashleyFrame.facts.some((fact) => /pediatrician/i.test(fact.text)));
    assert.equal(ashleyFrame.facts.some((fact) => /soccer/i.test(fact.text)), false);
    assert.ok(kevinFrame.facts.some((fact) => /soccer/i.test(fact.text)));
    assert.equal(kevinFrame.facts.some((fact) => /pediatrician/i.test(fact.text)), false);
  }

  // --- Missing or conflicting context --------------------------------------------------------------
  {
    const missing = actionModel({ kind: "message" });
    missing.model.interpret = async (frame) => {
      missing.frames.push(frame);
      return {
        kind: "message",
        outcome: "",
        refersTo: null,
        grounding: "insufficient",
        relevantFactIndexes: [],
        uncertain: ["what the message should say"],
        disputed: [],
        recipientName: "Kevin",
      };
    };
    const asked = await chat("Please draft a message to Kevin.", {
      action: missing.model,
      recentTurns: [],
      conversation: emptyConversation(),
    });
    assert.equal(asked.result.plan.proposals.some((proposal) => proposal.type === "reply_coparent"), false);
    assert.ok(asked.result.plan.proposals.some((proposal) => proposal.type === "ask_clarification"));
    assert.doesNotMatch(asked.reply, APPOINTMENT_TEMPLATE);

    const conflict = actionModel();
    const conflictDraft = await chat(DRAFT_REQUEST, { action: conflict.model });
    const conflictCard = conflictDraft.result.plan.proposals.find((proposal) => proposal.type === "reply_coparent");
    assert.ok(conflictCard);
    assert.doesNotMatch(conflictCard.draft ?? "", /he refuses/i);
    assert.ok(conflict.frames[0].facts.every((fact) => fact.speaker !== "coparent"));
  }

  // --- Model failure: ask, never fall back to the appointment template -----------------------------
  {
    const failed = actionModel({ failInterpret: true });
    const result = await chat(DRAFT_REQUEST, { action: failed.model });
    assert.equal(result.result.plan.proposals.some((proposal) => proposal.type === "reply_coparent"), false);
    assert.doesNotMatch(result.reply, APPOINTMENT_TEMPLATE);
    assert.match(result.reply, /What should I tell Kevin|will not invent/i);

    const draftFailed = actionModel({ failDraft: true });
    const asked = await chat(DRAFT_REQUEST, { action: draftFailed.model });
    assert.equal(asked.result.plan.proposals.some((proposal) => proposal.type === "reply_coparent"), false);
    assert.doesNotMatch(asked.reply, APPOINTMENT_TEMPLATE);
  }

  // --- Established calendar notify still works -----------------------------------------------------
  {
    const result = await chat("Can you let him know?", {
      action: null,
      recentTurns: [],
      conversation: {
        thread_subject: "Ashley OT",
        event: { subject: "OT appointment", child: "Ashley", date: "2026-10-20", time: "4:30 PM", eventId: "evt-ot" },
        open_proposals: [{ type: "calendar_update", text: "Add to calendar: Ashley, OT appointment." }],
      },
    });
    const card = result.result.plan.proposals.find((proposal) => proposal.type === "reply_coparent");
    assert.ok(card);
    assert.match(card.draft ?? "", /OT appointment/i);
    assert.doesNotMatch(card.draft ?? "", APPOINTMENT_TEMPLATE);
    assert.equal("executed" in card, false);
  }

  // --- Parsers --------------------------------------------------------------------------------------
  {
    assert.equal(parseActionInterpretation("not json"), null);
    const parsed = parseActionInterpretation(
      '{"kind":"message","outcome":"Ask for his position.","refersTo":"pediatrician","grounding":"conversation","relevantFactIndexes":[0,2],"uncertain":["timing"],"disputed":["refusal"],"recipientName":"Kevin"}'
    );
    assert.equal(parsed?.kind, "message");
    assert.equal(parsed?.grounding, "conversation");
    assert.equal(cleanDraft("INSUFFICIENT"), null);
    assert.equal(cleanDraft("Please confirm your position on the pediatrician options."), "Please confirm your position on the pediatrician options.");
  }

  console.log("conversation-action tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
