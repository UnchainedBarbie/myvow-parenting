import assert from "node:assert/strict";
import { FakeDb } from "@/lib/messages/fake-admin";
import { processChatMessage } from "@/lib/sage/chat";
import type { ConversationActionModel } from "@/lib/sage/conversation-action";
import type { ConversationContext } from "@/lib/sage/conversation-context";
import { applyTurnToTasks } from "@/lib/sage/open-task-apply";
import { liveTasks, openTasksFromItems } from "@/lib/sage/open-task";
import { recoverParentContext } from "@/lib/sage/parent-context";
import { proposalState } from "@/lib/sage/proposal-lifecycle";
import type { TurnArbitration } from "@/lib/sage/turn-arbitration";
import { deriveWorkingMemory } from "@/lib/sage/working-memory";
import type { KnownCoparent } from "@/lib/sage/chat-intent";
import type { FidelityInput, FidelityVerdict } from "@/lib/sage/instruction-fidelity";

const PARENT = "parent-ashley";
const CASE = "case-1";
const SESSION = "session-ashley";
const kevin: KnownCoparent = { name: "Kevin", email: "kevin@example.com" };

const CONDITION =
  "I need to know whether he would consider agreeing to a new pediatrician without requiring vaccination consent. I do not want him to know this is for court.";
const SPECIFIC =
  "Would you consider agreeing to a new pediatrician without requiring vaccination consent?";
const GENERIC =
  "We need to make a decision about selecting a new pediatrician. What's your current position on how we should move forward with finding one?";
const BROAD = "What is your position on finding a new pediatrician?";

const TURNS = [
  { role: "parent" as const, text: "The children were dismissed because of the practice's vaccination policy." },
  { role: "parent" as const, text: "I offered other pediatricians. He still insists on the previous practice." },
  { role: "parent" as const, text: CONDITION },
  { role: "sage" as const, text: GENERIC },
];

function verdict(input: FidelityInput): FidelityVerdict {
  const source = input.parentTurns.join("\n");
  const wantsCondition = /without requiring vaccination consent/i.test(source);
  const asksCondition = /without requiring vaccination consent/i.test(input.draft);
  const leak = /court|litigation/i.test(input.draft);
  if (leak || (wantsCondition && !asksCondition)) {
    return {
      fulfills: false,
      missed: ["The draft does not ask the condition the parent stated."],
      correctedQuestion: SPECIFIC,
      correctedOutcome: "Learn whether agreement on a new pediatrician depends on vaccination consent.",
      privateLeak: leak,
      unsupported: [],
    };
  }
  return {
    fulfills: true,
    missed: [],
    correctedQuestion: null,
    correctedOutcome: null,
    privateLeak: false,
    unsupported: [],
  };
}

function faithful(opts?: { broad?: boolean }): ConversationActionModel {
  return {
    interpret: async () => ({
      kind: "message",
      outcome: opts?.broad === false ? SPECIFIC : BROAD,
      question: opts?.broad === false ? SPECIFIC : BROAD,
      refersTo: "the pediatrician disagreement",
      grounding: "conversation",
      relevantFactIndexes: [],
      uncertain: [],
      disputed: [],
      recipientName: "Kevin",
      elicitation: "open_question",
      privateConstraints: ["Do not reveal that this is for court."],
    }),
    draftMessage: async (frame) => {
      const question = frame.taskObjective?.question ?? "";
      if (/without requiring vaccination consent/i.test(question)) {
        return `${SPECIFIC} On 2026-10-12 I emailed the options (MSG-014).`;
      }
      return `I am preparing this for court. ${GENERIC}`;
    },
    evaluateFidelity: async (input) => verdict(input),
  };
}

function conversationWith(items: { id: string; itemType: string; proposals: Record<string, unknown>[] }[]): ConversationContext {
  return {
    thread_subject: null,
    event: { subject: null, child: null, date: null, time: null, eventId: null },
    open_proposals: [],
    memory: deriveWorkingMemory(
      items.map((item) => ({ itemId: item.id, itemType: item.itemType, proposals: item.proposals }))
    ),
  };
}

function chat(
  message: string,
  over: {
    conversation?: ConversationContext | null;
    action?: ConversationActionModel | null;
    arbitration?: { classify: () => Promise<TurnArbitration | null> } | null;
    recentTurns?: { role: "parent" | "sage"; text: string }[];
    parentContext?: string[];
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
    recentTurns: over.recentTurns ?? TURNS,
    parentContext: over.parentContext,
    sessionId: SESSION,
    reasonAboutDocument: null,
    shadow: false,
    today: new Date("2026-10-28T18:00:00Z"),
    conversationModel: null,
    conversationActionModel: over.action === undefined ? faithful() : over.action,
    arbitrationModel: over.arbitration === undefined ? null : over.arbitration,
  });
}

function messageItem(id: string, draft: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    itemType: "message",
    proposals: [
      {
        id: `${id}-p`,
        type: "reply_coparent",
        draft,
        requires_approval: true,
        ...extra,
      },
    ],
  };
}

async function main() {
  delete process.env.ANTHROPIC_API_KEY;

  {
    const recovered = recoverParentContext({
      recentTurns: [
        { role: "parent", text: "We still have not settled the pediatrician question." },
        { role: "sage", text: "Which providers would you consider?" },
      ],
      olderParentTurns: [
        "The school play is on Friday and I can take them.",
        CONDITION,
      ],
      request: "Can you draft a message based on what we've discussed?",
    });
    assert.equal(recovered.length, 1);
    assert.match(recovered[0], /without requiring vaccination consent/i);
  }

  // A — a referential draft recovers the parent's question, not the topic.
  {
    const result = await chat("Can you draft a message based on what we've discussed?");
    const card = result.result.plan.proposals.find((proposal) => proposal.type === "reply_coparent");
    assert.ok(card);
    assert.match(card.draft ?? "", /without requiring vaccination consent/i);
    assert.doesNotMatch(card.draft ?? "", /how we should move forward/i);
    assert.doesNotMatch(card.draft ?? "", /court|litigation/i);
    assert.match(card.grounded_in?.question ?? "", /without requiring vaccination consent/i);
    assert.match(card.private_objective ?? "", /court|consent/i);
    assert.equal(card.requires_approval, true);
    assert.equal("executed" in card, false);
    assert.match(card.draft ?? "", /MSG-014/);
  }

  // B — a stored broad question is repaired from the parent turns.
  {
    const legacy = messageItem("item-old", GENERIC, {
      grounded_in: {
        outcome: BROAD,
        question: BROAD,
        turns: [],
        facts: [],
        uncertain: [],
        private_constraints: [],
        rejected: [],
        last_guidance: "",
        evidence_refs: [],
      },
    });
    const result = await chat("Can you draft a message based on what we've discussed?", {
      conversation: conversationWith([legacy]),
    });
    const card = result.result.plan.proposals.find((proposal) => proposal.type === "reply_coparent");
    assert.ok(card);
    assert.match(card.grounded_in?.question ?? "", /without requiring vaccination consent/i);
    assert.doesNotMatch(card.draft ?? "", /how we should move forward/i);
    const stored = legacy.proposals[0] as { grounded_in?: { question?: string } };
    assert.equal(stored.grounded_in?.question, BROAD);
  }

  // C and D — a rejected generic draft is replaced, and a second rejection accumulates.
  {
    const first = await chat("You're not listening. I want a revised message based on what I told you.", {
      conversation: conversationWith([messageItem("item-old", GENERIC)]),
    });
    const revised = first.result.plan.proposals.find((proposal) => proposal.type === "reply_coparent");
    assert.equal(first.taskDecision.relation, "revise");
    assert.match(revised?.draft ?? "", /without requiring vaccination consent/i);
    assert.doesNotMatch(revised?.draft ?? "", /how we should move forward/i);
    const second = await chat("That still is not what I asked. Use what I already told you.", {
      conversation: conversationWith([
        messageItem("item-old", GENERIC, { grounded_in: revised?.grounded_in }),
      ]),
    });
    const again = second.result.plan.proposals.find((proposal) => proposal.type === "reply_coparent");
    assert.match(again?.draft ?? "", /without requiring vaccination consent/i);
    assert.ok((again?.grounded_in?.rejected?.length ?? 0) >= 2);
    assert.equal(again?.requires_approval, true);
    assert.equal("approved" in (again ?? {}), false);
  }

  // E — cancel all closes every live message and a pending selection.
  {
    const db = new FakeDb();
    db.seed("sage_items", [
      {
        id: "item-old",
        visible_to: PARENT,
        plan: { proposals: messageItem("item-old", GENERIC).proposals },
      },
      {
        id: "item-glasses",
        visible_to: PARENT,
        plan: {
          proposals: [
            {
              id: "g1",
              type: "reply_coparent",
              draft: "Ashley needs glasses.",
              requires_approval: true,
              approved: true,
            },
          ],
        },
      },
      {
        id: "item-select",
        visible_to: PARENT,
        plan: {
          proposals: [
            {
              id: "sel-1",
              type: "ask_clarification",
              audience: "parent",
              draft: "Which message?",
              selection_options: [
                { index: 1, taskId: "item-old", itemId: "item-old", proposalId: "item-old-p" },
                { index: 2, taskId: "item-glasses", itemId: "item-glasses", proposalId: "g1" },
              ],
            },
          ],
        },
      },
    ]);
    const result = await chat("Cancel all open messages.", {
      action: faithful(),
      arbitration: {
        classify: async () => ({
          relation: "cancel",
          taskId: null,
          currentProposalId: null,
          currentItemId: null,
          kind: "message",
          unread: false,
          cancelScope: "all",
        }),
      },
      conversation: conversationWith([
        messageItem("item-old", GENERIC),
        messageItem("item-glasses", "Ashley needs glasses.", { id: "g1", approved: true }),
        {
          id: "item-select",
          itemType: "note",
          proposals: [
            {
              id: "sel-1",
              type: "ask_clarification",
              audience: "parent",
              draft: "Which message?",
              selection_options: [
                { index: 1, taskId: "item-old", itemId: "item-old", proposalId: "item-old-p" },
                { index: 2, taskId: "item-glasses", itemId: "item-glasses", proposalId: "g1" },
              ],
            },
          ],
        },
      ]),
    });
    assert.equal(result.taskDecision.relation, "cancel");
    assert.equal(result.taskDecision.cancelScope, "all");
    assert.equal(result.result.plan.proposals.some((proposal) => proposal.type === "reply_coparent"), false);
    const applied = await applyTurnToTasks({
      admin: db as unknown as Parameters<typeof applyTurnToTasks>[0]["admin"],
      userId: PARENT,
      decision: result.taskDecision,
      proposals: [],
    });
    assert.equal(applied.folded, true);
    for (const id of ["item-old", "item-glasses", "item-select"]) {
      const plan = db.table("sage_items").find((row) => row.id === id)!.plan as {
        proposals: Record<string, unknown>[];
      };
      assert.notEqual(proposalState(plan.proposals[0]), "open");
      assert.notEqual(proposalState(plan.proposals[0]), "approved");
    }
  }

  // F — an unclear aside does not cancel the open messages.
  {
    const db = new FakeDb();
    db.seed("sage_items", [
      {
        id: "item-old",
        visible_to: PARENT,
        plan: { proposals: messageItem("item-old", GENERIC).proposals },
      },
      {
        id: "item-glasses",
        visible_to: PARENT,
        plan: { proposals: messageItem("item-glasses", "Ashley needs glasses.").proposals },
      },
    ]);
    const result = await chat("Never mind.", {
      action: {
        interpret: async () => ({
          kind: "conversation",
          outcome: "The parent paused.",
          refersTo: null,
          grounding: "conversation",
          relevantFactIndexes: [],
          uncertain: [],
          disputed: [],
          recipientName: null,
          elicitation: null,
        }),
        draftMessage: async () => {
          throw new Error("an aside must not draft");
        },
      },
      conversation: conversationWith([
        messageItem("item-old", GENERIC),
        messageItem("item-glasses", "Ashley needs glasses."),
      ]),
    });
    assert.notEqual(result.taskDecision.relation, "cancel");
    const applied = await applyTurnToTasks({
      admin: db as unknown as Parameters<typeof applyTurnToTasks>[0]["admin"],
      userId: PARENT,
      decision: result.taskDecision,
      proposals: result.result.plan.proposals,
    });
    assert.equal(applied.folded, false);
    const plan = db.table("sage_items").find((row) => row.id === "item-old")!.plan as {
      proposals: Record<string, unknown>[];
    };
    assert.equal(proposalState(plan.proposals[0]), "open");
  }

  // G — canceling the newest version does not revive an older open draft.
  {
    const tasks = openTasksFromItems({
      items: [
        {
          id: "item-old",
          itemType: "message",
          proposals: [
            { id: "old", type: "reply_coparent", draft: GENERIC },
            { id: "newer", type: "reply_coparent", draft: GENERIC, status: "canceled" },
          ],
        },
      ],
      ownerId: PARENT,
      caseId: CASE,
      sessionId: SESSION,
    });
    assert.equal(tasks[0].status, "canceled");
    assert.equal(liveTasks(tasks).length, 0);
    assert.equal(tasks[0].currentProposalId, "newer");
  }

  // H — "2" revises only the second stored choice.
  {
    const selected = await chat("2", {
      action: {
        interpret: async () => {
          throw new Error("a numbered selection must not be reinterpreted");
        },
        draftMessage: async (frame) => frame.taskObjective?.question || "Ashley needs glasses.",
        evaluateFidelity: async () => ({
          fulfills: true,
          missed: [],
          correctedQuestion: null,
          correctedOutcome: null,
          privateLeak: false,
          unsupported: [],
        }),
      },
      conversation: conversationWith([
        {
          id: "item-select",
          itemType: "note",
          proposals: [
            {
              id: "sel-1",
              type: "ask_clarification",
              audience: "parent",
              draft: "Which message?\n1. pediatrician\n2. glasses",
              selection_options: [
                { index: 1, taskId: "item-old", itemId: "item-old", proposalId: "item-old-p" },
                { index: 2, taskId: "item-glasses", itemId: "item-glasses", proposalId: "g1" },
              ],
            },
          ],
        },
        messageItem("item-old", GENERIC, {
          private_objective: BROAD,
          grounded_in: {
            outcome: BROAD,
            question: BROAD,
            turns: [],
            facts: [],
            uncertain: [],
            private_constraints: [],
            rejected: [],
            last_guidance: "",
            evidence_refs: [],
          },
        }),
        messageItem("item-glasses", "Ashley needs glasses.", {
          id: "g1",
          private_objective: "Tell him Ashley needs glasses.",
          grounded_in: {
            outcome: "Tell him Ashley needs glasses.",
            question: "Can you take Ashley to get glasses on Thursday?",
            turns: [],
            facts: [],
            uncertain: [],
            private_constraints: [],
            rejected: [],
            last_guidance: "",
            evidence_refs: [],
          },
        }),
      ]),
    });
    assert.equal(selected.taskDecision.relation, "revise");
    assert.equal(selected.taskDecision.taskId, "item-glasses");
    const card = selected.result.plan.proposals.find((proposal) => proposal.type === "reply_coparent");
    assert.match(card?.draft ?? "", /glasses/i);
    assert.doesNotMatch(card?.draft ?? "", /vaccination consent/i);
  }

  // I — repeating the draft request does not open another task while a choice is pending.
  {
    const repeated = await chat("Can you draft a message based on what we've discussed?", {
      action: faithful(),
      arbitration: {
        classify: async () => ({
          relation: "new_task",
          taskId: null,
          currentProposalId: null,
          currentItemId: null,
          kind: "message",
          unread: false,
          separate: false,
        }),
      },
      conversation: conversationWith([
        {
          id: "item-select",
          itemType: "note",
          proposals: [
            {
              id: "sel-1",
              type: "ask_clarification",
              audience: "parent",
              draft: "Which message?",
              selection_options: [
                { index: 1, taskId: "item-old", itemId: "item-old", proposalId: "item-old-p" },
                { index: 2, taskId: "item-glasses", itemId: "item-glasses", proposalId: "g1" },
              ],
            },
          ],
        },
        messageItem("item-old", GENERIC),
        messageItem("item-glasses", "Ashley needs glasses.", { id: "g1" }),
      ]),
    });
    assert.equal(repeated.taskDecision.relation, "ask");
    assert.equal(repeated.result.plan.proposals.some((proposal) => proposal.type === "reply_coparent"), false);
    assert.ok(repeated.result.plan.proposals.some((proposal) => proposal.type === "ask_clarification"));
  }

  // L — a legacy item without grounded_in still yields a repaired objective on the new draft.
  {
    const legacy = messageItem("item-legacy", GENERIC);
    assert.equal("grounded_in" in legacy.proposals[0], false);
    const result = await chat("Can you draft a message based on what we've discussed?", {
      conversation: conversationWith([legacy]),
    });
    const card = result.result.plan.proposals.find((proposal) => proposal.type === "reply_coparent");
    assert.match(card?.grounded_in?.question ?? "", /without requiring vaccination consent/i);
    assert.equal("grounded_in" in legacy.proposals[0], false);
  }

  console.log("instruction-fidelity tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
