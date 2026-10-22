import assert from "node:assert/strict";
import { routeChatIntent } from "@/lib/sage/chat-intent";
import { buildShadowPacket } from "@/lib/sage/shadow-contract";
import {
  SHADOW_CONTEXT_TURNS,
  buildShadowConversation,
  shadowTurnsFromJournal,
} from "@/lib/sage/shadow-context";
import { deriveWorkingMemory } from "@/lib/sage/working-memory";

const secretPath = "secrets/vault/object.pdf";
const otherParent = "The other parent said the evaluation is finished.";
const documentTurns = [
  { role: "parent" as const, text: "Can you pull up Ashley's most recent occupational therapy evaluation?" },
  { role: "sage" as const, text: "I couldn't find a saved document that matches that." },
];

const documentRepeat = buildShadowConversation(documentTurns, "Can you check again?");
assert.equal(documentRepeat.this_turn, "repeat");
assert.equal(documentRepeat.prefer, "conversation");
assert.equal(documentRepeat.last_intention?.intent, "retrieve");
assert.equal(documentRepeat.last_intention?.domain, "document");
assert.equal(documentRepeat.last_intention?.outcome, "none");
assert.match(documentRepeat.last_intention?.criteria ?? "", /Ashley/);
assert.match(documentRepeat.last_intention?.criteria ?? "", /occupational therapy evaluation/i);
assert.equal(documentRepeat.turns.length <= SHADOW_CONTEXT_TURNS, true);

const calendarRepeat = buildShadowConversation(
  [
    { role: "parent", text: "What's on the calendar for Ashley next week?" },
    { role: "sage", text: "I couldn't find any events that match." },
  ],
  "Try once more"
);
assert.equal(calendarRepeat.this_turn, "repeat");
assert.equal(calendarRepeat.last_intention?.domain, "calendar");
assert.equal(calendarRepeat.last_intention?.outcome, "none");

const expenseRepeat = buildShadowConversation(
  [
    { role: "parent", text: "What did I pay for Avery's therapy?" },
    { role: "sage", text: "I couldn't find a saved expense that matches that." },
  ],
  "What about now?"
);
assert.equal(expenseRepeat.this_turn, "repeat");
assert.equal(expenseRepeat.last_intention?.domain, "expense");
assert.equal(expenseRepeat.last_intention?.outcome, "none");

const interrupted = buildShadowConversation(
  documentTurns,
  "Add Ashley's dentist appointment on Thursday at 3:30 PM."
);
assert.equal(interrupted.this_turn, "new");
assert.equal(interrupted.prefer, "message");
assert.equal(interrupted.last_intention?.domain, "document");

const calendarMemory = deriveWorkingMemory([
  {
    itemId: "item-cal",
    itemType: "calendar_event",
    proposals: [
      {
        id: "ask-1",
        type: "ask_clarification",
        draft: "What time is Ashley's dentist appointment?",
        audience: "parent",
        clarifies: "calendar",
        depends_on: "time",
        requires_approval: true,
      },
    ],
  },
]);
const afterClarification = buildShadowPacket({
  message: "Can you check again?",
  recentTurns: documentTurns,
  memory: calendarMemory,
  documents: [
    {
      id: "doc-1",
      title: "Ashley — Occupational Therapy Evaluation",
      description: "Clinical note that must stay out of the shadow packet.",
      category: "therapy",
      fileName: "ashley-ot.pdf",
      childIds: [],
      createdAt: "2026-10-22T18:00:00Z",
      visibility: "parents_only",
      uploadedBy: "parent-1",
      storagePath: secretPath,
    },
  ],
  viewerId: "parent-1",
  viewerRole: "parent",
  router: { handled: false, control: "none", reply: "", proposals: [] },
});
const parsed = JSON.parse(afterClarification.prompt) as {
  conversation: {
    this_turn: string;
    prefer: string;
    last_intention: { domain: string; criteria: string; outcome: string } | null;
  };
  continuation: { kind: string };
};
assert.equal(parsed.conversation.this_turn, "repeat");
assert.equal(parsed.conversation.prefer, "conversation");
assert.equal(parsed.conversation.last_intention?.domain, "document");
assert.equal(parsed.conversation.last_intention?.outcome, "none");
assert.equal(parsed.continuation.kind, "calendar");
assert.equal(afterClarification.prompt.includes("Clinical note"), false);
assert.equal(afterClarification.prompt.includes(secretPath), false);

const ambiguous = buildShadowConversation(documentTurns, "What about that one?");
assert.equal(ambiguous.this_turn, "ambiguous");
assert.equal(ambiguous.prefer, "conversation");
assert.equal(ambiguous.last_intention?.domain, "document");

const loaded = shadowTurnsFromJournal(
  [
    { role: "user", content: "Can you pull up Ashley's most recent occupational therapy evaluation?" },
    { role: "coparent", content: otherParent },
    { role: "sage", content: `I couldn't find a saved document. Path ${secretPath}` },
    { role: "user", content: "Can you check again?" },
  ],
  "Can you check again?"
);
assert.equal(loaded.some((turn) => turn.text.includes("other parent")), false);
assert.equal(loaded.some((turn) => turn.text.includes(secretPath)), false);
assert.equal(loaded.some((turn) => turn.text === "Can you check again?"), false);
assert.equal(loaded[0]?.role, "parent");
assert.equal(loaded.at(-1)?.role, "sage");
assert.equal(loaded.length <= SHADOW_CONTEXT_TURNS, true);

const older = Array.from({ length: 8 }, (_, index) => ({
  role: index % 2 === 0 ? "user" : "sage",
  content: `turn ${index}`,
}));
assert.equal(shadowTurnsFromJournal(older, "current").length, SHADOW_CONTEXT_TURNS);

const routed = routeChatIntent({
  message: "Can you check again?",
  children: [{ id: "child-ashley", name: "Ashley" }],
  timezone: "America/Denver",
  today: new Date("2026-10-21T18:00:00Z"),
});
assert.equal(routed.result.plan.proposals.some((proposal) => proposal.type === "log_document"), false);
assert.equal(routed.result.plan.proposals.some((proposal) => proposal.type === "calendar_update"), false);
