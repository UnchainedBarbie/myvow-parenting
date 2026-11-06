import assert from "node:assert/strict";
import { assignedChildIds, proposedChildIds } from "./conversation-children";

const ashley = { id: "child-ashley", first_name: "Ashley" };
const kyle = { id: "child-kyle", first_name: "Kyle" };
const avery = { id: "child-avery", first_name: "Avery" };
const children = [ashley, kyle, avery];

assert.deepEqual(proposedChildIds("Remind Avery about the choir concert", children), ["child-avery"]);
assert.deepEqual(
  proposedChildIds("Ashley and Avery have a concert Thursday", children),
  ["child-ashley", "child-avery"]
);
assert.deepEqual(proposedChildIds("Saturday pickup at 5pm", children), []);
assert.deepEqual(proposedChildIds("Ask him about the children", children), []);
assert.deepEqual(proposedChildIds("Avery's coat", children), ["child-avery"]);

assert.deepEqual(
  assignedChildIds({ childIds: ["child-kyle", "child-avery"], childId: "child-ashley" }),
  ["child-kyle", "child-avery"]
);
assert.deepEqual(assignedChildIds({ childIds: [], childId: "child-ashley" }), ["child-ashley"]);
assert.deepEqual(assignedChildIds({ childIds: [], childId: null }), []);

const filter = "child-avery";
const kept = [
  { childIds: ["child-ashley", "child-avery"], childId: "child-ashley" },
  { childIds: [], childId: "child-avery" },
].filter((row) => assignedChildIds(row).some((id) => id === filter));
const dropped = [
  { childIds: ["child-kyle"], childId: null },
  { childIds: [], childId: null },
].filter((row) => assignedChildIds(row).some((id) => id === filter));
assert.equal(kept.length, 2);
assert.equal(dropped.length, 0);

console.log("conversation-children tests passed");
