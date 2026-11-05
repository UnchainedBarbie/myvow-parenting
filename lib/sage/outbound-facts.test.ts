import assert from "node:assert/strict";
import { factsOnlyDraft, requestWithoutInstrument, unsupportedObligations } from "@/lib/sage/outbound-facts";

const SENTENCE =
  "Our agreement requires that decisions about the girls' medical care go through the designated decision-maker process";

const noPlan = "He skipped the designated decision-maker process and emailed the office himself.";
assert.equal(/parenting plan/i.test(noPlan), false);
assert.ok(unsupportedObligations(SENTENCE, noPlan).length > 0);

const plan = `The parenting plan says: ${SENTENCE}.`;
assert.deepEqual(unsupportedObligations(SENTENCE, plan), []);

assert.ok(unsupportedObligations("The parenting plan says decisions go through that process.", noPlan).length > 0);
assert.ok(unsupportedObligations("You are required to notify me first.", "Please tell me why you emailed the office.").length > 0);
assert.ok(unsupportedObligations("Per the court order, the children stay with that doctor.", "The children need a doctor.").length > 0);
assert.ok(
  unsupportedObligations(
    "I want to touch base regarding our court order. As outlined in that order, medical decisions are to be shared.",
    ""
  ).length > 0
);
assert.deepEqual(
  unsupportedObligations("You are required to notify me first.", "You are required to notify me first."),
  []
);
assert.deepEqual(
  unsupportedObligations("Please tell me why you emailed the office yourself.", "He emailed the office."),
  []
);

const told =
  "Tell him the parenting plan requires a response within 48 hours.";
const withoutPlan = requestWithoutInstrument(told);
assert.equal(withoutPlan, "I am asking for a response within 48 hours.");
assert.deepEqual(unsupportedObligations(withoutPlan ?? "", ""), []);
assert.ok(unsupportedObligations("The parenting plan requires a response within 48 hours.", "").length > 0);
assert.equal(requestWithoutInstrument("Please tell me why you emailed the office yourself."), null);
assert.equal(
  requestWithoutInstrument("Remind him he's required to share medical decisions under our court order"),
  "I'd like us to make medical decisions together going forward."
);
assert.equal(
  requestWithoutInstrument("Let him know the agreement says expenses have to be submitted within 30 days"),
  "Please submit expenses within 30 days."
);
assert.deepEqual(
  unsupportedObligations("I'd like us to make medical decisions together going forward.", ""),
  []
);
assert.deepEqual(unsupportedObligations("Please submit expenses within 30 days.", ""), []);

const fallback = factsOnlyDraft(noPlan, "Please tell me why you emailed the office yourself.");
assert.equal(fallback, "I'll confirm and follow up.");
assert.equal(fallback.includes("agreement"), false);
assert.equal(fallback.includes("emailed the office"), false);
assert.equal(fallback.includes("Please tell me why"), false);
