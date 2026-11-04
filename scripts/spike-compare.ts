/**
 * Replay the same parent turns through the existing chat path and the one-call spike.
 * Prints both outputs. Not wired into the app.
 *
 * Run: npx tsx scripts/spike-compare.ts
 */

import { config } from "dotenv";
import { resolve } from "path";
import { processChatMessage, type ChatProcessResult } from "../lib/sage/chat";
import type { ConversationContext } from "../lib/sage/conversation-context";
import type { KnownChild } from "../lib/sage/calendar-chat";
import type { KnownCoparent } from "../lib/sage/chat-intent";
import { proposalState } from "../lib/sage/proposal-lifecycle";
import { deriveWorkingMemory, type MemorySource } from "../lib/sage/working-memory";
import {
  oneCallTurn,
  type SpikeCaseFacts,
  type SpikeDraft,
  type SpikeObjective,
  type SpikeOutput,
  type SpikeTurn,
} from "../lib/sage/spike/one-call";
import { assertObligationExamples, oneCallTurnV2, type SpikeDraftV2, type SpikeV2Output } from "../lib/sage/spike/one-call-v2";
import {
  assertCancelSelectionExamples,
  assertInventedAgreementRejected,
  inventedAgreementProblems,
  oneCallTurnV3,
  type SpikeDraftV3,
  type SpikeObjectiveV3,
  type SpikeV3Output,
} from "../lib/sage/spike/one-call-v3";

config({ path: resolve(process.cwd(), ".env.local") });

const TODAY = new Date("2026-11-04T18:00:00Z");
const PARENT = "parent-ashley";
const CASE = "case-1";
const SESSION = "session-spike";
const KEVIN: KnownCoparent = { name: "Kevin", email: "kevin@example.com" };
const CHILDREN: KnownChild[] = [
  { id: "child-ashley", name: "Ashley" },
  { id: "child-emma", name: "Emma" },
];

const CONSENT = "Is agreement to a new pediatrician conditional on vaccination consent?";
const CONSENT_FACT =
  "Agreement to a new pediatrician was discussed as conditional on vaccination consent.";

const CASE_FACTS: SpikeCaseFacts = {
  children: CHILDREN.map((child) => ({ name: child.name })),
  events: [],
  expenses: [],
  documents: [],
  coparent: { name: KEVIN.name, email: KEVIN.email },
};

const ESTABLISH =
  "Agreement to a new pediatrician was discussed as conditional on vaccination consent. That is the question I want asked.";
const DECISION =
  "He skipped the designated decision-maker process and emailed the office himself.";
const DRAFT = "Draft a message to my co-parent about the pediatrician.";
const DIRECT = "Make it more direct.";
const CANCEL = "Cancel that message.";
const DENTIST = "Actually ask him about the dentist instead.";
const FUNDRAISER = "Draft a message about the school fundraiser.";
const SHORTER = "Make it shorter.";
const COLD =
  "The children's pediatrician dismissed them from the practice over a year ago because my co-parent will not agree to vaccines. The children need a doctor. He keeps arguing they should stay with that doctor and will not address the pediatrician list I sent. I want it documented as explicitly as possible that he is using coercive control to influence my decisions. Can you draft a message?";

const CONSENT_OBJECTIVE = {
  outcome: "Obtain his written position on a new pediatrician.",
  question: CONSENT,
  turns: [] as number[],
  facts: [{ text: CONSENT_FACT, status: "parent_stated" }],
  uncertain: [] as string[],
  private_constraints: [] as string[],
  rejected: [] as string[],
  last_guidance: "",
  evidence_refs: [] as string[],
  history: [] as unknown[],
};

type Item = { itemId: string; itemType: string; proposals: Record<string, unknown>[] };

function field(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

type ExistingSession = {
  items: Item[];
  turns: SpikeTurn[];
};

type SpikeSession = {
  turns: SpikeTurn[];
  drafts: SpikeDraft[];
  objective: SpikeObjective;
  nextId: number;
};

type SpikeV2Session = {
  turns: SpikeTurn[];
  drafts: SpikeDraftV2[];
  objective: SpikeObjective;
  nextId: number;
};

type SpikeV3Session = {
  turns: SpikeTurn[];
  drafts: SpikeDraftV3[];
  objective: SpikeObjectiveV3 | null;
  focusDraftId: string | null;
  nextId: number;
};

type TurnSpec = { label: string; message: string };

const originalFetch = globalThis.fetch;

async function measured<T>(run: () => Promise<T>): Promise<{ value: T; calls: number; ms: number }> {
  let calls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("api.anthropic.com")) calls += 1;
    return originalFetch(input, init);
  }) as typeof fetch;
  const start = Date.now();
  try {
    const value = await run();
    return { value, calls, ms: Date.now() - start };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function conversationOf(items: Item[]): ConversationContext {
  return {
    thread_subject: null,
    event: { subject: null, child: null, date: null, time: null, eventId: null },
    open_proposals: items.flatMap((item) =>
      item.proposals
        .filter((row) => field(row, "type") !== "ask_clarification" && field(row, "type") !== "note_only" && proposalState(row) === "open")
        .map((row) => ({
          type: field(row, "type"),
          text: field(row, "revised_text") || field(row, "draft"),
        }))
    ),
    memory: deriveWorkingMemory(items as MemorySource[]),
  };
}

function liveReplyItems(items: Item[]): Item[] {
  return items.filter((item) =>
    item.proposals.some((row) => field(row, "type") === "reply_coparent" && proposalState(row) === "open")
  );
}

function applyExisting(items: Item[], result: ChatProcessResult): Item[] {
  const next = items.map((item) => ({
    itemId: item.itemId,
    itemType: item.itemType,
    proposals: item.proposals.map((row) => ({ ...row })),
  }));
  if (result.taskDecision.unread) return next;

  const cancelAll = result.control === "cancel_message";
  const cancelOne = result.taskDecision.relation === "cancel" && result.taskDecision.cancelScope !== "all";
  if (cancelAll || result.taskDecision.relation === "cancel") {
    const named = new Set(result.taskDecision.closeItemIds ?? []);
    for (const item of next) {
      const hit = cancelAll
        ? true
        : named.size > 0
          ? named.has(item.itemId)
          : cancelOne
            ? item.itemId === result.taskDecision.taskId
            : true;
      if (!hit) continue;
      for (const row of item.proposals) {
        if (field(row, "type") === "reply_coparent" && proposalState(row) === "open") row.status = "canceled";
      }
    }
  }

  const incoming: Record<string, unknown>[] = (result.result.plan.proposals ?? [])
    .filter((row) => row.type !== "note_only")
    .map((row, index) => ({ ...row, id: `p-${next.length}-${index}` }));
  if (incoming.length === 0) return next;

  const relation = result.taskDecision.relation;
  const taskId = result.taskDecision.taskId;
  if ((relation === "revise" || relation === "continue" || relation === "change_outcome") && taskId) {
    const item = next.find((row) => row.itemId === taskId);
    if (item) {
      for (const row of item.proposals) {
        if (field(row, "type") === "reply_coparent" && proposalState(row) === "open") row.status = "superseded";
      }
      item.proposals.push(...incoming);
      return next;
    }
  }
  next.push({
    itemId: `item-${next.length + 1}`,
    itemType: incoming.some((row) => field(row, "type") === "calendar_update")
      ? "calendar_event"
      : incoming.some((row) => field(row, "type") === "log_expense")
        ? "expense"
        : "message",
    proposals: incoming,
  });
  return next;
}

function seedMessage(id: string, body: string, objective = CONSENT_OBJECTIVE): Item {
  return {
    itemId: id,
    itemType: "message",
    proposals: [
      {
        id: `${id}-draft`,
        type: "reply_coparent",
        draft: body,
        requires_approval: true,
        recipient_name: KEVIN.name,
        recipient_email: KEVIN.email,
        private_objective: objective.outcome,
        grounded_in: objective,
      },
    ],
  };
}

function printExisting(result: ChatProcessResult, calls: number, ms: number) {
  console.log(`latency ${ms} ms, model calls ${calls}`);
  console.log(`reply: ${result.reply}`);
  console.log(`control: ${result.control}  relation: ${result.taskDecision.relation}`);
  const proposals = result.result.plan.proposals ?? [];
  if (proposals.length === 0) console.log("proposals: (none)");
  for (const proposal of proposals) {
    const question = proposal.grounded_in?.question ?? "";
    console.log(`proposal ${proposal.type} question=${question || "(none)"}`);
    if (proposal.draft) console.log(`  draft: ${proposal.draft}`);
    if (proposal.private_objective) console.log(`  private_objective: ${proposal.private_objective}`);
  }
}

function printSpike(output: SpikeOutput | SpikeV2Output | SpikeV3Output, calls: number, ms: number) {
  console.log(`latency ${ms} ms, model calls ${calls}`);
  console.log(`reply: ${output.reply}`);
  if (output.proposals.length === 0) console.log("proposals: (none)");
  for (const proposal of output.proposals) {
    console.log(`proposal ${JSON.stringify(proposal)}`);
  }
  if ("storedObjective" in output) {
    const stored = output.storedObjective;
    if (!stored) console.log("storedObjective: (unchanged)");
    else {
      const words = "words" in stored && stored.words ? `words=${stored.words} | ` : "";
      console.log(`storedObjective: ${words}${stored.question} | ${stored.outcome}`);
    }
  }
  const noted = output.guard.filter((note) => note.problems.length > 0 || note.action !== "kept");
  if (noted.length === 0) console.log("guard: kept");
  for (const note of noted) {
    console.log(`guard ${note.kind} ${note.draft_id ?? ""} ${note.action}: ${note.problems.join("; ")}`);
  }
}

async function runExisting(session: ExistingSession, message: string) {
  const run = await measured(() =>
    processChatMessage({
      message,
      case_id: CASE,
      timezone: "America/Denver",
      today: TODAY,
      conversation: conversationOf(session.items),
      coparents: [KEVIN],
      children: CHILDREN,
      events: [],
      documents: [],
      viewerId: PARENT,
      viewerRole: "parent",
      recentTurns: session.turns,
      parentContext: [],
      sessionId: SESSION,
      shadow: false,
    })
  );
  session.items = applyExisting(session.items, run.value);
  session.turns = [...session.turns, { role: "parent", text: message }, { role: "sage", text: run.value.reply }];
  return run;
}

function applySpike(session: SpikeSession, message: string, output: SpikeOutput) {
  session.turns = [...session.turns, { role: "parent", text: message }, { role: "sage", text: output.reply }];
  let objective = session.objective;
  let drafts = session.drafts.map((draft) => ({ ...draft }));
  for (const proposal of output.proposals) {
    if (proposal.type === "draft_message") {
      drafts.push({ id: `d${session.nextId++}`, body: proposal.body });
      if (proposal.objective) objective = { question: proposal.objective, outcome: proposal.objective };
    } else if (proposal.type === "revise_draft") {
      drafts = drafts.map((draft) => (draft.id === proposal.draft_id ? { ...draft, body: proposal.body } : draft));
    } else if (proposal.type === "cancel_draft") {
      drafts = drafts.filter((draft) => draft.id !== proposal.draft_id);
    }
  }
  session.drafts = drafts;
  session.objective = objective;
}

async function runSpike(session: SpikeSession, message: string) {
  const run = await measured(() =>
    oneCallTurn({
      message,
      recentTurns: session.turns,
      liveDrafts: session.drafts,
      establishedObjective: session.objective,
      caseFacts: CASE_FACTS,
    })
  );
  applySpike(session, message, run.value);
  return run;
}

function objectiveOf(text: string): SpikeObjective {
  const trimmed = text.trim();
  return trimmed ? { question: trimmed, outcome: trimmed } : null;
}

function applySpikeV2(session: SpikeV2Session, message: string, output: SpikeV2Output) {
  session.turns = [...session.turns, { role: "parent", text: message }, { role: "sage", text: output.reply }];
  if (output.storedObjective) session.objective = output.storedObjective;
  let drafts = session.drafts.map((draft) => ({ ...draft }));
  for (const proposal of output.proposals) {
    if (proposal.type === "draft_message") {
      drafts.push({
        id: `d${session.nextId++}`,
        body: proposal.body,
        objective: objectiveOf(proposal.objective) ?? session.objective,
      });
    } else if (proposal.type === "revise_draft") {
      const nextObjective = objectiveOf(String((proposal as { objective?: string }).objective ?? ""));
      drafts = drafts.map((draft) =>
        draft.id === proposal.draft_id
          ? { ...draft, body: proposal.body, objective: nextObjective ?? draft.objective }
          : draft
      );
    } else if (proposal.type === "cancel_draft") {
      drafts = drafts.filter((draft) => draft.id !== proposal.draft_id);
    }
  }
  session.drafts = drafts;
}

async function runSpikeV2(session: SpikeV2Session, message: string) {
  const run = await measured(() =>
    oneCallTurnV2({
      message,
      recentTurns: session.turns,
      liveDrafts: session.drafts,
      storedObjective: session.objective,
      caseFacts: CASE_FACTS,
      today: TODAY,
    })
  );
  applySpikeV2(session, message, run.value);
  return run;
}

function objectiveV3(words: string, question = words, outcome = words): SpikeObjectiveV3 {
  return { words, question, outcome };
}

function applySpikeV3(session: SpikeV3Session, message: string, output: SpikeV3Output) {
  session.turns = [...session.turns, { role: "parent", text: message }, { role: "sage", text: output.reply }];
  if (output.storedObjective) session.objective = output.storedObjective;
  let drafts = session.drafts.map((draft) => ({ ...draft }));
  const touched: string[] = [];
  for (const proposal of output.proposals) {
    if (proposal.type === "draft_message") {
      const id = `d${session.nextId++}`;
      const own = objectiveOf(proposal.objective);
      drafts.push({
        id,
        body: proposal.body,
        objective: own ? objectiveV3(own.question, own.question, own.outcome) : session.objective,
      });
      touched.push(id);
    } else if (proposal.type === "revise_draft") {
      const nextObjective = objectiveOf(String((proposal as { objective?: string }).objective ?? ""));
      drafts = drafts.map((draft) =>
        draft.id === proposal.draft_id
          ? {
              ...draft,
              body: proposal.body,
              objective: nextObjective ? objectiveV3(nextObjective.question) : draft.objective,
            }
          : draft
      );
      touched.push(proposal.draft_id);
    } else if (proposal.type === "cancel_draft") {
      drafts = drafts.filter((draft) => draft.id !== proposal.draft_id);
    }
  }
  session.drafts = drafts;
  session.focusDraftId = touched.length === 1 ? touched[0] : null;
}

async function runSpikeV3(session: SpikeV3Session, message: string) {
  const run = await measured(() =>
    oneCallTurnV3({
      message,
      recentTurns: session.turns,
      liveDrafts: session.drafts,
      storedObjective: session.objective,
      focusDraftId: session.focusDraftId,
      caseFacts: CASE_FACTS,
      today: TODAY,
    })
  );
  applySpikeV3(session, message, run.value);
  return run;
}

async function sequence(
  title: string,
  turns: TurnSpec[],
  existing: ExistingSession,
  spikeV2: SpikeV2Session,
  spikeV3: SpikeV3Session
) {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
  for (const turn of turns) {
    console.log(`\n--- ${turn.label} ---`);
    console.log(`PARENT: ${turn.message}`);
    console.log("\n[existing]");
    const left = await runExisting(existing, turn.message);
    printExisting(left.value, left.calls, left.ms);
    console.log("\n[spike v2]");
    const middle = await runSpikeV2(spikeV2, turn.message);
    printSpike(middle.value, middle.calls, middle.ms);
    console.log(`live drafts: ${spikeV2.drafts.map((draft) => draft.id).join(", ") || "(none)"}`);
    console.log("\n[spike v3]");
    const right = await runSpikeV3(spikeV3, turn.message);
    printSpike(right.value, right.calls, right.ms);
    console.log(
      `live drafts: ${spikeV3.drafts.map((draft) => `${draft.id} body=${draft.body}`).join(" || ") || "(none)"}`
    );
  }
}

function freshExisting(): ExistingSession {
  return { items: [], turns: [] };
}

function freshSpike(): SpikeSession {
  return { turns: [], drafts: [], objective: null, nextId: 1 };
}

function freshSpikeV2(): SpikeV2Session {
  return { turns: [], drafts: [], objective: null, nextId: 1 };
}

function freshSpikeV3(): SpikeV3Session {
  return { turns: [], drafts: [], objective: null, focusDraftId: null, nextId: 1 };
}

function oneDraftExisting(): ExistingSession {
  return {
    items: [seedMessage("item-live", CONSENT)],
    turns: [
      { role: "parent", text: DRAFT },
      { role: "sage", text: "Here is your message to your co-parent. Nothing is sent until you review it and choose Send." },
    ],
  };
}

function oneDraftSpikeV2(): SpikeV2Session {
  const objective = { question: CONSENT, outcome: CONSENT_OBJECTIVE.outcome };
  return {
    turns: oneDraftSpike().turns,
    drafts: [{ id: "d1", body: CONSENT, objective }],
    objective,
    nextId: 2,
  };
}

function oneDraftSpikeV3(): SpikeV3Session {
  const objective = objectiveV3(CONSENT, CONSENT, CONSENT_OBJECTIVE.outcome);
  return {
    turns: oneDraftSpike().turns,
    drafts: [{ id: "d1", body: CONSENT, objective }],
    objective,
    focusDraftId: "d1",
    nextId: 2,
  };
}

function oneDraftSpike(): SpikeSession {
  return {
    turns: [
      { role: "parent", text: DRAFT },
      { role: "sage", text: "Here is your message to your co-parent. Nothing is sent until you review it and choose Send." },
    ],
    drafts: [{ id: "d1", body: CONSENT }],
    objective: { question: CONSENT, outcome: CONSENT_OBJECTIVE.outcome },
    nextId: 2,
  };
}

function twoDraftExisting(): ExistingSession {
  return {
    items: [
      seedMessage("item-live", CONSENT),
      seedMessage("item-fund", "Please send the school fundraiser form back.", {
        ...CONSENT_OBJECTIVE,
        question: "Please send the school fundraiser form back.",
        outcome: "Ask him to send the school fundraiser form back.",
        facts: [{ text: "There is a school fundraiser form.", status: "parent_stated" }],
      }),
    ],
    turns: [
      { role: "parent", text: DRAFT },
      { role: "sage", text: "Here is your message to your co-parent. Nothing is sent until you review it and choose Send." },
      { role: "parent", text: FUNDRAISER },
      { role: "sage", text: "Here is a second message. Nothing is sent until you review it and choose Send." },
    ],
  };
}

function twoDraftSpikeV3(): SpikeV3Session {
  const consent = objectiveV3(CONSENT, CONSENT, CONSENT_OBJECTIVE.outcome);
  const fundraiser = objectiveV3(
    "Please send the school fundraiser form back.",
    "Please send the school fundraiser form back.",
    "Ask him to send the school fundraiser form back."
  );
  return {
    turns: twoDraftSpike().turns,
    drafts: [
      { id: "d1", body: CONSENT, objective: consent },
      { id: "d2", body: "Please send the school fundraiser form back.", objective: fundraiser },
    ],
    objective: consent,
    focusDraftId: null,
    nextId: 3,
  };
}

function twoDraftSpikeV2(): SpikeV2Session {
  const consent = { question: CONSENT, outcome: CONSENT_OBJECTIVE.outcome };
  const fundraiser = {
    question: "Please send the school fundraiser form back.",
    outcome: "Ask him to send the school fundraiser form back.",
  };
  return {
    turns: twoDraftSpike().turns,
    drafts: [
      { id: "d1", body: CONSENT, objective: consent },
      { id: "d2", body: "Please send the school fundraiser form back.", objective: fundraiser },
    ],
    objective: consent,
    nextId: 3,
  };
}

function twoDraftSpike(): SpikeSession {
  return {
    turns: [
      { role: "parent", text: DRAFT },
      { role: "sage", text: "Here is your message to your co-parent. Nothing is sent until you review it and choose Send." },
      { role: "parent", text: FUNDRAISER },
      { role: "sage", text: "Here is a second message. Nothing is sent until you review it and choose Send." },
    ],
    drafts: [
      { id: "d1", body: CONSENT },
      { id: "d2", body: "Please send the school fundraiser form back." },
    ],
    objective: { question: CONSENT, outcome: CONSENT_OBJECTIVE.outcome },
    nextId: 3,
  };
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    console.error("ANTHROPIC_API_KEY is not set. Add it to .env.local and retry.");
    process.exit(1);
  }
  assertObligationExamples();
  assertInventedAgreementRejected();
  await assertCancelSelectionExamples();
  console.log(
    `obligation guard rejected the v1 sentence with no parenting plan in the source: ${inventedAgreementProblems().join(", ")}`
  );
  console.log("cancel with two live drafts: unclear asks, the focused draft cancels alone, the named fundraiser cancels alone.");
  console.log("Spike comparison. Existing path, spike v2, and spike v3. The shadow call is off.");
  console.log(`live drafts at start of seeded sequences: ${liveReplyItems(oneDraftExisting().items).length} and ${liveReplyItems(twoDraftExisting().items).length}`);

  await sequence(
    "1-3. Consent objective, decision-maker discussion, draft, revise, cancel",
    [
      { label: "1a establish", message: ESTABLISH },
      { label: "1b decision-maker", message: DECISION },
      { label: "1 draft about the pediatrician", message: DRAFT },
      { label: "2 make it more direct", message: DIRECT },
      { label: "3 cancel that message", message: CANCEL },
    ],
    freshExisting(),
    freshSpikeV2(),
    freshSpikeV3()
  );

  await sequence(
    "4. One draft live: ask about the dentist instead",
    [{ label: "4 dentist", message: DENTIST }],
    oneDraftExisting(),
    oneDraftSpikeV2(),
    oneDraftSpikeV3()
  );

  await sequence(
    "5. One draft live: draft about the school fundraiser",
    [{ label: "5 fundraiser", message: FUNDRAISER }],
    oneDraftExisting(),
    oneDraftSpikeV2(),
    oneDraftSpikeV3()
  );

  await sequence(
    "6. Two drafts live: make it shorter",
    [{ label: "6 shorter", message: SHORTER }],
    twoDraftExisting(),
    twoDraftSpikeV2(),
    twoDraftSpikeV3()
  );

  await sequence(
    "7. Cold start, one turn",
    [{ label: "7 cold start", message: COLD }],
    freshExisting(),
    freshSpikeV2(),
    freshSpikeV3()
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
