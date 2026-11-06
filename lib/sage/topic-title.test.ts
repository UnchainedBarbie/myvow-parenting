/**
 * Run with: npx tsx lib/sage/topic-title.test.ts
 */
import assert from "node:assert/strict";
import { shapeTopicTitle } from "./topic-title";

assert.equal(
  shapeTopicTitle("Saturday Pickup Confirmation Request to Kevin", ["Kevin"]),
  "Saturday pickup"
);
assert.equal(
  shapeTopicTitle("Remind Avery About Thursday Choir Concert", ["Avery"]),
  "Thursday choir concert"
);
assert.equal(shapeTopicTitle("Choir concert"), "Choir concert");
assert.equal(shapeTopicTitle("Avery", ["Avery"]), "Avery");
assert.equal(shapeTopicTitle("   "), "");

console.log("topic-title tests passed");
