import assert from "node:assert/strict";
import { routeChatIntent } from "@/lib/sage/chat-intent";
import type { ConversationContext } from "@/lib/sage/conversation-context";
import {
  buildShadowPacket,
  compareSnapshots,
  routerSnapshot,
  SHADOW_TOOL,
  SHADOW_TOOL_NAME,
  validateShadowOutput,
  type ShadowTurnInput,
  type ValidatedAction,
} from "@/lib/sage/shadow-contract";
import { runShadowInterpreter, scheduleShadowComparison } from "@/lib/sage/shadow-interpreter";
import { deriveWorkingMemory } from "@/lib/sage/working-memory";

const today = new Date("2026-10-21T18:00:00Z");
const timezone = "America/Denver";
const children = [
  { id: "child-ashley", name: "Ashley" },
  { id: "child-avery", name: "Avery" },
];
const secretPath = "secrets/vault/object.pdf";
const privateTitle = "PRIVATE-MARKER evaluation";
const privateNotes = "THERAPY-NOTES-PRIVATE";
const hiddenId = "doc-11111111-1111-1111-1111-111111111111";
const email = "kevin@example.com";

const documents = [
  {
    id: hiddenId,
    title: "Ashley — Occupational Therapy Evaluation",
    description: "Occupational therapy evaluation for Ashley",
    category: "therapy",
    fileName: "ashley ot evaluation.png",
    childIds: ["child-ashley"],
    createdAt: "2026-10-20T18:00:00Z",
    visibility: "parents_only",
    uploadedBy: "parent-1",
    storagePath: secretPath,
  },
  {
    id: "doc-private",
    title: privateTitle,
    description: "other parent only",
    category: "therapy",
    fileName: "private.pdf",
    childIds: ["child-ashley"],
    createdAt: "2026-10-19T18:00:00Z",
    visibility: "private",
    uploadedBy: "other-parent",
  },
];

const calendarMemory = deriveWorkingMemory([
  {
    itemId: "item-cal",
    itemType: "calendar_event",
    proposals: [
      {
        id: "cal-1",
        type: "calendar_update",
        draft: "Add to calendar: Ashley's dentist, Fri Oct 23.",
        date: "2026-10-23",
        title: "Ashley's dentist",
        depends_on: "time",
        requires_approval: true,
      },
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

const dentistConversation: ConversationContext = {
  thread_subject: "Ashley dentist",
  event: { subject: "dentist", child: "Ashley", date: "2026-10-23", time: null, eventId: null },
  open_proposals: [{ type: "ask_clarification", text: "What time is Ashley's dentist appointment?" }],
  memory: calendarMemory,
};

const documentMemory = deriveWorkingMemory([
  {
    itemId: "item-doc",
    itemType: "document",
    proposals: [
      {
        id: "prop-doc",
        type: "log_document",
        title: "Ashley — Occupational Therapy Evaluation",
        description: "Occupational therapy evaluation for Ashley",
        attached_document_id: hiddenId,
        requires_approval: true,
        depends_on: null,
      },
    ],
  },
]);

const documentConversation: ConversationContext = {
  thread_subject: null,
  event: { subject: null, child: null, date: null, time: null, eventId: null },
  open_proposals: [
    {
      type: "log_document",
      text: "Occupational therapy evaluation for Ashley",
      document: {
        key: "doc-key",
        title: "Ashley — Occupational Therapy Evaluation",
        description: "Occupational therapy evaluation for Ashley",
        category: "therapy",
        visibility: "parents_only",
        childName: "Ashley",
        childId: "child-ashley",
        fileName: "ashley ot evaluation.png",
        documentId: hiddenId,
        requiresApproval: true,
        updatesExisting: false,
      },
    },
  ],
  memory: documentMemory,
};

const appointmentConversation: ConversationContext = {
  thread_subject: "Ashley OT",
  event: { subject: "OT appointment", child: "Ashley", date: "2026-10-20", time: "4:30 PM", eventId: "evt-ot" },
  open_proposals: [{ type: "calendar_update", text: "Add to calendar: Ashley, OT appointment." }],
  memory: deriveWorkingMemory([
    {
      itemId: "item-ot",
      itemType: "calendar_event",
      proposals: [
        {
          id: "ot-1",
          type: "calendar_update",
          title: "OT appointment",
          date: "2026-10-20",
          calendar_event_id: "evt-ot",
          requires_approval: true,
          depends_on: null,
        },
      ],
    },
  ]),
};

function action(partial: Partial<ValidatedAction> & Pick<ValidatedAction, "intent" | "domain" | "action">) {
  return {
    target_handle: partial.targetHandle ?? "",
    context_handle: partial.contextHandle ?? "",
    attachment_handle: partial.attachmentHandle ?? "",
    fields: Object.entries(partial.fields ?? {}).map(([key, value]) => ({ key, value: String(value) })),
    missing: partial.missing ?? [],
    needs_clarification: partial.needsClarification ?? false,
    intent: partial.intent,
    domain: partial.domain,
    action: partial.action,
  };
}

function evaluate(message: string, extra: Omit<ShadowTurnInput, "message" | "router">, toolActions: ReturnType<typeof action>[]) {
  const routed = routeChatIntent({
    message,
    conversation: extra.memory ? conversationFrom(extra) : undefined,
    coparents: extra.coparentName ? [{ name: extra.coparentName, email }] : [],
    children,
    events: (extra.events ?? []).map((event) => ({
      id: event.id,
      title: event.title,
      childId: event.childId,
      start: event.start,
      description: event.description ?? null,
      status: event.status ?? null,
      allDay: false,
      visibility: "family",
      createdBy: "parent-1",
    })),
    documents: extra.documents ?? documents,
    viewerId: extra.viewerId ?? "parent-1",
    viewerRole: extra.viewerRole ?? "parent",
    timezone,
    today,
  });
  const input: ShadowTurnInput = {
    message,
    ...extra,
    documents: extra.documents ?? documents,
    viewerId: extra.viewerId ?? "parent-1",
    viewerRole: extra.viewerRole ?? "parent",
    router: {
      handled: routed.handled,
      control: routed.control,
      reply: routed.reply,
      reasoning: routed.result.plan.reasoning,
      proposals: routed.result.plan.proposals,
    },
  };
  const packet = buildShadowPacket(input);
  const validated = validateShadowOutput({ actions: toolActions }, packet.catalog);
  assert.ok(validated, message);
  const comparison = compareSnapshots(routerSnapshot(input.router), validated);
  for (const proposal of routed.result.plan.proposals) {
    assert.notEqual(proposal.executed, true);
    assert.equal(proposal.requires_approval, true);
    assert.equal(proposal.type === "reply_coparent" && proposal.executed === true, false);
  }
  const prompt = packet.prompt;
  assert.equal(prompt.includes(message) || message.trim() === "", true);
  assert.equal(prompt.includes(secretPath), false);
  assert.equal(prompt.includes(privateTitle), false);
  assert.equal(prompt.includes(privateNotes), false);
  assert.equal(prompt.includes(email), false);
  assert.equal(prompt.includes(hiddenId), false);
  assert.equal(prompt.includes("child-ashley"), false);
  return { routed, packet, validated, comparison, prompt };
}

function conversationFrom(extra: Omit<ShadowTurnInput, "message" | "router">): ConversationContext | undefined {
  if (extra.memory === calendarMemory) return dentistConversation;
  if (extra.memory === documentMemory) return documentConversation;
  if (extra.memory === appointmentConversation.memory) return appointmentConversation;
  return undefined;
}

const expenseMessages = [
  "I paid $40 for Avery's therapy appointment.",
  "Can you log the $40 I spent on therapy for Avery?",
  "Avery's therapy was $40 and I already paid it.",
];
for (const message of expenseMessages) {
  const result = evaluate(message, { children, events: [] }, [
    action({ intent: "create", domain: "expense", action: "create", fields: { amount: "40", category: "therapy" } }),
  ]);
  assert.equal(result.validated.actions[0]?.intent, "create");
  assert.equal(result.validated.actions[0]?.domain, "expense");
  assert.equal(result.routed.result.plan.proposals.some((proposal) => proposal.type === "calendar_update"), false);
  assert.equal(result.routed.result.plan.proposals.some((proposal) => proposal.type === "log_expense"), true);
  assert.equal(result.comparison, "agree");
}

const retrievalMessages = [
  "Find Ashley's most recent occupational therapy evaluation.",
  "Where is Ashley's OT evaluation?",
  "Can you show me the therapy evaluation for Ashley?",
];
for (const message of retrievalMessages) {
  const result = evaluate(message, { children }, [
    action({
      intent: "retrieve",
      domain: "document",
      action: "read",
      targetHandle: "SET",
    }),
  ].map((entry) => {
    const packet = buildShadowPacket({
      message,
      children,
      documents,
      viewerId: "parent-1",
      viewerRole: "parent",
      router: { handled: true, control: "none", reply: "", proposals: [] },
    });
    return { ...entry, target_handle: packet.catalog.handleFor(`document:${hiddenId}`) ?? "" };
  }));
  assert.equal(result.validated.actions[0]?.intent, "retrieve");
  assert.equal(result.validated.actions[0]?.domain, "document");
  assert.equal(result.validated.actions[0]?.targetHandle, result.packet.catalog.handleFor(`document:${hiddenId}`));
  assert.equal(result.routed.result.plan.proposals.length, 0);
  assert.notEqual(result.routed.reply, "Got it — noted.");
  assert.equal(result.comparison, "agree");
}

const updateMessages = [
  "Please add that the evaluation was completed on October 15 to the description.",
  "Update the description to include the completion date of October 15.",
];
for (const message of updateMessages) {
  const result = evaluate(message, { children, memory: documentMemory }, [
    action({ intent: "update", domain: "document", action: "update", targetHandle: "SET" }),
  ]);
  const handle = result.packet.catalog.handleFor(`document:${hiddenId}`);
  assert.ok(handle);
  const validated = validateShadowOutput(
    { actions: [action({ intent: "update", domain: "document", action: "update", targetHandle: handle })] },
    result.packet.catalog
  );
  assert.equal(validated?.actions[0]?.targetHandle, handle);
  assert.equal(validated?.rejectedReferences, 0);
  assert.equal(result.routed.control, "revise_document");
  assert.equal(result.routed.result.plan.proposals.some((proposal) => proposal.type === "note_only"), false);
}

const timeMessages = ["4:00 PM", "It's at 4:00 PM", "The appointment is at 4 PM"];
for (const message of timeMessages) {
  const result = evaluate(message, { children, memory: calendarMemory }, [
    action({
      intent: "supply_missing",
      domain: "calendar",
      action: "answer",
      fields: { time: "16:00" },
      contextHandle: "SET",
    }),
  ]);
  const handle = result.packet.catalog.handleFor("proposal:ask-1");
  assert.ok(handle);
  assert.equal(result.prompt.includes("What time is Ashley's dentist appointment?"), true);
  assert.equal(result.prompt.includes("ask-1"), false);
  const validated = validateShadowOutput(
    {
      actions: [
        action({
          intent: "supply_missing",
          domain: "calendar",
          action: "answer",
          fields: { time: "16:00" },
          contextHandle: handle,
        }),
      ],
    },
    result.packet.catalog
  );
  assert.equal(validated?.actions[0]?.intent, "supply_missing");
  assert.equal(validated?.actions[0]?.domain, "calendar");
  assert.equal(validated?.actions[0]?.contextHandle, handle);
  assert.equal(validated?.actions[0]?.fields.time, "16:00");
  assert.notEqual(result.routed.reply, "Got it — noted.");
  assert.equal(result.routed.result.plan.proposals.some((proposal) => proposal.type === "note_only"), false);
}
assert.equal(
  routeChatIntent({
    message: "4:00 PM",
    conversation: dentistConversation,
    children,
    timezone,
    today,
  }).result.plan.proposals.some((proposal) => proposal.type === "calendar_update"),
  true
);

const interruptMessages = [
  "Add Avery's soccer game on Saturday at 10am.",
  "Please schedule Avery's soccer for Saturday at 10am.",
];
for (const message of interruptMessages) {
  const result = evaluate(
    message,
    {
      children,
      memory: calendarMemory,
      events: [
        {
          id: "evt-dentist",
          title: "Ashley's dentist",
          childId: "child-ashley",
          start: "2026-10-23T15:00:00Z",
          description: privateNotes,
        },
      ],
    },
    [action({ intent: "create", domain: "calendar", action: "create", fields: { time: "10:00" } })]
  );
  const dentist = result.packet.catalog.handleFor("event:evt-dentist");
  assert.ok(dentist);
  assert.equal(result.validated.actions[0]?.targetHandle, null);
  assert.notEqual(result.validated.actions[0]?.targetHandle, dentist);
  assert.equal(result.prompt.includes(privateNotes), false);
  assert.equal(result.routed.result.plan.proposals.some((proposal) => proposal.type === "calendar_update"), true);
  assert.equal(result.validated.actions[0]?.intent, "create");
  assert.equal(result.validated.actions[0]?.domain, "calendar");
}

const messageFollowUps = ["Can you let him know?", "Please tell him about the appointment.", "Let Kevin know."];
for (const message of messageFollowUps) {
  const result = evaluate(
    message,
    { children, memory: appointmentConversation.memory, coparentName: "Kevin" },
    [action({ intent: "message_coparent", domain: "message", action: "draft_message" })]
  );
  assert.equal(result.validated.actions[0]?.intent, "message_coparent");
  assert.equal(result.routed.result.plan.proposals.some((proposal) => proposal.type === "reply_coparent"), true);
  assert.equal(result.comparison, "agree");
  assert.equal(result.prompt.includes(email), false);
}

const fileFirst = evaluate(
  "",
  {
    children,
    attachments: [{ id: "upload-1", fileName: "secrets/vault/ashley ot evaluation.png", url: "https://files.example/signed-url" }],
  },
  [action({ intent: "create", domain: "document", action: "create", attachmentHandle: "SET", missing: ["description"], needsClarification: true })]
);
const attachmentHandle = fileFirst.packet.catalog.handleFor("attachment:upload-1");
assert.ok(attachmentHandle);
const fileValidated = validateShadowOutput(
  {
    actions: [
      action({
        intent: "create",
        domain: "document",
        action: "create",
        attachmentHandle,
        missing: ["description"],
        needsClarification: true,
      }),
    ],
  },
  fileFirst.packet.catalog
);
assert.equal(fileValidated?.actions[0]?.attachmentHandle, attachmentHandle);
assert.equal(fileValidated?.actions[0]?.missing.includes("description"), true);
assert.equal(fileFirst.prompt.includes("ashley ot evaluation.png"), true);
assert.equal(fileFirst.prompt.includes("https://files.example/signed-url"), false);
assert.equal(fileFirst.prompt.includes("secrets/vault"), false);

const describeFirstMessages = [
  "Please save Ashley's occupational therapy evaluation.",
  "I want to file Ashley's OT evaluation.",
];
for (const message of describeFirstMessages) {
  const result = evaluate(message, { children, attachments: [] }, [
    action({
      intent: "create",
      domain: "document",
      action: "create",
      missing: ["attachment"],
      needsClarification: true,
    }),
  ]);
  assert.equal(result.validated.actions[0]?.intent, "create");
  assert.equal(result.validated.actions[0]?.domain, "document");
  assert.equal(result.validated.actions[0]?.attachmentHandle, null);
  assert.equal(result.validated.actions[0]?.needsClarification, true);
  assert.equal(result.validated.actions[0]?.missing.includes("attachment"), true);
}

const bothMessages = [
  "Add Ashley's dentist Friday at 3pm and let Kevin know.",
  "Put Ashley's dentist on the calendar for Friday at 3:00 PM, and draft a message to Kevin.",
];
for (const message of bothMessages) {
  const result = evaluate(message, { children, coparentName: "Kevin" }, [
    action({ intent: "create", domain: "calendar", action: "create", fields: { time: "15:00" } }),
    action({ intent: "message_coparent", domain: "message", action: "draft_message" }),
  ]);
  assert.equal(result.validated.actions.length, 2);
  assert.equal(result.validated.actions[0]?.domain, "calendar");
  assert.equal(result.validated.actions[1]?.intent, "message_coparent");
  assert.equal(result.routed.result.plan.proposals.some((proposal) => proposal.type === "calendar_update"), true);
  assert.equal(result.routed.result.plan.proposals.some((proposal) => proposal.type === "reply_coparent"), true);
  assert.equal(result.comparison, "agree");
}

const adviceMessages = ["How should I word this?", "What should I say about the appointment?"];
for (const message of adviceMessages) {
  const result = evaluate(message, { children, coparentName: "Kevin" }, [
    action({ intent: "advice", domain: "none", action: "none" }),
  ]);
  assert.equal(result.validated.actions[0]?.intent, "advice");
  assert.equal(result.validated.actions.some((item) => item.intent === "message_coparent"), false);
  assert.equal(result.routed.result.plan.proposals.some((proposal) => proposal.type === "reply_coparent"), false);
  assert.equal(result.comparison, "agree");
}

const invented = buildShadowPacket({
  message: "Update the evaluation.",
  children,
  documents,
  viewerId: "parent-1",
  viewerRole: "parent",
  router: { handled: true, control: "none", reply: "", proposals: [] },
});
const rejected = validateShadowOutput(
  {
    actions: [
      action({
        intent: "update",
        domain: "document",
        action: "update",
        targetHandle: "99999999-9999-9999-9999-999999999999",
        fields: {
          other_parent_percent: "50",
          email: email,
          case_id: "case-1",
          child_handle: "not-a-child",
        },
      }),
    ],
  },
  invented.catalog
);
assert.ok(rejected);
assert.equal(rejected.actions[0]?.targetHandle, null);
assert.equal(rejected.actions[0]?.rejectedReference, true);
assert.equal(rejected.rejectedReferences > 0, true);
assert.equal(rejected.actions[0]?.fields.other_parent_percent, undefined);
assert.equal(rejected.actions[0]?.fields.email, undefined);
assert.equal(rejected.actions[0]?.fields.case_id, undefined);
assert.equal(rejected.actions[0]?.fields.child_handle, undefined);
assert.equal(JSON.stringify(rejected).includes(email), false);
assert.equal(JSON.stringify(rejected).includes("99999999-9999-9999-9999-999999999999"), false);

assert.equal(
  validateShadowOutput({ actions: [{ intent: "steal", domain: "document", action: "update", needs_clarification: false }] }, invented.catalog),
  null
);
assert.equal(validateShadowOutput({ actions: [] }, invented.catalog), null);
assert.equal(validateShadowOutput("{\"actions\":[]}", invented.catalog), null);

const router = routerSnapshot({
  handled: false,
  control: "none",
  reply: "",
  proposals: [],
});
assert.equal(router.fallback, true);

const baseInput: ShadowTurnInput = {
  message: "I paid $40 for Avery's therapy appointment.",
  children,
  documents,
  viewerId: "parent-1",
  viewerRole: "parent",
  router: { handled: true, control: "none", reply: "I can log that expense once you approve it.", proposals: [{ type: "log_expense" }] },
};

let fetches = 0;
scheduleShadowComparison(baseInput, {
  enabled: false,
  fetchImpl: async () => {
    fetches += 1;
    return new Response("{}", { status: 200 });
  },
});
assert.equal(fetches, 0);

async function transport() {
const logged: string[] = [];
const compared = await runShadowInterpreter(baseInput, {
  enabled: true,
  env: { ANTHROPIC_API_KEY: "test-key" },
  fetchImpl: async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.tool_choice.type, "tool");
    assert.equal(body.tool_choice.name, SHADOW_TOOL_NAME);
    assert.equal(body.tools[0].strict, true);
    assert.equal(body.tools[0].name, SHADOW_TOOL.name);
    assert.equal(String(init?.body).includes(secretPath), false);
    assert.equal(String(init?.body).includes(email), false);
    assert.equal(JSON.stringify(body).includes("test-key"), false);
    return new Response(
      JSON.stringify({
        content: [
          {
            type: "tool_use",
            name: SHADOW_TOOL_NAME,
            input: { actions: [action({ intent: "create", domain: "expense", action: "create", fields: { amount: "40" } })] },
          },
        ],
      }),
      { status: 200 }
    );
  },
  log: (record) => logged.push(JSON.stringify(record)),
});
assert.equal(compared.outcome, "compared");
assert.equal(compared.agreement, "agree");
assert.equal(compared.metric, "agree");
assert.equal(compared.shadowIntent, "create");
assert.equal(compared.shadowDomain, "expense");
assert.equal(JSON.stringify(compared).includes("therapy appointment"), false);
assert.equal(JSON.stringify(compared).includes(hiddenId), false);

const textFallback = await runShadowInterpreter(baseInput, {
  enabled: true,
  fetchImpl: async () =>
    new Response(JSON.stringify({ content: [{ type: "text", text: "{\"actions\":[{\"intent\":\"create\"}]}" }] }), {
      status: 200,
    }),
});
assert.equal(textFallback.outcome, "invalid_schema");
assert.equal(textFallback.metric, "failure");
assert.equal(textFallback.shadowIntent, null);

const apiFailure = await runShadowInterpreter(baseInput, {
  enabled: true,
  fetchImpl: async () => {
    throw new Error("network down");
  },
});
assert.equal(apiFailure.outcome, "api_error");
assert.equal(apiFailure.metric, "failure");

const httpFailure = await runShadowInterpreter(baseInput, {
  enabled: true,
  fetchImpl: async () => new Response("nope", { status: 500 }),
});
assert.equal(httpFailure.outcome, "api_error");
assert.equal(httpFailure.httpStatus, 500);

const started = Date.now();
scheduleShadowComparison(baseInput, {
  enabled: true,
  timeoutMs: 30,
  log: (record) => logged.push(record.outcome),
  fetchImpl: (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    }),
});
assert.equal(Date.now() - started < 20, true);
await new Promise((resolve) => setTimeout(resolve, 80));
assert.equal(logged.includes("timeout"), true);

const disabled = await runShadowInterpreter(baseInput, { enabled: false });
assert.equal(disabled.outcome, "disabled");
assert.equal(disabled.metric, null);
assert.equal(disabled.agreement, null);
}

async function lifetime() {
  const turnKey = "journal-turn-lifetime";
  let fetches = 0;
  const logs: string[] = [];
  const kept: Promise<unknown>[] = [];
  const deps = {
    enabled: true as const,
    keepAlive(work: Promise<unknown>) {
      kept.push(work);
    },
    log(record: { outcome: string; metric: string | null }) {
      logs.push(JSON.stringify(record));
    },
    fetchImpl: async () => {
      fetches += 1;
      await new Promise((resolve) => setTimeout(resolve, 40));
      return new Response(
        JSON.stringify({
          content: [
            {
              type: "tool_use",
              name: SHADOW_TOOL_NAME,
              input: { actions: [action({ intent: "create", domain: "expense", action: "create" })] },
            },
          ],
        }),
        { status: 200 }
      );
    },
  };
  const startedAt = Date.now();
  const first = scheduleShadowComparison({ ...baseInput, turnKey }, deps);
  const second = scheduleShadowComparison({ ...baseInput, turnKey }, deps);
  assert.equal(first, "started");
  assert.equal(second, "duplicate");
  assert.equal(Date.now() - startedAt < 30, true);
  assert.equal(fetches, 1);
  assert.equal(kept.length, 1);
  await kept[0];
  assert.equal(logs.length, 1);
  assert.match(logs[0] ?? "", /"outcome":"compared"/);
  assert.match(logs[0] ?? "", /"metric":"agree"/);
  assert.equal((logs[0] ?? "").includes(turnKey), false);
  assert.equal((logs[0] ?? "").includes(baseInput.message), false);

  const next = scheduleShadowComparison({ ...baseInput, turnKey: "journal-turn-next" }, deps);
  assert.equal(next, "started");
  await kept[1];
  assert.equal(fetches, 2);
  assert.equal(logs.length, 2);

  const outside = scheduleShadowComparison(
    { ...baseInput, turnKey: "journal-turn-outside" },
    {
      ...deps,
      keepAlive() {
        throw new Error("outside request");
      },
    }
  );
  assert.equal(outside, "started");
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(logs.length, 3);
  assert.match(logs[2] ?? "", /"metric":"agree"/);

  const packet = buildShadowPacket({
    message: "I paid $40 for Avery's school field trip.",
    memory: calendarMemory,
    children,
    documents,
    viewerId: "parent-1",
    viewerRole: "parent",
    turnKey: "journal-9f3e1c0a-1111-2222-3333-444444444444",
    router: { handled: true, control: "none", reply: "", proposals: [] },
  });
  const parsed = JSON.parse(packet.prompt) as {
    continuation: { open: boolean; kind: string };
    message: string;
  };
  assert.equal(parsed.continuation.open, true);
  assert.equal(parsed.continuation.kind, "calendar");
  assert.equal(parsed.message.includes("school field trip"), true);
  assert.equal(packet.prompt.includes("journal-9f3e1c0a-1111-2222-3333-444444444444"), false);
  assert.equal(packet.prompt.includes(privateTitle), false);
  assert.equal(packet.prompt.includes(hiddenId), false);
}

Promise.all([transport(), lifetime()]).then(
  () => console.log("shadow interpreter tests passed"),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);

