/**
 * Run with: npx tsx lib/messages/thread-preview.test.ts
 */
import assert from "node:assert/strict";
import { latestThreadPreview } from "./thread-preview";

const older = {
  id: "msg-confirmed",
  created_at: "2026-11-05T01:37:44.360960+00:00",
  original_content: "confirmed.",
  ai_rewritten_content: "confirmed.",
};
const newer = {
  id: "msg-later",
  created_at: "2026-11-05T20:04:57.000628+00:00",
  original_content: "I have pickup Saturday at 4pm. Let me know by Friday if that doesn't work.",
  ai_rewritten_content: "I have pickup Saturday at 4pm. Let me know by Friday if that doesn't work.",
};

const preview = latestThreadPreview([newer, older]);
assert.equal(preview.preview, newer.original_content);
assert.equal(preview.created_at, newer.created_at);
assert.notEqual(preview.preview, "confirmed.");

const tied = latestThreadPreview([
  { id: "a", created_at: "2026-11-05T00:00:00.000Z", original_content: "first" },
  { id: "b", created_at: "2026-11-05T00:00:00.000Z", original_content: "second" },
]);
assert.equal(tied.preview, "second");

const wrapped = latestThreadPreview([
  {
    id: "c",
    created_at: "2026-11-05T00:00:00.000Z",
    original_content: "Saturday at 5pm.\nhttps://example.com/very/long/pickup-confirmation",
    ai_rewritten_content: null,
  },
]);
assert.equal(
  wrapped.preview,
  "Saturday at 5pm. https://example.com/very/long/pickup-confirmation"
);
assert.equal(latestThreadPreview([]).preview, "");

console.log("thread-preview.test.ts passed");
