/**
 * Run with: npx tsx lib/messages/conversation-child-ids.test.ts
 */
import assert from "node:assert/strict";
import { conversationRowChildLabel } from "./conversation-child-ids";

const children = [
  { id: "ashley", first_name: "Ashley" },
  { id: "kyle", first_name: "Kyle" },
  { id: "avery", first_name: "Avery" },
  { id: "jordan", first_name: "Jordan" },
];

assert.equal(conversationRowChildLabel([], children), null);
assert.equal(conversationRowChildLabel(["ashley", "kyle", "avery", "jordan"], children), null);
assert.equal(conversationRowChildLabel(["missing"], children), null);
assert.equal(conversationRowChildLabel(["ashley"], []), null);

assert.deepEqual(conversationRowChildLabel(["ashley"], children), {
  label: "Ashley",
  full: "Ashley",
});

assert.deepEqual(conversationRowChildLabel(["avery", "ashley"], children), {
  label: "Ashley +1",
  full: "Ashley, Avery",
});

assert.deepEqual(conversationRowChildLabel(["jordan", "kyle", "ashley"], children), {
  label: "Ashley +2",
  full: "Ashley, Kyle, Jordan",
});

const three = children.slice(0, 3);
assert.equal(conversationRowChildLabel(["ashley", "kyle", "avery"], three), null);
assert.deepEqual(conversationRowChildLabel(["kyle", "avery"], three), {
  label: "Kyle +1",
  full: "Kyle, Avery",
});

console.log("conversation-child-ids.test.ts: all assertions passed");
