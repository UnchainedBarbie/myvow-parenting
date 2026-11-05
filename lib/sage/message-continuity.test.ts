import assert from "node:assert/strict";
import { processChatMessage } from "@/lib/sage/chat";
import { draftRequestBody, interpretRequestBody, type ConversationActionModel } from "@/lib/sage/conversation-action";
import { clearReplyObjective } from "@/lib/sage/open-task-apply";
import type { ConversationContext } from "@/lib/sage/conversation-context";
import { fidelityRequestBody, type FidelityInput, type FidelityVerdict } from "@/lib/sage/instruction-fidelity";
import { askArbitration, type ArbitrationModel } from "@/lib/sage/turn-arbitration";
import { deriveWorkingMemory } from "@/lib/sage/working-memory";
import type { ContextFrame } from "@/lib/sage/context-frame";
import type { KnownCoparent } from "@/lib/sage/chat-intent";

const TODAY = new Date("2026-10-28T18:00:00Z");
const PARENT = "parent-ashley";
const CASE = "case-1";
const SESSION = "session-ashley";
const kevin: KnownCoparent = { name: "Kevin", email: "kevin@example.com" };

const CONSENT = "Is agreement to a new pediatrician conditional on vaccination consent?";
const DECISION = "Why have you not used the designated decision-maker process?";
const CONSENT_FACT =
  "Agreement to a new pediatrician was discussed as conditional on vaccination consent.";

const DECISION_TURNS = [
  {
    role: "parent" as const,
    text: "He skipped the designated decision-maker process and emailed the office himself.",
  },
  { role: "sage" as const, text: "Do you want to ask why he did not follow that process?" },
];

const consentObjective = {
  outcome: "Obtain his written position on a new pediatrician.",
  question: CONSENT,
  turns: [] as number[],
  facts: [{ text: CONSENT_FACT, status: "parent_stated" }],
  uncertain: [] as string[],
  private_constraints: [] as string[],
  rejected: [] as string[],
  last_guidance: "",
  evidence_refs: [] as string[],
};

function blockText(content: string, label: string): string {
  return content.split(`${label}_BEGIN`)[1]?.split(`${label}_END`)[0] ?? "";
}

function promptHasConsent(content: string): boolean {
  return /vaccination consent/i.test(blockText(content, "ESTABLISHED_OBJECTIVES")) ||
    /vaccination consent/i.test(blockText(content, "PARENT_FACTS")) ||
    /vaccination consent/i.test(blockText(content, "STORED_QUESTION")) ||
    /vaccination consent/i.test(blockText(content, "PARENT_TURNS"));
}

function conversationWith(
  ...items: { id: string; itemType: string; proposals: Record<string, unknown>[] }[]
): ConversationContext {
  return {
    thread_subject: null,
    event: { subject: null, child: null, date: null, time: null, eventId: null },
    open_proposals: items.flatMap((item) =>
      item.proposals
        .filter((row) => row.type !== "ask_clarification" && row.type !== "note_only")
        .map((row) => ({
          type: String(row.type),
          text: String(row.revised_text ?? row.draft ?? ""),
        }))
    ),
    memory: deriveWorkingMemory(
      items.map((item) => ({ itemId: item.id, itemType: item.itemType, proposals: item.proposals }))
    ),
  };
}

function canceledConsent() {
  return {
    id: "item-consent",
    itemType: "message",
    proposals: [
      {
        id: "consent-1",
        type: "reply_coparent",
        draft: CONSENT,
        status: "canceled",
        requires_approval: true,
        private_objective: consentObjective.outcome,
        grounded_in: consentObjective,
      },
    ],
  };
}

function liveConsent(draft = CONSENT) {
  return {
    id: "item-live",
    itemType: "message",
    proposals: [
      {
        id: "live-1",
        type: "reply_coparent",
        draft,
        requires_approval: true,
        private_objective: consentObjective.outcome,
        grounded_in: { ...consentObjective },
      },
    ],
  };
}

type Reading = {
  kind: "message";
  outcome: string;
  question: string;
  refersTo: string | null;
  grounding: "conversation";
  relevantFactIndexes: number[];
  uncertain: string[];
  disputed: string[];
  recipientName: string;
  elicitation: "open_question";
  privateConstraints: string[];
  outcomeChanged: boolean;
  establishedTaskId: string | null;
};

function reading(question: string, outcomeChanged: boolean, taskId: string | null): Reading {
  const consent = question === CONSENT;
  return {
    kind: "message",
    outcome: consent
      ? "Obtain his written position on whether a new pediatrician depends on vaccination consent."
      : "Ask why the designated decision-maker process was not used.",
    question,
    refersTo: consent ? "the pediatrician discussion" : "the decision-maker discussion",
    grounding: "conversation",
    relevantFactIndexes: [],
    uncertain: [],
    disputed: [],
    recipientName: "Kevin",
    elicitation: "open_question",
    privateConstraints: [],
    outcomeChanged,
    establishedTaskId: taskId,
  };
}

/**
 * Returns the decision-maker question unless the interpret prompt actually contains
 * the vaccination-consent objective. A drifted reading omits outcomeChanged.
 */
function interpretUnlessSupplied(frame: ContextFrame): Reading {
  const content = String(interpretRequestBody(frame).messages[0].content);
  const supplied = /vaccination consent/i.test(blockText(content, "ESTABLISHED_OBJECTIVES"));
  const replacing = /do not ask about vaccination consent/i.test(frame.requestText);
  if (supplied && !replacing) return reading(CONSENT, false, "item-consent");
  return reading(DECISION, replacing, supplied ? "item-consent" : null);
}

function draftFromPrompt(frame: ContextFrame): string {
  const content = String(draftRequestBody(frame).messages[0].content);
  const question = frame.taskObjective?.question ?? "";
  if (/more direct/i.test(frame.requestText) && /vaccination consent/i.test(question)) {
    return `Please answer directly: ${question}`;
  }
  if (promptHasConsent(content) && /vaccination consent/i.test(question)) return question;
  if (promptHasConsent(content) && /do not ask about vaccination consent/i.test(frame.requestText)) return question;
  return DECISION;
}

function pass(): FidelityVerdict {
  return {
    fulfills: true,
    missed: [],
    correctedQuestion: null,
    correctedOutcome: null,
    privateLeak: false,
    unsupported: [],
  };
}

function rejectConsent(): FidelityVerdict {
  return {
    fulfills: false,
    missed: ["The draft does not ask whether agreement is conditional on vaccination consent."],
    correctedQuestion: CONSENT,
    correctedOutcome: null,
    privateLeak: false,
    unsupported: [],
  };
}

/**
 * A decision-maker draft passes only when the consent objective was not in the review.
 * A draft that drops that objective fails when the review was given it.
 */
function reviewDraft(input: FidelityInput): FidelityVerdict {
  const rendered = String(fidelityRequestBody(input).messages[0].content);
  const supplied = promptHasConsent(rendered);
  const asksConsent = /vaccination consent/i.test(input.draft);
  if (supplied && !asksConsent) return rejectConsent();
  return pass();
}

function messageCard(result: { result: { plan: { proposals: { type: string }[] } } }) {
  return result.result.plan.proposals.find((proposal) => proposal.type === "reply_coparent") as
    | {
        draft?: string;
        requires_approval?: boolean;
        approved?: boolean;
        executed?: boolean;
        validation_status?: string;
        private_objective?: string;
        grounded_in?: { question?: string; history?: { question: string; provenance: string }[] };
      }
    | undefined;
}

function assertHeld(card: { requires_approval?: boolean; approved?: boolean; executed?: boolean } | undefined) {
  assert.equal(card?.requires_approval, true);
  assert.equal(card?.approved, undefined);
  assert.equal(card?.executed, undefined);
}

async function chat(
  message: string,
  over: {
    conversation?: ConversationContext | null;
    action?: ConversationActionModel | null;
    arbitration?: ArbitrationModel | null;
    recentTurns?: { role: "parent" | "sage"; text: string }[];
  } = {}
) {
  return processChatMessage({
    message,
    case_id: CASE,
    timezone: "America/Denver",
    conversation: over.conversation ?? null,
    coparents: [kevin],
    children: [{ id: "child-1", name: "Ashley Example" }],
    viewerId: PARENT,
    viewerRole: "parent",
    recentTurns: over.recentTurns ?? DECISION_TURNS,
    sessionId: SESSION,
    reasonAboutDocument: null,
    shadow: false,
    today: TODAY,
    conversationModel: null,
    conversationActionModel: over.action === undefined ? null : over.action,
    arbitrationModel: over.arbitration === undefined ? null : over.arbitration,
  });
}

async function main() {
  delete process.env.ANTHROPIC_API_KEY;

  const supplied: ConversationActionModel = {
    interpret: async (frame) => interpretUnlessSupplied(frame),
    draftMessage: async (frame) => draftFromPrompt(frame),
    evaluateFidelity: async (input) => reviewDraft(input),
  };

  const drafted = await chat("Draft a message to my co-parent about the pediatrician.", {
    action: supplied,
    arbitration: {
      classify: async () => {
        throw new Error("a new message with no live draft does not ask which message");
      },
    },
    conversation: conversationWith(canceledConsent()),
  });
  const consentCard = messageCard(drafted);
  assert.equal(consentCard?.draft, CONSENT);
  assert.match(drafted.reply, /Nothing is sent until you review it and choose Send/);
  assert.doesNotMatch(drafted.reply, /which message|separate message|will not guess|could not verify/i);
  assert.doesNotMatch(consentCard?.draft ?? "", /decision-maker process|could not verify/i);
  assertHeld(consentCard);

  const withoutObjective = await chat("Draft a message to my co-parent about the pediatrician.", {
    action: supplied,
    conversation: null,
  });
  const decisionCard = messageCard(withoutObjective);
  assert.equal(decisionCard?.draft, DECISION);
  assert.doesNotMatch(decisionCard?.draft ?? "", /vaccination consent/i);

  const drifted: ConversationActionModel = {
    interpret: async () => reading(DECISION, false, null),
    draftMessage: async (frame) => {
      const question = frame.taskObjective?.question ?? "";
      return /vaccination consent/i.test(question) ? question : DECISION;
    },
  };
  const kept = await chat("Draft a message to my co-parent about the pediatrician.", {
    action: drifted,
    conversation: conversationWith(canceledConsent()),
  });
  const keptCard = messageCard(kept);
  assert.equal(keptCard?.draft, CONSENT);
  assert.doesNotMatch(kept.reply, /separate message|which message/i);
  assertHeld(keptCard);

  const replaced = await chat(
    "Do not ask about vaccination consent. Ask why he did not use the designated decision-maker process.",
    {
      action: {
        interpret: async (frame) => interpretUnlessSupplied(frame),
        draftMessage: async (frame) => draftFromPrompt(frame),
      },
      conversation: conversationWith(canceledConsent()),
    }
  );
  const replacedCard = messageCard(replaced) as {
    draft?: string;
    grounded_in?: { question?: string; history?: { question: string; provenance: string }[] };
    requires_approval?: boolean;
    approved?: boolean;
    executed?: boolean;
  };
  assert.equal(replacedCard?.draft, DECISION);
  assert.equal(replacedCard?.grounded_in?.question, DECISION);
  const prior = replacedCard?.grounded_in?.history ?? [];
  assert.ok(prior.some((item) => item.question === CONSENT));
  assert.match(prior.find((item) => item.question === CONSENT)?.provenance ?? "", /task item-consent \(canceled\)/);
  assert.doesNotMatch(replacedCard?.draft ?? "", /vaccination consent/i);
  assertHeld(replacedCard);

  const live = liveConsent(CONSENT);
  const direct = await chat("Make it more direct.", {
    action: supplied,
    arbitration: { classify: async () => askArbitration() },
    conversation: conversationWith(live),
  });
  const directCard = messageCard(direct);
  assert.match(directCard?.draft ?? "", /Please answer directly:/);
  assert.match(directCard?.draft ?? "", /vaccination consent/i);
  assert.doesNotMatch(direct.reply, /separate message|which message|which one/i);
  assertHeld(directCard);

  let arbitrationCalls = 0;
  const canceled = await chat("Cancel that message.", {
    action: supplied,
    arbitration: {
      classify: async () => {
        arbitrationCalls += 1;
        throw new Error("arbitration must not run after the router resolves cancel");
      },
    },
    conversation: conversationWith(live),
  });
  assert.equal(arbitrationCalls, 0);
  assert.match(canceled.reply, /canceled that message/i);
  assert.doesNotMatch(canceled.reply, /which message|separate message|which one/i);
  assert.equal(canceled.control, "cancel_message");

  const glasses = {
    id: "item-glasses",
    itemType: "message",
    proposals: [
      {
        id: "g1",
        type: "reply_coparent",
        draft: "Can you take Ashley to get glasses on Thursday?",
        requires_approval: true,
      },
    ],
  };
  const several = await chat("Please revise the message.", {
    action: {
      interpret: async () => reading(DECISION, false, null),
      draftMessage: async () => {
        throw new Error("two live drafts must not be rewritten");
      },
    },
    arbitration: { classify: async () => askArbitration() },
    conversation: conversationWith(live, glasses),
  });
  assert.equal(several.taskDecision.relation, "ask");
  assert.match(several.reply, /more than one message/i);
  assert.equal(messageCard(several), undefined);

  let reviews = 0;
  let drafts = 0;
  const repaired = await chat("Draft a message to my co-parent about the pediatrician.", {
    action: {
      interpret: async (frame) => interpretUnlessSupplied(frame),
      draftMessage: async (frame) => {
        drafts += 1;
        if (frame.correctingMissedQuestion) return CONSENT;
        return `${CONSENT} He should admit he ignored the designated process.`;
      },
      evaluateFidelity: async () => {
        reviews += 1;
        return reviews === 1 ? rejectConsent() : pass();
      },
    },
    conversation: conversationWith(canceledConsent()),
  });
  assert.equal(reviews, 2);
  assert.equal(drafts, 2);
  assert.equal(messageCard(repaired)?.draft, CONSENT);
  assert.doesNotMatch(messageCard(repaired)?.draft ?? "", /admit/i);
  assert.doesNotMatch(repaired.reply, /could not verify/i);
  assertHeld(messageCard(repaired));

  reviews = 0;
  drafts = 0;
  const rejected = await chat("Draft a message to my co-parent about the pediatrician.", {
    action: {
      interpret: async (frame) => interpretUnlessSupplied(frame),
      draftMessage: async () => {
        drafts += 1;
        return `${CONSENT} He should admit he ignored the designated process.`;
      },
      evaluateFidelity: async () => {
        reviews += 1;
        return rejectConsent();
      },
    },
    conversation: conversationWith(canceledConsent()),
  });
  assert.equal(reviews, 2);
  assert.equal(drafts, 2);
  // The body can still be sent, so the review failure keeps it and leaves the objective in place.
  const rejectedCard = messageCard(rejected);
  assert.match(rejectedCard?.draft ?? "", /He should admit/i);
  assert.equal(rejected.clearMessageObjective, null);
  assert.doesNotMatch(rejected.reply, /What should the message ask\?/);
  assert.match(rejected.reply, /Nothing is sent until you review it and choose Send/);

  reviews = 0;
  drafts = 0;
  const unverified = await chat("Draft a message to my co-parent about the pediatrician.", {
    action: {
      interpret: async (frame) => interpretUnlessSupplied(frame),
      draftMessage: async (frame) => {
        drafts += 1;
        const question = frame.taskObjective?.question ?? "";
        return /vaccination consent/i.test(question) ? question : DECISION;
      },
      evaluateFidelity: async () => {
        reviews += 1;
        throw new Error("review service unavailable");
      },
    },
    conversation: conversationWith(canceledConsent()),
  });
  const unverifiedCard = messageCard(unverified) as {
    draft?: string;
    validation_status?: string;
    requires_approval?: boolean;
    approved?: boolean;
    executed?: boolean;
  };
  assert.equal(reviews, 1);
  assert.equal(drafts, 1);
  assert.equal(unverifiedCard?.draft, CONSENT);
  assert.doesNotMatch(unverifiedCard?.draft ?? "", /could not verify/i);
  assert.equal(unverifiedCard?.validation_status, "unverified");
  assert.match(unverified.reply, /Nothing is sent until you review it and choose Send/);
  assert.match(unverified.reply, /could not verify that this draft matches what you asked/i);
  assertHeld(unverifiedCard);

  // A terminal review failure clears that message task's objective. The next,
  // unrelated request is drafted. The same request still gets the clarification
  // sentence while the old objective remains. A purpose question does not clear it.
  const NEW_REQUEST = "Ask him why he did not use the designated decision-maker process.";
  const UNUSABLE =
    "I don't yet have a draft that matches what you described. What should the message ask about vaccination consent?";
  const calendar = {
    id: "item-cal",
    itemType: "calendar_event",
    proposals: [
      {
        id: "cal-1",
        type: "calendar_update",
        draft: "Add to calendar: Saturday pickup at 5pm.",
        private_objective: "Keep the Saturday pickup on the calendar.",
      },
    ],
  };
  const expense = {
    id: "item-exp",
    itemType: "expense",
    proposals: [
      {
        id: "exp-1",
        type: "log_expense",
        draft: "Log the Saturday copay.",
        private_objective: "Record the copay.",
      },
    ],
  };
  const consentLive = liveConsent();
  const afterFailure: ConversationActionModel = {
    interpret: async (frame) => {
      const content = String(interpretRequestBody(frame).messages[0].content);
      const stored = /vaccination consent/i.test(blockText(content, "ESTABLISHED_OBJECTIVES"));
      if (stored) return reading(CONSENT, false, "item-live");
      return {
        kind: "message",
        outcome: "Ask why the designated decision-maker process was not used.",
        question: DECISION,
        refersTo: "the decision-maker discussion",
        grounding: "conversation",
        relevantFactIndexes: [],
        uncertain: [],
        disputed: [],
        recipientName: "Kevin",
        elicitation: "open_question",
        privateConstraints: [],
        outcomeChanged: false,
        establishedTaskId: null,
      };
    },
    draftMessage: async (frame) =>
      /vaccination consent/i.test(frame.taskObjective?.question ?? "") ? UNUSABLE : DECISION,
    evaluateFidelity: async (input) => (input.draft === DECISION ? pass() : rejectConsent()),
  };
  const continueLive: ArbitrationModel = {
    classify: async () => ({
      relation: "continue",
      taskId: "item-live",
      currentProposalId: "live-1",
      currentItemId: "item-live",
      kind: "message",
      unread: false,
    }),
  };
  const failed = await chat("Draft a message to my co-parent about the pediatrician.", {
    action: afterFailure,
    arbitration: continueLive,
    conversation: conversationWith(consentLive),
  });
  assert.equal(failed.clearMessageObjective?.taskId, "item-live");
  assert.match(failed.reply, /What should the message ask\?/);
  assert.equal(messageCard(failed), undefined);

  const stillStuck = await chat(NEW_REQUEST, {
    action: afterFailure,
    arbitration: continueLive,
    conversation: conversationWith(consentLive),
    recentTurns: [...DECISION_TURNS, { role: "sage", text: failed.reply }],
  });
  assert.match(stillStuck.reply, /What should the message ask\?/);
  assert.equal(messageCard(stillStuck), undefined);

  const clearedProposals = clearReplyObjective(consentLive.proposals);
  const clearedMessage = clearedProposals[0] as {
    draft?: string;
    grounded_in?: unknown;
    private_objective?: unknown;
  };
  assert.equal(clearedMessage.draft, CONSENT);
  assert.equal("grounded_in" in clearedMessage, false);
  assert.equal("private_objective" in clearedMessage, false);
  assert.equal(calendar.proposals[0].draft, "Add to calendar: Saturday pickup at 5pm.");
  assert.equal(calendar.proposals[0].private_objective, "Keep the Saturday pickup on the calendar.");
  assert.equal(expense.proposals[0].private_objective, "Record the copay.");
  const mixed = [
    {
      type: "reply_coparent",
      draft: CONSENT,
      private_objective: consentObjective.outcome,
      grounded_in: { ...consentObjective },
    },
    { type: "calendar_update", draft: "Add Saturday pickup", private_objective: "calendar goal" },
    { type: "log_expense", draft: "Log the copay", private_objective: "expense goal" },
  ];
  const stripped = clearReplyObjective(mixed);
  assert.equal(stripped[1], mixed[1]);
  assert.equal(stripped[2], mixed[2]);
  assert.equal("grounded_in" in (stripped[0] as object), false);
  assert.equal("private_objective" in (stripped[0] as object), false);
  assert.equal((stripped[0] as { draft?: string }).draft, CONSENT);

  const draftedNext = await chat(NEW_REQUEST, {
    action: afterFailure,
    arbitration: continueLive,
    conversation: conversationWith({ ...consentLive, proposals: clearedProposals }),
    recentTurns: [...DECISION_TURNS, { role: "sage", text: failed.reply }],
  });
  assert.equal(messageCard(draftedNext)?.draft, DECISION);
  assert.doesNotMatch(draftedNext.reply, /What should the message ask\?/);
  assert.equal(draftedNext.clearMessageObjective, null);

  const purpose = await chat("Please draft a message to Kevin.", {
    action: {
      interpret: async () => ({
        kind: "message" as const,
        outcome: "",
        question: "",
        refersTo: null,
        grounding: "insufficient" as const,
        relevantFactIndexes: [],
        uncertain: ["what the message should say"],
        disputed: [] as string[],
        recipientName: "Kevin",
        elicitation: null,
        privateConstraints: [] as string[],
        outcomeChanged: false,
        establishedTaskId: null,
      }),
      draftMessage: async () => {
        throw new Error("an empty purpose must not draft");
      },
      evaluateFidelity: async () => {
        throw new Error("an empty purpose must not be reviewed");
      },
    },
    arbitration: continueLive,
    recentTurns: [],
    conversation: conversationWith(live),
  });
  assert.equal(purpose.clearMessageObjective, null);
  assert.equal(messageCard(purpose), undefined);
  assert.match(purpose.reply, /What should I tell/i);

  console.log("message-continuity tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
