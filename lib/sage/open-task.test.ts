import assert from "node:assert/strict";
import { FakeDb } from "@/lib/messages/fake-admin";
import { restoreDroppedEvidence } from "@/lib/sage/outbound-facts";
import { processChatMessage } from "@/lib/sage/chat";
import { applyTaskRevision, applyTurnToTasks, dismissTaskProposals } from "@/lib/sage/open-task-apply";
import {
  liveTaskOfKind,
  liveTasks,
  liveTasksOfKind,
  openTasksFromItems,
  type OpenTask,
} from "@/lib/sage/open-task";
import { proposalState } from "@/lib/sage/proposal-lifecycle";
import {
  askArbitration,
  parseArbitration,
  structuralArbitration,
  unreadArbitration,
  type ArbitrationModel,
} from "@/lib/sage/turn-arbitration";
import { buildContextFrame } from "@/lib/sage/context-frame";
import { draftExposesPrivateStrategy, draftMissesIntendedQuestion, parseSelectionAnswer } from "@/lib/sage/task-objective";
import type { ConversationActionModel } from "@/lib/sage/conversation-action";
import type { ConversationContext } from "@/lib/sage/conversation-context";
import { deriveWorkingMemory } from "@/lib/sage/working-memory";
import type { KnownCoparent } from "@/lib/sage/chat-intent";

const TODAY = new Date("2026-10-28T18:00:00Z");
const PARENT = "parent-ashley";
const OTHER = "parent-kevin";
const CASE = "case-1";
const SESSION = "session-ashley";
const kevin: KnownCoparent = { name: "Kevin", email: "kevin@example.com" };

const PEDIATRICIAN_TURNS = [
  { role: "parent" as const, text: "Kevin and I have not agreed on a new pediatrician for Ashley." },
  { role: "sage" as const, text: "That sounds hard. What have you already tried?" },
  { role: "parent" as const, text: "I sent him two other pediatrician options last week. He will not consider them." },
  {
    role: "parent" as const,
    text: "The disagreement also involves the previous practice's vaccination policy. I want his position clarified and in writing.",
  },
];

const OPEN_QUESTION =
  "Please tell me in writing whether agreement on a new pediatrician depends on vaccination decisions.";

const EVIDENCE_DRAFT =
  "On 2026-10-12 I emailed two pediatrician options (MSG-014). The previous practice dismissed the children over vaccination policy. Please state your position in writing.";

const GLASSES_DRAFT =
  "Ashley needs glasses after the eye exam. Please confirm you can take her Thursday.";
const GLASSES_OBJECTIVE = "Tell him Ashley needs glasses after the eye exam.";
const PED_OBJECTIVE = "Document his position on a new pediatrician for possible court use.";

function interpretation(kind: "message" | "conversation", outcome: string, refersTo: string | null = null) {
  return {
    kind,
    outcome,
    refersTo,
    grounding: "conversation" as const,
    relevantFactIndexes: [] as number[],
    uncertain: [] as string[],
    disputed: [] as string[],
    recipientName: kind === "message" ? "Kevin" : null,
  };
}

function glassesAction(draft = GLASSES_DRAFT): ConversationActionModel {
  return {
    interpret: async () => interpretation("message", GLASSES_OBJECTIVE, "Ashley needs glasses"),
    draftMessage: async () => draft,
  };
}

function twoMessageItems() {
  return [
    {
      id: "item-msg",
      itemType: "message",
      proposals: [
        {
          id: "msg-1",
          type: "reply_coparent",
          draft: OPEN_QUESTION,
          requires_approval: true,
          private_objective: PED_OBJECTIVE,
        },
      ],
    },
    {
      id: "item-glasses",
      itemType: "message",
      proposals: [
        {
          id: "msg-g1",
          type: "reply_coparent",
          draft: GLASSES_DRAFT,
          requires_approval: true,
          private_objective: GLASSES_OBJECTIVE,
        },
      ],
    },
  ];
}

function actionModel(draft = OPEN_QUESTION): ConversationActionModel {
  return {
    interpret: async () => ({
      kind: "message",
      outcome: "Ask Kevin to clarify whether agreement on a new pediatrician depends on vaccination decisions.",
      refersTo: "the pediatrician disagreement",
      grounding: "conversation",
      relevantFactIndexes: [],
      uncertain: [],
      disputed: [],
      recipientName: "Kevin",
      elicitation: "open_question",
    }),
    draftMessage: async () => draft,
  };
}

function conversationWith(...items: { id: string; itemType: string; proposals: Record<string, unknown>[] }[]): ConversationContext {
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

async function chat(
  message: string,
  over: {
    conversation?: ConversationContext | null;
    action?: ConversationActionModel | null;
    arbitration?: ArbitrationModel | null;
    recentTurns?: { role: "parent" | "sage"; text: string }[];
    viewerId?: string;
  } = {}
) {
  return processChatMessage({
    message,
    case_id: CASE,
    timezone: "America/Denver",
    conversation: over.conversation ?? null,
    coparents: [kevin],
    children: [{ id: "child-1", name: "Ashley Example" }],
    viewerId: over.viewerId ?? PARENT,
    viewerRole: "parent",
    recentTurns: over.recentTurns ?? PEDIATRICIAN_TURNS,
    sessionId: SESSION,
    reasonAboutDocument: null,
    shadow: false,
    today: TODAY,
    conversationModel: null,
    conversationActionModel: over.action === undefined ? actionModel() : over.action,
    arbitrationModel: over.arbitration === undefined ? null : over.arbitration,
  });
}

function asAdmin(db: FakeDb) {
  return db as unknown as Parameters<typeof applyTurnToTasks>[0]["admin"];
}

async function main() {
  delete process.env.ANTHROPIC_API_KEY;

  // --- Task identity is the item/plan id, not recency ------------------------------------------------
  {
    const tasks = openTasksFromItems({
      ownerId: PARENT,
      caseId: CASE,
      sessionId: SESSION,
      items: [
        {
          id: "item-exp",
          itemType: "expense",
          proposals: [
            {
              id: "ask-exp",
              type: "ask_clarification",
              draft: "What was the amount?",
              audience: "parent",
              clarifies: "expense",
              depends_on: "amount",
            },
          ],
        },
        {
          id: "item-msg",
          itemType: "message",
          plan: { task_id: "task-msg" },
          proposals: [
            { id: "msg-1", type: "reply_coparent", draft: OPEN_QUESTION, status: "superseded", superseded_by: "msg-2" },
            { id: "msg-2", type: "reply_coparent", draft: OPEN_QUESTION, requires_approval: true },
          ],
        },
        {
          id: "item-cal",
          itemType: "calendar_event",
          proposals: [
            {
              id: "cal-1",
              type: "calendar_update",
              draft: "Add dentist Friday 3pm",
              approved: true,
              executed: true,
              status: "executed",
            },
          ],
        },
      ],
    });
    assert.equal(liveTaskOfKind(tasks, "expense")?.id, "item-exp");
    assert.equal(liveTaskOfKind(tasks, "message")?.id, "task-msg");
    assert.equal(liveTaskOfKind(tasks, "message")?.currentProposalId, "msg-2");
    assert.equal(liveTaskOfKind(tasks, "calendar"), null, "executed calendar is not live");
    assert.equal(liveTasks(tasks).length, 2);
    assert.equal(liveTaskOfKind(tasks, "message")?.status, "awaiting_approval");
    assert.equal(liveTaskOfKind(tasks, "expense")?.status, "awaiting_input");
  }

  // --- Several live tasks of one kind are not resolved by recency -----------------------------------
  {
    const tasks = openTasksFromItems({
      ownerId: PARENT,
      caseId: CASE,
      sessionId: SESSION,
      items: [
        {
          id: "newer-msg",
          itemType: "message",
          proposals: [{ id: "n1", type: "reply_coparent", draft: "Newer" }],
        },
        {
          id: "older-msg",
          itemType: "message",
          proposals: [{ id: "o1", type: "reply_coparent", draft: "Older" }],
        },
      ],
    });
    assert.equal(liveTaskOfKind(tasks, "message"), null);
  }

  // --- Pediatrician: discuss, draft, revise twice, keep facts, hide strategy ------------------------
  {
    const first = await chat(
      "I want to ask him a question that confirms he is using coercive control so I can use that in court."
    );
    const card = first.result.plan.proposals.find((proposal) => proposal.type === "reply_coparent");
    assert.ok(card);
    assert.equal(first.taskDecision.relation, "new_task");
    assert.equal(card.requires_approval, true);
    assert.equal("executed" in card, false);
    assert.match(card.draft ?? "", /pediatrician/i);
    assert.doesNotMatch(card.draft ?? "", /coercive control/i);
    assert.ok(card.private_objective);
    assert.doesNotMatch(card.draft ?? "", /court/i);

    const db = new FakeDb();
    db.seed("sage_items", [
      {
        id: "item-msg",
        case_id: CASE,
        visible_to: PARENT,
        source_type: "chat",
        item_type: "message",
        plan: {
          task_id: "task-msg",
          proposals: [
            {
              id: "msg-1",
              type: "reply_coparent",
              draft: OPEN_QUESTION,
              recipient_name: "Kevin",
              recipient_email: "kevin@example.com",
              requires_approval: true,
              private_objective: "Document his position for possible court use.",
            },
          ],
        },
      },
    ]);
    const conversation = conversationWith({
      id: "item-msg",
      itemType: "message",
      proposals: [
        {
          id: "msg-1",
          type: "reply_coparent",
          draft: OPEN_QUESTION,
          requires_approval: true,
        },
      ],
    });
    const revisionDraft =
      "Please tell me in writing whether agreement on a new pediatrician depends on vaccination decisions. I am asking for your actual position.";
    const revised = await chat("I don't want him to know I'm documenting this.", {
      conversation,
      action: actionModel(revisionDraft),
    });
    assert.equal(revised.taskDecision.relation, "revise");
    assert.equal(revised.taskDecision.taskId, "item-msg");
    assert.doesNotMatch(revised.result.plan.proposals[0]?.draft ?? "", /documenting|court|litigation/i);
    assert.match(revised.result.plan.proposals[0]?.draft ?? "", /pediatrician/i);
    assert.equal(revised.result.plan.proposals[0]?.requires_approval, true);

    const applied = await applyTurnToTasks({
      admin: asAdmin(db),
      userId: PARENT,
      decision: revised.taskDecision,
      proposals: revised.result.plan.proposals,
      guidance: "I don't want him to know I'm documenting this.",
    });
    assert.equal(applied.folded, true);
    if (!applied.folded) throw new Error("expected fold");
    const stored = (applied.item.plan.proposals as Record<string, unknown>[]);
    assert.equal(stored.length, 2);
    assert.equal(proposalState(stored[0]), "superseded");
    assert.equal(proposalState(stored[1]), "open");
    assert.equal(stored[1].approved, undefined);
    assert.doesNotMatch(String(stored[1].draft ?? stored[1].revised_text ?? ""), /documenting this/i);
    assert.match(String(stored[1].draft ?? stored[1].revised_text ?? ""), /pediatrician/i);

    const secondPass = await applyTaskRevision({
      admin: asAdmin(db),
      userId: PARENT,
      itemId: "item-msg",
      proposalId: String(stored[1].id),
      nextDraft: "Could you confirm in writing whether a new pediatrician depends on vaccination decisions?",
      previousDraft: String(stored[1].draft ?? ""),
      guidance: "Make it a bit shorter.",
    });
    assert.ok(secondPass);
    const versions = (secondPass!.plan.proposals as Record<string, unknown>[]);
    assert.equal(versions.length, 3);
    assert.equal(proposalState(versions[0]), "superseded");
    assert.equal(proposalState(versions[1]), "superseded");
    assert.equal(proposalState(versions[2]), "open");
    const live = versions.filter((row) => proposalState(row) === "open");
    assert.equal(live.length, 1);
  }

  // --- Evidence-preserving revision ----------------------------------------------------------------
  {
    const next = restoreDroppedEvidence(
      "Please share your position on a new pediatrician.",
      EVIDENCE_DRAFT,
      "Softer tone."
    );
    assert.match(next, /2026-10-12/);
    assert.match(next, /MSG-014/i);
    assert.match(next, /pediatrician/i);
    const retracted = restoreDroppedEvidence(
      "Please share your position.",
      EVIDENCE_DRAFT,
      "Remove MSG-014 and do not include the October date."
    );
    assert.doesNotMatch(retracted, /MSG-014/i);
  }

  // --- Unrelated conversational turn does not fill, revise, or create ------------------------------
  {
    const conversation = conversationWith(
      {
        id: "item-exp",
        itemType: "expense",
        proposals: [
          {
            id: "ask-exp",
            type: "ask_clarification",
            draft: "What was the amount of this expense?",
            audience: "parent",
            clarifies: "expense",
            depends_on: "amount",
          },
        ],
      },
      {
        id: "item-msg",
        itemType: "message",
        proposals: [{ id: "msg-1", type: "reply_coparent", draft: OPEN_QUESTION, requires_approval: true }],
      }
    );
    const talk: ConversationActionModel = {
      interpret: async () => ({
        kind: "conversation",
        outcome: "Acknowledge the frustration.",
        refersTo: null,
        grounding: "insufficient",
        relevantFactIndexes: [],
        uncertain: [],
        disputed: [],
        recipientName: null,
      }),
      draftMessage: async () => OPEN_QUESTION,
    };
    const insult = await chat("asshole", {
      conversation,
      action: talk,
      recentTurns: [{ role: "parent", text: "This has been a long week with the dentist bills." }],
    });
    assert.equal(insult.taskDecision.relation, "conversation");
    assert.equal(insult.taskDecision.unread, false);
    assert.equal(insult.result.plan.proposals.some((p) => p.type === "log_expense"), false);
    assert.equal(insult.result.plan.proposals.some((p) => p.type === "reply_coparent"), false);
  }

  // --- Model failure does not alter task state -----------------------------------------------------
  {
    const failing: ArbitrationModel = {
      classify: async () => null,
    };
    const conversation = conversationWith({
      id: "item-msg",
      itemType: "message",
      proposals: [{ id: "msg-1", type: "reply_coparent", draft: OPEN_QUESTION }],
    });
    const unread = await chat("hmm", {
      conversation,
      action: {
        interpret: async () => null,
        draftMessage: async () => {
          throw new Error("should not draft");
        },
      },
      arbitration: failing,
      recentTurns: [],
    });
    assert.equal(unread.taskDecision.unread, true);
    assert.equal(unread.result.plan.proposals.length, 0);

    const db = new FakeDb();
    db.seed("sage_items", [
      {
        id: "item-msg",
        visible_to: PARENT,
        plan: { proposals: [{ id: "msg-1", type: "reply_coparent", draft: OPEN_QUESTION }] },
      },
    ]);
    const before = JSON.stringify(db.table("sage_items"));
    const applied = await applyTurnToTasks({
      admin: asAdmin(db),
      userId: PARENT,
      decision: unreadArbitration(),
      proposals: [{ type: "reply_coparent", draft: "changed" }],
    });
    assert.equal(applied.folded, false);
    assert.equal(JSON.stringify(db.table("sage_items")), before);
  }

  // --- Multiple tasks coexist ----------------------------------------------------------------------
  {
    const frame = buildContextFrame({
      parentId: PARENT,
      caseId: CASE,
      sessionId: SESSION,
      message: "Please draft that question.",
      conversation: conversationWith(
        {
          id: "item-exp",
          itemType: "expense",
          proposals: [
            {
              id: "ask-exp",
              type: "ask_clarification",
              draft: "What was the amount?",
              audience: "parent",
              clarifies: "expense",
              depends_on: "amount",
            },
          ],
        },
        {
          id: "item-cal",
          itemType: "calendar_event",
          proposals: [{ id: "cal-1", type: "calendar_update", draft: "Dentist Friday 3pm" }],
        },
        {
          id: "item-msg",
          itemType: "message",
          proposals: [{ id: "msg-1", type: "reply_coparent", draft: OPEN_QUESTION }],
        }
      ),
    });
    assert.equal(liveTaskOfKind(frame.openTasks, "expense")?.id, "item-exp");
    assert.equal(liveTaskOfKind(frame.openTasks, "calendar")?.id, "item-cal");
    assert.equal(liveTaskOfKind(frame.openTasks, "message")?.id, "item-msg");
    const messageTurn = structuralArbitration({
      frame,
      tasks: frame.openTasks,
      interpretation: {
        kind: "message",
        outcome: "Revise the pediatrician question.",
        refersTo: null,
        grounding: "conversation",
        relevantFactIndexes: [],
        uncertain: [],
        disputed: [],
        recipientName: "Kevin",
      },
      hasActionCard: false,
    });
    assert.equal(messageTurn.relation, "revise");
    assert.equal(messageTurn.taskId, "item-msg");
  }

  // --- Approval safety -----------------------------------------------------------------------------
  {
    const drafted = await chat("Please draft a message asking Kevin to clarify the pediatrician.");
    const card = drafted.result.plan.proposals.find((p) => p.type === "reply_coparent");
    assert.ok(card);
    assert.equal(card.requires_approval, true);
    assert.equal("executed" in card, false);
    assert.equal("approved" in card, false);
    const db = new FakeDb();
    db.seed("sage_items", [
      {
        id: "item-msg",
        visible_to: PARENT,
        plan: {
          proposals: [
            { id: "msg-1", type: "reply_coparent", draft: OPEN_QUESTION, requires_approval: true },
          ],
        },
      },
    ]);
    await applyTaskRevision({
      admin: asAdmin(db),
      userId: PARENT,
      itemId: "item-msg",
      proposalId: "msg-1",
      nextDraft: "Shorter question about the pediatrician.",
    });
    const stored = db.table("sage_items")[0].plan as { proposals: Record<string, unknown>[] };
    assert.equal(stored.proposals[1].approved, undefined);
    assert.equal(stored.proposals[1].executed, undefined);
    assert.equal(stored.proposals[1].requires_approval, true);
  }

  // --- Privacy: two parents, two task sets ---------------------------------------------------------
  {
    const ashley = openTasksFromItems({
      ownerId: PARENT,
      caseId: CASE,
      sessionId: SESSION,
      items: [
        {
          id: "ashley-msg",
          itemType: "message",
          proposals: [{ id: "a1", type: "reply_coparent", draft: "Ashley draft about pediatrician" }],
        },
      ],
    });
    const kevinTasks = openTasksFromItems({
      ownerId: OTHER,
      caseId: CASE,
      sessionId: "session-kevin",
      items: [
        {
          id: "kevin-msg",
          itemType: "message",
          proposals: [{ id: "k1", type: "reply_coparent", draft: "Kevin draft about soccer" }],
        },
      ],
    });
    assert.equal(ashley[0].ownerId, PARENT);
    assert.equal(kevinTasks[0].ownerId, OTHER);
    assert.equal(ashley.some((task) => /soccer/i.test(task.outgoingBody ?? "")), false);
    assert.equal(kevinTasks.some((task) => /pediatrician/i.test(task.outgoingBody ?? "")), false);

    const db = new FakeDb();
    db.seed("sage_items", [
      {
        id: "ashley-msg",
        visible_to: PARENT,
        plan: { proposals: [{ id: "a1", type: "reply_coparent", draft: "Ashley draft" }] },
      },
      {
        id: "kevin-msg",
        visible_to: OTHER,
        plan: { proposals: [{ id: "k1", type: "reply_coparent", draft: "Kevin draft" }] },
      },
    ]);
    const stolen = await applyTaskRevision({
      admin: asAdmin(db),
      userId: PARENT,
      itemId: "kevin-msg",
      proposalId: "k1",
      nextDraft: "intercepted",
    });
    assert.equal(stolen, null);
    const kevinRow = db.table("sage_items").find((row) => row.id === "kevin-msg")!;
    assert.equal((kevinRow.plan as { proposals: { draft: string }[] }).proposals[0].draft, "Kevin draft");
  }

  // --- Cancel dismisses live work; executed stays --------------------------------------------------
  {
    const db = new FakeDb();
    db.seed("sage_items", [
      {
        id: "item-msg",
        visible_to: PARENT,
        plan: {
          proposals: [
            { id: "old", type: "reply_coparent", draft: "old", status: "superseded", superseded_by: "live" },
            { id: "live", type: "reply_coparent", draft: OPEN_QUESTION, requires_approval: true },
          ],
        },
      },
    ]);
    const dismissed = await dismissTaskProposals({ admin: asAdmin(db), userId: PARENT, itemId: "item-msg" });
    assert.ok(dismissed);
    const rows = dismissed!.plan.proposals as Record<string, unknown>[];
    assert.equal(rows[0].status, "superseded");
    assert.equal(rows[1].status, "dismissed");
  }

  // --- Named closed tasks are not reopened ---------------------------------------------------------
  {
    const closed: OpenTask[] = [
      {
        id: "done",
        ownerId: PARENT,
        caseId: CASE,
        sessionId: SESSION,
        kind: "message",
        status: "executed",
        missing: [],
        clarification: null,
        proposalIds: ["p1"],
        currentProposalId: "p1",
        currentItemId: "done",
        currentProposalIndex: 0,
        versions: [],
        privateObjective: null,
        outgoingBody: "sent",
        resultIds: ["m1"],
        groundedIn: null,
        source: "chat",
      },
    ];
    const parsed = parseArbitration('{"relation":"revise","taskId":"done"}', closed);
    assert.equal(parsed?.relation, "conversation");
    assert.equal(parsed?.taskId, null);
  }

  // --- Distinct message request while one draft is live starts a second task ------------------------
  {
    const conversation = conversationWith({
      id: "item-msg",
      itemType: "message",
      proposals: [
        {
          id: "msg-1",
          type: "reply_coparent",
          draft: OPEN_QUESTION,
          requires_approval: true,
          private_objective: PED_OBJECTIVE,
        },
      ],
    });
    const frame = buildContextFrame({
      parentId: PARENT,
      caseId: CASE,
      sessionId: SESSION,
      message: "Also tell him Ashley needs glasses.",
      conversation,
    });
    const distinct = structuralArbitration({
      frame,
      tasks: frame.openTasks,
      interpretation: interpretation("message", GLASSES_OBJECTIVE, "Ashley needs glasses"),
      hasActionCard: false,
    });
    assert.equal(distinct.relation, "new_task");
    assert.equal(distinct.taskId, null);

    const created = await chat("Also tell him Ashley needs glasses.", {
      conversation,
      action: glassesAction(),
    });
    assert.equal(created.taskDecision.relation, "new_task");
    assert.equal(created.taskDecision.taskId, null);
    const card = created.result.plan.proposals.find((proposal) => proposal.type === "reply_coparent");
    assert.ok(card);
    assert.match(card.draft ?? "", /glasses/i);
    assert.doesNotMatch(card.draft ?? "", /pediatrician/i);
    assert.equal(card.private_objective, GLASSES_OBJECTIVE);
    assert.equal(card.requires_approval, true);

    const db = new FakeDb();
    db.seed("sage_items", [
      {
        id: "item-msg",
        visible_to: PARENT,
        plan: {
          proposals: [
            {
              id: "msg-1",
              type: "reply_coparent",
              draft: OPEN_QUESTION,
              requires_approval: true,
              private_objective: PED_OBJECTIVE,
            },
          ],
        },
      },
    ]);
    const folded = await applyTurnToTasks({
      admin: asAdmin(db),
      userId: PARENT,
      decision: created.taskDecision,
      proposals: created.result.plan.proposals,
    });
    assert.equal(folded.folded, false);
    const ped = db.table("sage_items")[0].plan as { proposals: Record<string, unknown>[] };
    assert.equal(ped.proposals.length, 1);
    assert.equal(ped.proposals[0].draft, OPEN_QUESTION);
    assert.equal(ped.proposals[0].private_objective, PED_OBJECTIVE);
  }

  // --- Two live message tasks: revise each, ambiguous asks, cancel one ------------------------------
  {
    const items = twoMessageItems();
    const tasks = openTasksFromItems({
      ownerId: PARENT,
      caseId: CASE,
      sessionId: SESSION,
      items,
    });
    assert.equal(liveTasksOfKind(tasks, "message").length, 2);
    assert.equal(liveTaskOfKind(tasks, "message"), null);
    assert.equal(new Set(liveTasksOfKind(tasks, "message").map((task) => task.id)).size, 2);
    assert.equal(tasks.find((task) => task.id === "item-msg")?.privateObjective, PED_OBJECTIVE);
    assert.equal(tasks.find((task) => task.id === "item-glasses")?.privateObjective, GLASSES_OBJECTIVE);

    const conversation = conversationWith(...items);
    const frame = buildContextFrame({
      parentId: PARENT,
      caseId: CASE,
      sessionId: SESSION,
      message: "Make that shorter.",
      conversation,
    });

    const pedRevise = structuralArbitration({
      frame,
      tasks: frame.openTasks,
      interpretation: interpretation(
        "message",
        "Revise the pediatrician question so it is shorter.",
        "the pediatrician disagreement"
      ),
      hasActionCard: false,
    });
    assert.equal(pedRevise.relation, "revise");
    assert.equal(pedRevise.taskId, "item-msg");

    const glassesRevise = structuralArbitration({
      frame,
      tasks: frame.openTasks,
      interpretation: interpretation("message", "Shorten the glasses note.", "Ashley needs glasses"),
      hasActionCard: false,
    });
    assert.equal(glassesRevise.relation, "revise");
    assert.equal(glassesRevise.taskId, "item-glasses");

    const ambiguous = structuralArbitration({
      frame,
      tasks: frame.openTasks,
      interpretation: interpretation("message", "Change the message.", null),
      hasActionCard: false,
    });
    assert.equal(ambiguous.relation, "ask");
    assert.equal(ambiguous.taskId, null);

    const asked = await chat("Change the message.", {
      conversation,
      action: {
        interpret: async () => interpretation("message", "Change the message.", null),
        draftMessage: async () => {
          throw new Error("ambiguous turns must not draft");
        },
      },
    });
    assert.equal(asked.taskDecision.relation, "ask");
    assert.equal(asked.result.plan.proposals.some((proposal) => proposal.type === "reply_coparent"), false);
    assert.match(asked.reply, /more than one message/i);
    const choices = asked.result.plan.proposals.find((proposal) => proposal.type === "ask_clarification");
    assert.ok(choices?.selection_options);
    assert.equal(choices?.selection_options?.length, 2);
    assert.equal(choices?.selection_options?.[1]?.taskId, "item-glasses");

    const db = new FakeDb();
    db.seed("sage_items", [
      {
        id: "item-msg",
        visible_to: PARENT,
        plan: {
          proposals: [
            {
              id: "msg-1",
              type: "reply_coparent",
              draft: OPEN_QUESTION,
              requires_approval: true,
              private_objective: PED_OBJECTIVE,
            },
          ],
        },
      },
      {
        id: "item-glasses",
        visible_to: PARENT,
        plan: {
          proposals: [
            {
              id: "msg-g1",
              type: "reply_coparent",
              draft: GLASSES_DRAFT,
              requires_approval: true,
              private_objective: GLASSES_OBJECTIVE,
            },
          ],
        },
      },
    ]);

    const notFolded = await applyTurnToTasks({
      admin: asAdmin(db),
      userId: PARENT,
      decision: askArbitration(),
      proposals: [{ type: "reply_coparent", draft: "should not land" }],
    });
    assert.equal(notFolded.folded, false);

    const pedShorter = await applyTurnToTasks({
      admin: asAdmin(db),
      userId: PARENT,
      decision: pedRevise,
      proposals: [
        {
          type: "reply_coparent",
          draft: "Please confirm in writing whether a new pediatrician depends on vaccination decisions.",
        },
      ],
      guidance: "Make that shorter.",
    });
    assert.equal(pedShorter.folded, true);
    const pedPlan = db.table("sage_items").find((row) => row.id === "item-msg")!.plan as {
      proposals: Record<string, unknown>[];
    };
    const glassesUntouched = db.table("sage_items").find((row) => row.id === "item-glasses")!.plan as {
      proposals: Record<string, unknown>[];
    };
    assert.equal(pedPlan.proposals.length, 2);
    assert.equal(proposalState(pedPlan.proposals[0]), "superseded");
    assert.equal(proposalState(pedPlan.proposals[1]), "open");
    assert.equal(pedPlan.proposals[1].approved, undefined);
    assert.equal(pedPlan.proposals[1].private_objective, PED_OBJECTIVE);
    assert.equal(glassesUntouched.proposals.length, 1);
    assert.equal(glassesUntouched.proposals[0].draft, GLASSES_DRAFT);
    assert.equal(glassesUntouched.proposals[0].private_objective, GLASSES_OBJECTIVE);
    assert.equal(glassesUntouched.proposals[0].requires_approval, true);

    const glassesShorter = await applyTurnToTasks({
      admin: asAdmin(db),
      userId: PARENT,
      decision: glassesRevise,
      proposals: [{ type: "reply_coparent", draft: "Ashley needs glasses. Can you take her Thursday?" }],
      guidance: "Make that shorter.",
    });
    assert.equal(glassesShorter.folded, true);
    const pedAfterGlasses = db.table("sage_items").find((row) => row.id === "item-msg")!.plan as {
      proposals: Record<string, unknown>[];
    };
    const glassesPlan = db.table("sage_items").find((row) => row.id === "item-glasses")!.plan as {
      proposals: Record<string, unknown>[];
    };
    assert.equal(pedAfterGlasses.proposals.length, 2);
    assert.equal(pedAfterGlasses.proposals[1].draft, "Please confirm in writing whether a new pediatrician depends on vaccination decisions.");
    assert.equal(glassesPlan.proposals.length, 2);
    assert.equal(proposalState(glassesPlan.proposals[0]), "superseded");
    assert.equal(proposalState(glassesPlan.proposals[1]), "open");
    assert.equal(glassesPlan.proposals[1].private_objective, GLASSES_OBJECTIVE);
    assert.doesNotMatch(String(glassesPlan.proposals[1].draft), /pediatrician/i);

    const canceled = await applyTurnToTasks({
      admin: asAdmin(db),
      userId: PARENT,
      decision: {
        relation: "cancel",
        taskId: "item-msg",
        currentProposalId: String(pedAfterGlasses.proposals[1].id),
        currentItemId: "item-msg",
        kind: "message",
        unread: false,
      },
      proposals: [],
    });
    assert.equal(canceled.folded, true);
    const pedCanceled = db.table("sage_items").find((row) => row.id === "item-msg")!.plan as {
      proposals: Record<string, unknown>[];
    };
    const glassesStill = db.table("sage_items").find((row) => row.id === "item-glasses")!.plan as {
      proposals: Record<string, unknown>[];
    };
    assert.equal(proposalState(pedCanceled.proposals[1]), "dismissed");
    assert.equal(proposalState(glassesStill.proposals[1]), "open");
    assert.equal(glassesStill.proposals[1].private_objective, GLASSES_OBJECTIVE);
    assert.equal(glassesStill.proposals[1].approved, undefined);
  }

  {
    const parsed = parseArbitration('{"relation":"ask","taskId":null}', []);
    assert.equal(parsed?.relation, "ask");
    assert.equal(parsed?.taskId, null);
  }

  // --- Pediatrician objective survives drafting, rejection, and a numbered selection ----------------
  {
    const CONDITION_QUESTION =
      "Would you consider a new pediatrician without requiring vaccination consent?";
    const PRIVATE_OUTCOME =
      "Obtain a written explanation of whether agreement on a new pediatrician is conditioned on vaccination consent, without revealing that this is for court.";
    const PROVIDERS = "Which providers would you consider?";
    assert.equal(draftMissesIntendedQuestion(PROVIDERS, CONDITION_QUESTION), true);
    assert.equal(draftMissesIntendedQuestion(CONDITION_QUESTION, CONDITION_QUESTION), false);
    assert.equal(
      draftExposesPrivateStrategy("I am preparing this for litigation.", {
        question: CONDITION_QUESTION,
        private_constraints: ["Do not reveal litigation strategy."],
      }),
      true
    );
    assert.equal(
      draftExposesPrivateStrategy(CONDITION_QUESTION, {
        question: CONDITION_QUESTION,
        private_constraints: ["Do not reveal litigation strategy."],
      }),
      false
    );
    assert.equal(parseSelectionAnswer("2", 2), 2);
    assert.equal(parseSelectionAnswer("Work from the #2 draft", 2), 2);
    assert.equal(parseSelectionAnswer("No, you're not listening to me.", 2), null);

    let drafts = 0;
    const pediatrician: ConversationActionModel = {
      interpret: async () => ({
        kind: "message",
        outcome: PRIVATE_OUTCOME,
        question: CONDITION_QUESTION,
        refersTo: "whether a new pediatrician can be considered without vaccination consent",
        grounding: "conversation",
        relevantFactIndexes: [],
        uncertain: [],
        disputed: [],
        recipientName: "Kevin",
        elicitation: "open_question",
        privateConstraints: ["Do not reveal litigation strategy or that this is being documented for court."],
      }),
      draftMessage: async (frame) => {
        drafts += 1;
        const correcting = frame.correctingMissedQuestion || (frame.taskObjective?.rejected.length ?? 0) > 0;
        if (!correcting && drafts === 1) return PROVIDERS;
        return frame.taskObjective?.question || CONDITION_QUESTION;
      },
    };
    const first = await chat("Please draft a message asking him that question.", { action: pediatrician });
    const card = first.result.plan.proposals.find((proposal) => proposal.type === "reply_coparent");
    assert.ok(card);
    assert.equal(card.draft, CONDITION_QUESTION);
    assert.equal(card.private_objective, PRIVATE_OUTCOME);
    assert.equal(card.grounded_in?.question, CONDITION_QUESTION);
    assert.equal(card.grounded_in?.outcome, PRIVATE_OUTCOME);
    assert.ok(card.grounded_in?.private_constraints?.some((line) => /litigation|court/i.test(line)));
    assert.doesNotMatch(card.draft ?? "", /court|litigation|documenting/i);
    assert.equal(card.requires_approval, true);
    assert.equal("executed" in card, false);
    assert.equal(first.taskDecision.relation, "new_task");

    const rejected = await chat("No, you're not listening to me. I want a revised message based on the things I have said to you.", {
      action: {
        interpret: async () => ({
          kind: "message",
          outcome: "Revise the message from what I already said.",
          question: CONDITION_QUESTION,
          refersTo: "the pediatrician disagreement",
          grounding: "conversation",
          relevantFactIndexes: [],
          uncertain: [],
          disputed: [],
          recipientName: "Kevin",
          elicitation: "open_question",
          privateConstraints: ["Do not reveal litigation strategy."],
        }),
        draftMessage: async (frame) => {
          const missed = (frame.taskObjective?.rejected.length ?? 0) > 0 || frame.correctingMissedQuestion;
          return missed ? CONDITION_QUESTION : PROVIDERS;
        },
      },
      conversation: conversationWith({
        id: "item-msg",
        itemType: "message",
        proposals: [
          {
            id: "msg-1",
            type: "reply_coparent",
            draft: PROVIDERS,
            requires_approval: true,
            private_objective: PRIVATE_OUTCOME,
            grounded_in: {
              outcome: PRIVATE_OUTCOME,
              question: CONDITION_QUESTION,
              turns: [],
              facts: [
                {
                  text: "The children were dismissed from the previous pediatrician because of the practice's vaccination policy.",
                  status: "parent_stated",
                },
              ],
              uncertain: [],
              private_constraints: ["Do not reveal litigation strategy or that this is being documented for court."],
              rejected: [],
              last_guidance: "",
              evidence_refs: [],
            },
          },
        ],
      }),
    });
    const revised = rejected.result.plan.proposals.find((proposal) => proposal.type === "reply_coparent");
    assert.ok(revised);
    assert.equal(rejected.taskDecision.relation, "revise");
    assert.equal(rejected.taskDecision.taskId, "item-msg");
    assert.equal(revised.draft, CONDITION_QUESTION);
    assert.doesNotMatch(revised.draft ?? "", /providers/i);
    assert.equal(revised.private_objective, PRIVATE_OUTCOME);
    assert.ok((revised.grounded_in?.rejected ?? []).some((note) => /not listening/i.test(note)));
    assert.equal(revised.grounded_in?.question, CONDITION_QUESTION);
    assert.equal(revised.requires_approval, true);
    assert.equal("executed" in revised, false);
    assert.equal("approved" in revised, false);

    const again = await chat("Try another draft. I don't like the ones you have.", {
      action: {
        interpret: async () => ({
          kind: "message",
          outcome: "Revise again from what I said.",
          question: CONDITION_QUESTION,
          refersTo: "the pediatrician disagreement",
          grounding: "conversation",
          relevantFactIndexes: [],
          uncertain: [],
          disputed: [],
          recipientName: "Kevin",
          elicitation: "open_question",
          privateConstraints: ["Do not reveal litigation strategy."],
        }),
        draftMessage: async (frame) =>
          (frame.taskObjective?.rejected.length ?? 0) > 0 || frame.correctingMissedQuestion
            ? CONDITION_QUESTION
            : PROVIDERS,
      },
      conversation: conversationWith({
        id: "item-msg",
        itemType: "message",
        proposals: [
          {
            id: "msg-1",
            type: "reply_coparent",
            draft: PROVIDERS,
            requires_approval: true,
            private_objective: PRIVATE_OUTCOME,
            grounded_in: revised.grounded_in,
          },
        ],
      }),
    });
    const second = again.result.plan.proposals.find((proposal) => proposal.type === "reply_coparent");
    assert.equal(again.taskDecision.relation, "revise");
    assert.equal(again.taskDecision.taskId, "item-msg");
    assert.equal(second?.draft, CONDITION_QUESTION);
    assert.doesNotMatch(second?.draft ?? "", /providers|court|litigation/i);
    assert.equal(second?.private_objective, PRIVATE_OUTCOME);
    assert.ok((second?.grounded_in?.rejected?.length ?? 0) >= 2);
    assert.ok((second?.grounded_in?.rejected ?? []).some((note) => /not listening/i.test(note)));
    assert.ok((second?.grounded_in?.rejected ?? []).some((note) => /don't like|another draft/i.test(note)));
    assert.equal(second?.grounded_in?.question, CONDITION_QUESTION);
    assert.equal(second?.requires_approval, true);

    const memory = deriveWorkingMemory([
      {
        itemId: "item-select",
        itemType: "note",
        proposals: [
          {
            id: "sel-1",
            type: "ask_clarification",
            audience: "parent",
            draft: "I have more than one message in progress. Which one should I use?\n1. pediatrician\n2. glasses",
            selection_options: [
              { index: 1, taskId: "item-msg", itemId: "item-msg", proposalId: "msg-1" },
              { index: 2, taskId: "item-glasses", itemId: "item-glasses", proposalId: "msg-g1" },
            ],
          },
        ],
      },
      {
        itemId: "item-msg",
        itemType: "message",
        proposals: [
          {
            id: "msg-1",
            type: "reply_coparent",
            draft: CONDITION_QUESTION,
            requires_approval: true,
            private_objective: PRIVATE_OUTCOME,
            grounded_in: {
              outcome: PRIVATE_OUTCOME,
              question: CONDITION_QUESTION,
              turns: [],
              facts: [],
              uncertain: [],
              private_constraints: [],
              rejected: [],
              last_guidance: "",
              evidence_refs: [],
            },
          },
        ],
      },
      {
        itemId: "item-glasses",
        itemType: "message",
        proposals: [
          {
            id: "msg-g1",
            type: "reply_coparent",
            draft: GLASSES_DRAFT,
            requires_approval: true,
            private_objective: GLASSES_OBJECTIVE,
            grounded_in: {
              outcome: GLASSES_OBJECTIVE,
              question: "Can you take Ashley to get glasses on Thursday?",
              turns: [],
              facts: [],
              uncertain: [],
              private_constraints: [],
              rejected: [],
              last_guidance: "",
              evidence_refs: [],
            },
          },
        ],
      },
    ]);
    const selected = await chat("2", {
      action: {
        interpret: async () => {
          throw new Error("a numbered selection must not be reinterpreted");
        },
        draftMessage: async (frame) => frame.taskObjective?.question || GLASSES_DRAFT,
      },
      conversation: {
        thread_subject: null,
        event: { subject: null, child: null, date: null, time: null, eventId: null },
        open_proposals: [],
        memory,
      },
    });
    assert.equal(selected.taskDecision.relation, "revise");
    assert.equal(selected.taskDecision.taskId, "item-glasses");
    assert.equal(selected.answers, "sel-1");
    const chosen = selected.result.plan.proposals.find((proposal) => proposal.type === "reply_coparent");
    assert.equal(chosen?.draft, "Can you take Ashley to get glasses on Thursday?");
    assert.doesNotMatch(chosen?.draft ?? "", /vaccination|court/i);
    assert.equal(chosen?.private_objective, GLASSES_OBJECTIVE);
    assert.equal(chosen?.requires_approval, true);
  }

  console.log("open-task tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
