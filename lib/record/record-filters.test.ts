/**
 * Run with: npx tsx lib/record/record-filters.test.ts
 */
import assert from "node:assert";
import {
  appliedFilterLines,
  completenessStatement,
  exclusionDisclosure,
  formatDateSpan,
  messageMatchesFilters,
  resolveDateRange,
  resolveParentSender,
  zonedDayEndMs,
  zonedDayStartMs,
  type ConversationMeta,
  type FilterableMessage,
  type ParentIdentity,
  type RecordFilterInput,
} from "./record-filters";
import { messageNumber, separateExcluded, conversationHeading, formatConversationNumber, type RecordEntry } from "./record-present";

const TZ = "America/Denver";
const NOW = new Date("2026-10-20T18:00:00.000Z");
const VIEWER = "viewer-id";
const COPARENT = "coparent-id";

const parents: ParentIdentity[] = [
  { userId: VIEWER, emails: ["viewer@example.com"] },
  { userId: COPARENT, emails: ["coparent@example.com"] },
];

const health = new Set(["health_medical", "education"]);
const finances = new Set(["finances"]);
const conversations = new Map<string, ConversationMeta>([
  ["conv-ot", { id: "conv-ot", subject: "Ashley's OT", categories: health }],
  ["conv-ot-2", { id: "conv-ot-2", subject: "Ashley's OT", categories: finances }],
  ["conv-money", { id: "conv-money", subject: "October tuition", categories: finances }],
]);

function message(partial: Partial<FilterableMessage> & Pick<FilterableMessage, "messageId">): FilterableMessage {
  return {
    createdAtMs: new Date("2026-10-10T18:00:00.000Z").getTime(),
    conversationId: "conv-ot",
    originalContent: "Please confirm occupational therapy tomorrow.",
    senderId: VIEWER,
    senderExternalEmail: null,
    hasAttachments: false,
    ...partial,
  };
}

const baseFilters: RecordFilterInput = {
  datePreset: "all",
  from: null,
  to: null,
  category: null,
  conversationId: null,
  direction: "all",
  search: "",
  attachmentsOnly: false,
};

function match(item: FilterableMessage, filters: RecordFilterInput, attachmentIds = new Set<string>()) {
  return messageMatchesFilters(item, filters, {
    timeZone: TZ,
    now: NOW,
    conversations,
    attachmentMessageIds: attachmentIds,
    viewerId: VIEWER,
    parents,
    categoryAvailable: true,
  });
}

function run() {
  const start = zonedDayStartMs("2026-10-01", TZ);
  const end = zonedDayEndMs("2026-10-20", TZ);
  assert.strictEqual(new Date(start).toISOString(), "2026-10-01T06:00:00.000Z");
  assert.strictEqual(new Date(end).toISOString(), "2026-10-21T05:59:59.999Z");

  const october = { ...baseFilters, datePreset: "custom" as const, from: "2026-10-01", to: "2026-10-20" };
  assert.strictEqual(match(message({ messageId: "before", createdAtMs: new Date("2026-10-01T05:59:59.000Z").getTime() }), october), false);
  assert.strictEqual(match(message({ messageId: "start", createdAtMs: start }), october), true);
  assert.strictEqual(match(message({ messageId: "end", createdAtMs: end }), october), true);
  assert.strictEqual(match(message({ messageId: "after", createdAtMs: new Date("2026-10-21T06:00:00.000Z").getTime() }), october), false);

  const last30 = resolveDateRange({ ...baseFilters, datePreset: "30" }, TZ, NOW);
  assert.deepStrictEqual(last30, { from: "2026-09-20", to: "2026-10-20" });

  const ot = message({ messageId: "ot-1" });
  const sibling = message({
    messageId: "ot-2",
    originalContent: "See you at pickup.",
  });
  assert.strictEqual(match(ot, { ...baseFilters, category: "health_medical" }), true);
  assert.strictEqual(match(ot, { ...baseFilters, category: "finances" }), false);
  const both = [ot, sibling].filter((item) => match(item, { ...baseFilters, category: "health_medical" }));
  assert.deepStrictEqual(both.map((item) => item.messageId), ["ot-1", "ot-2"]);
  assert.strictEqual(new Set(both.map((item) => item.messageId)).size, both.length);

  assert.strictEqual(match(ot, { ...baseFilters, conversationId: "conv-ot" }), true);
  assert.strictEqual(
    match(message({ messageId: "other", conversationId: "conv-ot-2", originalContent: "Same subject, other thread." }), {
      ...baseFilters,
      conversationId: "conv-ot",
    }),
    false
  );

  assert.strictEqual(match(ot, { ...baseFilters, direction: "sent" }), true);
  assert.strictEqual(match(ot, { ...baseFilters, direction: "received" }), false);
  assert.strictEqual(
    match(message({ messageId: "in", senderId: COPARENT, senderExternalEmail: "viewer@example.com" }), {
      ...baseFilters,
      direction: "received",
    }),
    true
  );
  assert.strictEqual(
    match(message({ messageId: "email-only", senderId: null, senderExternalEmail: "coparent@example.com" }), {
      ...baseFilters,
      direction: "received",
    }),
    true
  );
  assert.strictEqual(
    match(message({ messageId: "stranger", senderId: "other-user" }), { ...baseFilters, direction: "sent" }),
    false
  );

  assert.strictEqual(match(ot, { ...baseFilters, search: "Occupational" }), true);
  assert.strictEqual(match(sibling, { ...baseFilters, search: "occupational" }), false);
  assert.strictEqual(match(sibling, { ...baseFilters, search: "ashley's ot" }), true);
  assert.strictEqual(
    match(message({ messageId: "money", conversationId: "conv-money", originalContent: "Paid the invoice." }), {
      ...baseFilters,
      search: "occupational",
    }),
    false
  );

  assert.strictEqual(match(ot, { ...baseFilters, attachmentsOnly: true }, new Set(["ot-1"])), true);
  assert.strictEqual(match(sibling, { ...baseFilters, attachmentsOnly: true }, new Set(["ot-1"])), false);
  assert.strictEqual(
    match(message({ messageId: "flagged", hasAttachments: true }), { ...baseFilters, attachmentsOnly: true }),
    true
  );

  const combined = { ...october, category: "health_medical", direction: "sent" as const, search: "therapy", attachmentsOnly: true };
  assert.strictEqual(match(ot, combined, new Set(["ot-1"])), true);
  assert.strictEqual(match(sibling, combined, new Set(["ot-2"])), false);

  assert.strictEqual(formatDateSpan("2026-10-01", "2026-10-20"), "October 1-20, 2026");
  const lines = appliedFilterLines(
    { ...baseFilters, datePreset: "custom", from: "2026-10-01", to: "2026-10-20", category: "health_medical", conversationId: "conv-ot", search: "occupational therapy" },
    { timeZone: TZ, now: NOW, conversationSubject: "Ashley's OT", categoryAvailable: true }
  );
  assert.deepStrictEqual(
    lines.map((line) => `${line.label}: ${line.value}`),
    [
      "Date: October 1-20, 2026",
      "Category: Health & Medical",
      "Conversation: Ashley's OT",
      "Search: occupational therapy",
    ]
  );

  assert.ok(
    completenessStatement({
      included: 4,
      eligible: 4,
      filteredOut: 0,
      notExchanged: 0,
      unresolvedRecipients: 0,
      filtered: false,
    }).includes("Every stored message that qualifies as a parent-to-parent exchange is included.")
  );
  const filtered = completenessStatement({
    included: 18,
    eligible: 44,
    filteredOut: 26,
    notExchanged: 2,
    unresolvedRecipients: 18,
    filtered: true,
  });
  assert.ok(filtered.includes("18 eligible parent-to-parent messages are included."));
  assert.ok(filtered.includes("26 eligible messages are outside the selected filters."));
  assert.ok(filtered.includes("2 stored records are omitted"));
  assert.ok(filtered.includes("no stored recipient"));
  assert.ok(filtered.includes("not a complete certification"));
  assert.ok(!filtered.includes("excluded from this export"));

  const reason = "Test row written during schema inspection; not a parent communication.";
  const excluded = completenessStatement({
    included: 54,
    eligible: 54,
    filteredOut: 0,
    notExchanged: 2,
    unresolvedRecipients: 0,
    filtered: false,
    exclusions: [reason],
  });
  assert.ok(excluded.includes("2 stored records are omitted because they are a draft"));
  const quotedReason = reason.replace(/\.$/, "");
  assert.ok(excluded.includes(`and 1 stored record is excluded from this export: "${quotedReason}".`));
  assert.ok(!excluded.includes('communication.".'));
  assert.ok(excluded.includes("not a complete certification"));
  assert.ok(!excluded.includes("3 stored records are omitted"));
  const onlyExcluded = completenessStatement({
    included: 54,
    eligible: 54,
    filteredOut: 0,
    notExchanged: 0,
    unresolvedRecipients: 0,
    filtered: false,
    exclusions: [reason, reason, "A second reason."],
  });
  assert.strictEqual(
    exclusionDisclosure([reason, reason, "A second reason."]),
    `3 stored records are excluded from this export: "${quotedReason}" (2); "A second reason" (1)`
  );
  assert.ok(onlyExcluded.includes(exclusionDisclosure([reason, reason, "A second reason."])));

  const numbered: RecordEntry[] = ["", "   ", reason, null].map((value, index) => ({
    number: messageNumber(index),
    message: {
      id: `m-${index}`,
      created_at: "2026-11-04T00:00:00.000Z",
      direction: "outgoing",
      sender_id: null,
      sender_external_email: null,
      original_content: "body",
      conversation_id: null,
      current_status: "sent",
      delivery_status: null,
      delivered_at: null,
      has_attachments: false,
      record_exclusion_reason: value,
    },
  }));
  const split = separateExcluded(numbered);
  assert.deepStrictEqual(
    split.kept.map((entry) => entry.number),
    ["MSG-001", "MSG-002", "MSG-004"]
  );
  assert.deepStrictEqual(split.exclusionReasons, [reason]);
  assert.strictEqual(numbered[3].number, "MSG-004");

  const unfiltered = [ot, sibling].filter((item) => match(item, baseFilters));
  assert.strictEqual(unfiltered.length, 2);

  assert.strictEqual(formatConversationNumber(3), "CNV-003");
  assert.strictEqual(formatConversationNumber(null), null);
  assert.strictEqual(
    conversationHeading({
      id: "conv-1",
      subject: "Saturday Pickup Confirmation Request to Kevin",
      topic: "General",
      conversation_number: 4,
    }),
    "CNV-004 · Saturday Pickup Confirmation Request to Kevin"
  );
  assert.strictEqual(
    conversationHeading({
      id: "conv-old",
      subject: "Saturday Pickup Confirmation Request for Kevin",
      topic: "General",
      conversation_number: null,
    }),
    "Saturday Pickup Confirmation Request for Kevin"
  );

  console.log("record-filters.test.ts: all assertions passed.");
}

run();
