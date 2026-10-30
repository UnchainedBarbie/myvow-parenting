import assert from "node:assert/strict";
import { FakeDb } from "@/lib/messages/fake-admin";
import { processChatMessage } from "@/lib/sage/chat";
import { isMessageDraftRequest, routeChatIntent, type KnownCoparent } from "@/lib/sage/chat-intent";
import {
  buildContextFrame,
  conversationSupportsDraft,
  coparentFacts,
  hasConversationSubstance,
  hasEstablishedSchedule,
  relevantParentFacts,
  sageOnlyFacts,
  type ActionGrounding,
  type ContextFrame,
} from "@/lib/sage/context-frame";
import {
  cleanDraft,
  draftableOutcome,
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

const OPEN_POSITION_DRAFT =
  "Please tell me in writing whether agreement on a new pediatrician depends on vaccination decisions, and whether you are willing to consider the other pediatrician options. I am asking for your actual position so we can document it. I am not asking you to confirm any legal conclusion.";

const ASK_HIM =
  "I want to ask him a question that confirms he is using coercive control so I can use that in court.";

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
  kind?: "message" | "calendar" | "expense" | "document" | "conversation";
  draft?: string | null;
  grounding?: ActionGrounding;
  recipientName?: string | null;
  elicitation?: "open_question" | "predetermined_admission" | null;
  outcome?: string;
  refersTo?: string | null;
}): { model: ConversationActionModel; frames: ContextFrame[]; draftFrames: ContextFrame[] } {
  const frames: ContextFrame[] = [];
  const draftFrames: ContextFrame[] = [];
  return {
    frames,
    draftFrames,
    model: {
      interpret: async (frame) => {
        frames.push(frame);
        if (opts?.failInterpret) return null;
        const kind = opts?.kind ?? "message";
        return {
          kind,
          outcome:
            opts?.outcome ??
            (kind === "message"
              ? "Ask Kevin to clarify in writing whether agreement on a new pediatrician depends on vaccination decisions."
              : kind === "expense"
                ? "Log the dentist expense."
                : kind === "calendar"
                  ? "Add the dentist visit to the calendar."
                  : kind === "document"
                    ? "File the document."
                    : "Continue the conversation."),
          refersTo: opts?.refersTo ?? (kind === "message" ? "the ongoing pediatrician disagreement" : null),
          grounding:
            opts?.grounding ??
            (kind === "message" ? "conversation" : kind === "calendar" ? "calendar_event" : "insufficient"),
          relevantFactIndexes: frame.facts
            .map((fact, index) => (fact.speaker === "parent" ? index : -1))
            .filter((index) => index >= 0),
          uncertain: ["whether Kevin will agree"],
          disputed: ["that Kevin refuses to consider the options", "the previous practice's vaccination policy"],
          recipientName: opts?.recipientName === undefined ? "Kevin" : opts.recipientName,
          elicitation: opts?.elicitation ?? (kind === "message" ? "open_question" : null),
        };
      },
      draftMessage: async (frame) => {
        draftFrames.push(frame);
        if (opts?.failDraft) return null;
        if (opts?.draft !== undefined) return opts.draft;
        if (frame.interpretation?.elicitation === "predetermined_admission") return OPEN_POSITION_DRAFT;
        return CONVERSATION_DRAFT;
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
    assert.equal(conversationSupportsDraft(frame), true);
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
      elicitation: "open_question",
    } }), true);
  }

  // --- Indirect and referential draft requests after the same conversation -------------------------
  {
    assert.equal(isMessageDraftRequest("I want to ask him a question."), false);
    assert.equal(isMessageDraftRequest("Can you draft that?"), false);
    assert.equal(isMessageDraftRequest("Write something based on what we discussed."), false);
    assert.equal(isMessageDraftRequest(ASK_HIM), false);

    for (const phrasing of [
      "I want to ask him a question.",
      "Can you draft that?",
      "Write something based on what we discussed.",
      "Can you draft something?",
    ]) {
      const spoken = actionModel();
      const result = await chat(phrasing, { action: spoken.model });
      const card = result.result.plan.proposals.find((proposal) => proposal.type === "reply_coparent");
      assert.ok(card, phrasing);
      assert.doesNotMatch(card.draft ?? "", APPOINTMENT_TEMPLATE);
      assert.match(card.draft ?? "", /pediatrician/i);
      assert.match(card.draft ?? "", /vaccin/i);
      assert.equal(card.requires_approval, true);
      assert.equal("executed" in card, false);
      assert.match(result.reply, /Nothing is sent until you review it and choose Send/i);
      assert.equal(spoken.frames[0].requestText, phrasing);
    }
  }

  // --- Live failure: the current sentence is ethically loaded, but the discussion is already there ---
  {
    const spoken = actionModel({
      grounding: "insufficient",
      outcome: "Confirm that he is using coercive control, for court.",
      recipientName: "him",
      elicitation: "predetermined_admission",
      refersTo: "whether agreement on a new pediatrician depends on vaccination decisions",
    });
    const result = await chat(ASK_HIM, { action: spoken.model });
    const card = result.result.plan.proposals.find((proposal) => proposal.type === "reply_coparent");
    assert.ok(card, "established facts are enough to draft; the current sentence is not a missing detail");
    assert.equal(result.result.plan.proposals.some((proposal) => proposal.type === "ask_clarification"), false);
    assert.doesNotMatch(result.reply, /What should I tell/);
    assert.equal(card.recipient_email, "kevin@example.com");
    assert.equal(card.requires_approval, true);
    assert.equal("executed" in card, false);
    assert.doesNotMatch(card.draft ?? "", APPOINTMENT_TEMPLATE);
    assert.doesNotMatch(card.draft ?? "", /has a doctor appointment/i);
    assert.match(card.draft ?? "", /pediatrician/i);
    assert.match(card.draft ?? "", /vaccin/i);
    assert.match(card.draft ?? "", /position|in writing|whether/i);
    assert.doesNotMatch(card.draft ?? "", /coercive control/i);
    assert.doesNotMatch(card.draft ?? "", /\badmit\b|\badmission\b/i);
    assert.doesNotMatch(card.draft ?? "", /confirm that you are/i);
    assert.match(spoken.draftFrames[0].interpretation?.outcome ?? "", /position/i);
    assert.doesNotMatch(spoken.draftFrames[0].interpretation?.outcome ?? "", /coercive control/i);
    assert.equal(spoken.draftFrames[0].interpretation?.elicitation, "predetermined_admission");
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

  // --- A document request after the same conversation does not draft the earlier message -----------
  {
    const spoken = actionModel({ kind: "document" });
    const result = await chat("Save the dentist receipt in the document library.", { action: spoken.model });
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
        elicitation: null,
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

    const ambiguous = actionModel({ kind: "conversation" });
    const unclear = await chat("Can you help with that?", {
      action: ambiguous.model,
      recentTurns: [],
      conversation: emptyConversation(),
    });
    assert.equal(unclear.result.plan.proposals.some((proposal) => proposal.type === "reply_coparent"), false);
    assert.doesNotMatch(unclear.reply, APPOINTMENT_TEMPLATE);

    const twoRecipients = actionModel({ recipientName: "him" });
    const who = await chat("I want to ask him a question.", {
      action: twoRecipients.model,
      coparents: [kevin, { name: "Alex", email: "alex@example.com" }],
    });
    assert.equal(who.result.plan.proposals.some((proposal) => proposal.type === "reply_coparent"), false);
    assert.match(who.reply, /Who should I send that to/i);

    const conflict = actionModel();
    const conflictDraft = await chat(DRAFT_REQUEST, { action: conflict.model });
    const conflictCard = conflictDraft.result.plan.proposals.find((proposal) => proposal.type === "reply_coparent");
    assert.ok(conflictCard);
    assert.doesNotMatch(conflictCard.draft ?? "", /he refuses/i);
    assert.ok(conflict.frames[0].facts.every((fact) => fact.speaker !== "coparent"));
  }

  // --- Model failure -------------------------------------------------------------------------------
  {
    const failed = actionModel({ failInterpret: true });
    const result = await chat(DRAFT_REQUEST, { action: failed.model });
    const recovered = result.result.plan.proposals.find((proposal) => proposal.type === "reply_coparent");
    assert.ok(recovered, "parent facts are enough to draft when interpretation fails");
    assert.match(recovered.draft ?? "", /pediatrician/i);
    assert.doesNotMatch(recovered.draft ?? "", APPOINTMENT_TEMPLATE);
    assert.equal(recovered.requires_approval, true);

    const draftFailed = actionModel({ failDraft: true });
    const asked = await chat(DRAFT_REQUEST, { action: draftFailed.model });
    assert.equal(asked.result.plan.proposals.some((proposal) => proposal.type === "reply_coparent"), false);
    assert.doesNotMatch(asked.reply, APPOINTMENT_TEMPLATE);
    assert.match(asked.reply, /What should I tell Kevin|will not invent/i);

    const bothFailed = actionModel({ failInterpret: true, failDraft: true });
    const bothAsked = await chat(DRAFT_REQUEST, { action: bothFailed.model });
    assert.equal(bothAsked.result.plan.proposals.some((proposal) => proposal.type === "reply_coparent"), false);
    assert.doesNotMatch(bothAsked.reply, APPOINTMENT_TEMPLATE);
    assert.match(bothAsked.reply, /What should I tell Kevin|will not invent/i);
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

    const withModel = actionModel({ failInterpret: true });
    const kept = await chat("Can you let him know?", {
      action: withModel.model,
      recentTurns: [],
      conversation: {
        thread_subject: "Ashley OT",
        event: { subject: "OT appointment", child: "Ashley", date: "2026-10-20", time: "4:30 PM", eventId: "evt-ot" },
        open_proposals: [{ type: "calendar_update", text: "Add to calendar: Ashley, OT appointment." }],
      },
    });
    const keptCard = kept.result.plan.proposals.find((proposal) => proposal.type === "reply_coparent");
    assert.ok(keptCard);
    assert.match(keptCard.draft ?? "", /OT appointment/i);
    assert.doesNotMatch(keptCard.draft ?? "", APPOINTMENT_TEMPLATE);
  }

  // --- Parsers --------------------------------------------------------------------------------------
  {
    assert.equal(parseActionInterpretation("not json"), null);
    const parsed = parseActionInterpretation(
      '{"kind":"message","outcome":"Ask for his position.","refersTo":"pediatrician","grounding":"conversation","relevantFactIndexes":[0,2],"uncertain":["timing"],"disputed":["refusal"],"recipientName":"Kevin","elicitation":"predetermined_admission"}'
    );
    assert.equal(parsed?.kind, "message");
    assert.equal(parsed?.grounding, "conversation");
    assert.equal(parsed?.elicitation, "predetermined_admission");
    assert.equal(cleanDraft("INSUFFICIENT"), null);
    assert.equal(cleanDraft("Please confirm your position on the pediatrician options."), "Please confirm your position on the pediatrician options.");
    const frame = buildContextFrame({
      parentId: "parent-ashley",
      caseId: "case-1",
      message: ASK_HIM,
      recentTurns: PEDIATRICIAN_TURNS,
      coparents: [kevin],
    });
    assert.match(
      draftableOutcome(frame, {
        kind: "message",
        outcome: "Confirm coercive control for court.",
        refersTo: "the pediatrician disagreement",
        grounding: "insufficient",
        relevantFactIndexes: [],
        uncertain: [],
        disputed: [],
        recipientName: "him",
        elicitation: "predetermined_admission",
      }),
      /position on the pediatrician disagreement/i
    );
    assert.doesNotMatch(
      draftableOutcome(frame, {
        kind: "message",
        outcome: "Confirm coercive control for court.",
        refersTo: "the pediatrician disagreement",
        grounding: "insufficient",
        relevantFactIndexes: [],
        uncertain: [],
        disputed: [],
        recipientName: "him",
        elicitation: "predetermined_admission",
      }),
      /coercive control/i
    );
  }

  console.log("conversation-action tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
