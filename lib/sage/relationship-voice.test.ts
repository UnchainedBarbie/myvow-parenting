import assert from "node:assert/strict";
import {
  INCOMING_MESSAGE_LABEL,
  OUTGOING_MESSAGE_LABEL,
  incomingNoticeSentence,
  messageRelationshipLabel,
  otherParentPhrase,
  otherParentsOnCase,
  relationshipVoiceLines,
} from "@/lib/sage/relationship-voice";

const ashley = { userId: "parent-ashley" };
const kevin = { userId: "parent-kevin" };
const alex = { userId: "parent-alex" };

assert.deepEqual(
  otherParentsOnCase("parent-ashley", [ashley, kevin, { userId: "" }, kevin]),
  [kevin]
);
assert.deepEqual(otherParentsOnCase("parent-kevin", [ashley, kevin]), [ashley]);
assert.equal(otherParentPhrase(otherParentsOnCase("parent-ashley", [ashley, kevin]).length), "your co-parent");
assert.equal(otherParentPhrase(otherParentsOnCase("parent-ashley", [ashley, kevin, alex]).length), "your co-parents");
assert.equal(otherParentPhrase(0), null);

const voice = relationshipVoiceLines(1).join(" ");
assert.match(voice, /Refer to them as you or your/);
assert.match(voice, /your co-parent/);
assert.doesNotMatch(voice, /Kevin|Ashley/);
assert.match(relationshipVoiceLines(2).join(" "), /your co-parents/);

assert.equal(messageRelationshipLabel("incoming"), INCOMING_MESSAGE_LABEL);
assert.equal(messageRelationshipLabel("outgoing"), OUTGOING_MESSAGE_LABEL);
assert.equal(incomingNoticeSentence(), "Message from your co-parent. It is saved in Messages.");
assert.doesNotMatch(incomingNoticeSentence(), /@|Kevin/);

console.log("relationship voice tests passed");
