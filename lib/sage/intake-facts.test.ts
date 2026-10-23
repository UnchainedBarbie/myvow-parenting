import assert from "node:assert/strict";
import { authorizeInboundIntake } from "@/lib/messages/authorize-inbound-intake";
import {
  correctIntakeProposals,
  correctIntakeText,
  senderIsAccountOwner,
} from "@/lib/sage/intake-facts";

const owner = "owner-1";
const allison = "allison@theholisticaccountant.com";

const self = authorizeInboundIntake(
  {
    fromEmail: allison,
    caseMemberId: "member-allison",
    userId: "other-user",
    isKnownCaseMember: true,
  },
  owner,
  [allison]
);
assert.equal(self.authorized && self.branch, "self");

const byUser = authorizeInboundIntake(
  {
    fromEmail: allison,
    caseMemberId: "member-allison",
    userId: owner,
    isKnownCaseMember: true,
  },
  owner,
  []
);
assert.equal(byUser.authorized && byUser.branch, "self");

const coparent = authorizeInboundIntake(
  {
    fromEmail: "kevin@example.com",
    caseMemberId: "member-kevin",
    userId: "kevin-user",
    isKnownCaseMember: true,
  },
  owner,
  [allison]
);
assert.equal(coparent.authorized && coparent.branch, "coparent");

const sheet = [{ filename: "Pediatrician listing.xlsx", read: false }];
const contradictory =
  "The attachment didn't come through on my end. A reply is ready for you to review.";
const corrected = correctIntakeText(contradictory, { stored: sheet, ownMessage: false });
assert.match(corrected, /Pediatrician listing\.xlsx is attached/);
assert.match(corrected, /haven't read its contents/);
assert.doesNotMatch(corrected, /didn'?t come through/i);

const ownText = correctIntakeText(contradictory, { stored: sheet, ownMessage: true });
assert.match(ownText, /Pediatrician listing\.xlsx is attached/);
assert.match(ownText, /Nothing has been filed or sent/);
assert.doesNotMatch(ownText, /co-parent|didn'?t come through/i);

const proposals = correctIntakeProposals(
  [
    { type: "reply_coparent", draft: "I didn't get the attachment. Please resend the spreadsheet.", status: "" },
    { type: "log_document", draft: "Save Pediatrician listing.xlsx", status: "" },
    { type: "note_only", draft: "Noted.", status: "" },
  ],
  { storedFileNames: ["Pediatrician listing.xlsx"], ownMessage: true }
);
assert.equal(proposals.changed, true);
assert.equal(proposals.proposals[0].status, "dismissed");
assert.equal(proposals.proposals[1].status, "dismissed");
assert.equal(proposals.proposals[2].status, "");

const kept = correctIntakeProposals(
  [{ type: "reply_coparent", draft: "Thanks, I will review the pediatrician list.", status: "" }],
  { storedFileNames: ["Pediatrician listing.xlsx"], ownMessage: false }
);
assert.equal(kept.changed, false);
assert.equal(kept.proposals[0].status, "");

const resend = correctIntakeProposals(
  [{ type: "reply_coparent", draft: "The attachment didn't come through. Please resend it.", status: "" }],
  { storedFileNames: ["Pediatrician listing.xlsx"], ownMessage: false }
);
assert.equal(resend.proposals[0].status, "dismissed");

assert.equal(
  senderIsAccountOwner({
    senderId: null,
    senderEmail: "Allison@TheHolisticAccountant.com",
    ownerId: owner,
    ownerEmails: [allison],
  }),
  true
);
assert.equal(
  senderIsAccountOwner({
    senderId: "kevin-user",
    senderEmail: "kevin@example.com",
    ownerId: owner,
    ownerEmails: [allison],
  }),
  false
);

console.log("intake fact tests passed");
