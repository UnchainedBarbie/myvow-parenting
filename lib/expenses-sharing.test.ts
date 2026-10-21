import assert from "node:assert/strict";
import type { Proposal } from "@/lib/sage/planner";
import { expenseWorkflowStatus } from "@/lib/expenses-share";
import { coparentShareForExpense, expenseTabNetBalance } from "@/lib/expenses-tab";
import {
  detectExpenseLoggingIntent,
  detectExpensePayer,
  expenseSplitReview,
  historicalSharingGap,
  isHealthcareCategory,
  planExpenseEntry,
  resolveExpenseSharing,
  savedExpenseShare,
  type SharingResult,
  type SharingRule,
} from "@/lib/expenses-sharing";
import { stampExpenseProposal } from "@/lib/sage/expense-proposal-sharing";

const healthcare50: SharingRule = {
  category: "medical",
  child_scope: null,
  rule_type: "SPLIT_PERCENT",
  other_parent_percent: 50,
};

function share(input: {
  amount: number;
  category: string;
  rules?: SharingRule[];
  medical?: number | null;
  custody?: number | null;
  childId?: string | null;
}) {
  return resolveExpenseSharing({
    amount: input.amount,
    category: input.category,
    childId: input.childId ?? null,
    rules: input.rules ?? [],
    defaults: {
      extraordinaryMedicalPercent: input.medical === undefined ? null : input.medical,
      custodySplitPercent: input.custody === undefined ? null : input.custody,
    },
  });
}

function persisted(result: SharingResult, amount: number, payer: "self" | "coparent" = "self") {
  return savedExpenseShare(result, amount, payer);
}

const therapy = share({
  amount: 85,
  category: "therapy",
  rules: [healthcare50],
});
const therapySaved = persisted(therapy, 85, "self");
assert.equal(isHealthcareCategory("therapy"), true);
assert.equal(therapy.allocation_status, "ALLOCATED");
assert.equal(therapySaved.saveable, true);
if (therapySaved.saveable) {
  assert.equal(therapySaved.fields.other_parent_share, 42.5);
  assert.equal(therapySaved.fields.amount_owed, 42.5);
  assert.equal(therapySaved.fields.split_label, "50/50");
  assert.equal(therapySaved.fields.other_parent_percent, 50);
}

const medical = share({ amount: 40, category: "medical", medical: 50, custody: 70 });
const dental = share({ amount: 40, category: "dental", medical: 50, custody: 70 });
for (const result of [medical, dental]) {
  const saved = persisted(result, 40);
  assert.equal(saved.saveable, true);
  if (saved.saveable) {
    assert.equal(saved.fields.other_parent_share, 20);
    assert.equal(saved.fields.split_label, "50/50");
  }
}

const therapyFromCase = share({ amount: 85, category: "therapy", medical: 60, custody: 50 });
const therapyCaseSaved = persisted(therapyFromCase, 85);
assert.equal(therapyCaseSaved.saveable, true);
if (therapyCaseSaved.saveable) {
  assert.equal(therapyCaseSaved.fields.other_parent_share, 51);
  assert.equal(therapyCaseSaved.fields.split_label, "60/40");
  assert.equal(therapyCaseSaved.fields.other_parent_percent, 60);
}

const therapyCustodyFallback = share({ amount: 85, category: "therapy", medical: null, custody: 40 });
const custodySaved = persisted(therapyCustodyFallback, 85);
assert.equal(custodySaved.saveable, true);
if (custodySaved.saveable) {
  assert.equal(custodySaved.fields.other_parent_share, 34);
  assert.equal(custodySaved.fields.split_label, "40/60");
}

const school = share({
  amount: 45,
  category: "school",
  medical: 50,
  rules: [
    healthcare50,
    {
      category: "school",
      child_scope: null,
      rule_type: "SPLIT_PERCENT",
      other_parent_percent: 25,
    },
  ],
});
const schoolSaved = persisted(school, 45);
assert.equal(schoolSaved.saveable, true);
if (schoolSaved.saveable) {
  assert.equal(schoolSaved.fields.other_parent_share, 11.25);
  assert.equal(schoolSaved.fields.split_label, "25/75");
}

const clothing = share({
  amount: 80,
  category: "clothing",
  medical: 50,
  rules: [
    healthcare50,
    { category: "clothing", child_scope: null, rule_type: "NONE", other_parent_percent: null },
  ],
});
const clothingSaved = persisted(clothing, 80);
assert.equal(clothing.allocation_status, "NONE");
assert.equal(clothingSaved.saveable, true);
if (clothingSaved.saveable) {
  assert.equal(clothingSaved.fields.other_parent_share, 0);
  assert.equal(clothingSaved.fields.amount_owed, 0);
  assert.equal(clothingSaved.fields.split_label, "0/100");
}

const kevinPaid = persisted(therapy, 85, "coparent");
assert.equal(kevinPaid.saveable, true);
if (kevinPaid.saveable && therapySaved.saveable) {
  assert.equal(kevinPaid.fields.other_parent_share, 42.5);
  assert.equal(kevinPaid.fields.amount_owed, -42.5);
  assert.equal(therapySaved.fields.amount_owed, 42.5);
}

const missing = share({ amount: 85, category: "therapy" });
assert.equal(missing.allocation_status, "UNRESOLVED");
assert.equal(missing.other_parent_share, null);
assert.equal(persisted(missing, 85).saveable, false);
assert.match(missing.clarification ?? "", /healthcare sharing percentage/i);

const therapyIgnoresGeneral = share({
  amount: 85,
  category: "therapy",
  medical: 50,
  rules: [
    { category: null, child_scope: null, rule_type: "SPLIT_PERCENT", other_parent_percent: 30 },
  ],
});
const therapyIgnoresSaved = persisted(therapyIgnoresGeneral, 85);
assert.equal(therapyIgnoresSaved.saveable, true);
if (therapyIgnoresSaved.saveable) assert.equal(therapyIgnoresSaved.fields.other_parent_percent, 50);

const schoolGeneral = share({
  amount: 45,
  category: "school",
  medical: 50,
  rules: [
    { category: null, child_scope: null, rule_type: "SPLIT_PERCENT", other_parent_percent: 30 },
  ],
});
const schoolGeneralSaved = persisted(schoolGeneral, 45);
assert.equal(schoolGeneralSaved.saveable, true);
if (schoolGeneralSaved.saveable) {
  assert.equal(schoolGeneralSaved.fields.other_parent_share, 13.5);
  assert.equal(schoolGeneralSaved.fields.split_label, "30/70");
}

const schoolMissing = share({ amount: 45, category: "school", medical: 50, custody: 50 });
assert.equal(schoolMissing.allocation_status, "UNRESOLVED");
assert.equal(schoolMissing.other_parent_share, null);
assert.equal(persisted(schoolMissing, 45).saveable, false);

const ambiguous = share({
  amount: 45,
  category: "school",
  rules: [
    { category: "school", child_scope: null, rule_type: "SPLIT_PERCENT", other_parent_percent: 30 },
    { category: "school", child_scope: null, rule_type: "SPLIT_PERCENT", other_parent_percent: 70 },
  ],
});
assert.equal(ambiguous.allocation_status, "UNRESOLVED");
assert.match(ambiguous.clarification ?? "", /disagree/i);
assert.equal(persisted(ambiguous, 45).saveable, false);

const childRule = share({
  amount: 85,
  category: "therapy",
  childId: "ashley",
  medical: 50,
  rules: [
    {
      category: "medical",
      child_scope: "ashley",
      rule_type: "SPLIT_PERCENT",
      other_parent_percent: 80,
    },
    healthcare50,
  ],
});
const childSaved = persisted(childRule, 85);
assert.equal(childSaved.saveable, true);
if (childSaved.saveable) assert.equal(childSaved.fields.other_parent_percent, 80);

const proposal: Proposal = {
  type: "log_expense",
  draft: "I paid for Ashley's occupational therapy appointment",
  description: "I paid for Ashley's occupational therapy appointment",
  category: "therapy",
  amount: 85,
  depends_on: null,
  requires_approval: true,
  paid_by: "self",
};
const stamped = stampExpenseProposal(proposal, therapy);
assert.equal(stamped.kind, "proposal");
if (stamped.kind === "proposal" && therapySaved.saveable) {
  assert.equal(stamped.proposal.requires_approval, true);
  assert.equal(stamped.proposal.category, "therapy");
  assert.equal(stamped.proposal.other_parent_share, therapySaved.fields.other_parent_share);
  assert.equal(stamped.proposal.amount_owed, therapySaved.fields.amount_owed);
  assert.equal(stamped.proposal.split_label, therapySaved.fields.split_label);
  assert.match(stamped.proposal.split_review ?? "", /50\/50/);
  assert.match(stamped.proposal.split_review ?? "", /\$42\.50/);
  assert.doesNotMatch(stamped.proposal.description ?? "", /50\/50/);
}

const manual = persisted(therapy, 85, "self");
assert.equal(manual.saveable, true);
if (manual.saveable && stamped.kind === "proposal") {
  assert.equal(stamped.proposal.other_parent_share, manual.fields.other_parent_share);
  assert.equal(stamped.proposal.amount_owed, manual.fields.amount_owed);
  assert.equal(stamped.proposal.split_label, manual.fields.split_label);
}

assert.equal(
  expenseSplitReview({ result: therapy, amount: 85, payer: "coparent", payerName: "Kevin" }),
  "Kevin paid. Split 50/50. Your share is $42.50."
);

assert.equal(detectExpensePayer("I paid $85 for Ashley's occupational therapy appointment today.", [{ name: "Kevin" }], [{ name: "Ashley" }]).kind, "self");
const kevin = detectExpensePayer("Kevin paid $120 for Ashley's therapy.", [{ name: "Kevin" }], [{ name: "Ashley" }]);
assert.equal(kevin.kind, "coparent");
if (kevin.kind === "coparent") assert.equal(kevin.name, "Kevin");
assert.equal(detectExpensePayer("Sam paid $85 for therapy.", [{ name: "Kevin" }]).kind, "ask");
assert.equal(detectExpensePayer("I paid $85 and Kevin paid too.", [{ name: "Kevin" }]).kind, "ask");

assert.equal(
  historicalSharingGap({
    category: "therapy",
    split_label: null,
    other_parent_share: 0,
    amount_owed: 0,
  }),
  "healthcare_zero_without_split"
);
assert.equal(
  historicalSharingGap({
    category: "therapy",
    split_label: "50/50",
    other_parent_share: 42.5,
    amount_owed: 42.5,
  }),
  null
);
assert.equal(
  historicalSharingGap({
    category: "school",
    split_label: null,
    other_parent_share: 0,
    amount_owed: 0,
  }),
  "category_zero_without_split"
);
assert.equal(
  historicalSharingGap({
    category: "medical",
    split_label: null,
    other_parent_share: 0,
    amount_owed: 25,
  }),
  null
);
assert.equal(
  coparentShareForExpense(
    {
      amount: 50,
      amount_owed: 25,
      other_parent_share: 0,
      submitted_by: "parent-a",
      status: "resolved",
      split_label: null,
    },
    "parent-a"
  ),
  25
);
assert.equal(
  coparentShareForExpense(
    {
      amount: 85,
      amount_owed: -42.5,
      other_parent_share: 42.5,
      submitted_by: "parent-a",
      status: "submitted",
      split_label: "50/50",
    },
    "parent-a"
  ),
  42.5
);

const dentalRule = share({
  amount: 120,
  category: "dental",
  rules: [
    { category: "dental", child_scope: null, rule_type: "SPLIT_PERCENT", other_parent_percent: 50 },
  ],
});
const dentalPlan = planExpenseEntry({
  intent: "unspecified",
  statedPercent: null,
  notifyOverride: null,
  allocation: dentalRule,
  amount: 120,
  payer: "self",
});
assert.equal(dentalPlan.mode, "shared");
assert.equal(dentalPlan.notifyCoparent, true);
assert.equal(dentalPlan.fields?.other_parent_share, 60);
assert.equal(dentalPlan.fields?.amount_owed, 60);
assert.equal(dentalPlan.fields?.split_label, "50/50");
assert.match(dentalPlan.review, /Notify co-parent: on/);
assert.equal(
  expenseWorkflowStatus({ otherParentShare: 60, notifyCoparent: dentalPlan.notifyCoparent }),
  "submitted"
);

const shoesIntent = detectExpenseLoggingIntent(
  "I spent $65 on shoes. Just log this for my records."
);
assert.equal(shoesIntent.intent, "personal");
const shoesPlan = planExpenseEntry({
  intent: shoesIntent.intent,
  statedPercent: shoesIntent.statedPercent,
  notifyOverride: shoesIntent.notify,
  allocation: share({ amount: 65, category: "clothing" }),
  amount: 65,
  payer: "self",
});
assert.equal(shoesPlan.mode, "personal");
assert.equal(shoesPlan.notifyCoparent, false);
assert.equal(shoesPlan.fields?.other_parent_share, 0);
assert.equal(shoesPlan.fields?.amount_owed, 0);
assert.equal(shoesPlan.fields?.split_label, "Personal");
assert.match(shoesPlan.review, /Notify co-parent: off/);
assert.equal(
  expenseTabNetBalance(
    [
      {
        amount: 65,
        amount_owed: shoesPlan.fields?.amount_owed ?? 0,
        other_parent_share: shoesPlan.fields?.other_parent_share ?? 0,
        submitted_by: "parent-a",
        status: "resolved",
        split_label: "Personal",
      },
    ],
    "parent-a"
  ).net,
  0
);

const tripIntent = detectExpenseLoggingIntent(
  "I paid $30 for the field trip. Just for my records."
);
assert.equal(tripIntent.intent, "personal");
const tripPlan = planExpenseEntry({
  intent: tripIntent.intent,
  statedPercent: null,
  notifyOverride: null,
  allocation: share({ amount: 30, category: "school", medical: 50 }),
  amount: 30,
  payer: "self",
});
assert.equal(tripPlan.mode, "personal");
assert.equal(tripPlan.fields?.amount_owed, 0);
assert.equal(tripPlan.notifyCoparent, false);

const askSplit = planExpenseEntry({
  intent: "shared",
  statedPercent: null,
  notifyOverride: null,
  allocation: share({ amount: 30, category: "school" }),
  amount: 30,
  payer: "self",
});
assert.equal(askSplit.mode, "ask_percent");
assert.equal(askSplit.fields, null);
assert.match(askSplit.review, /percentage/i);

const quietShare = planExpenseEntry({
  intent: "unspecified",
  statedPercent: null,
  notifyOverride: false,
  allocation: dentalRule,
  amount: 120,
  payer: "self",
});
assert.equal(quietShare.notifyCoparent, false);
assert.equal(quietShare.fields?.other_parent_share, 60);
assert.equal(quietShare.fields?.amount_owed, 60);
assert.match(quietShare.review, /Notify co-parent: off/);
assert.equal(
  expenseWorkflowStatus({ otherParentShare: 60, notifyCoparent: false }),
  "resolved"
);

const otherPaid = planExpenseEntry({
  intent: "unspecified",
  statedPercent: null,
  notifyOverride: null,
  allocation: dentalRule,
  amount: 120,
  payer: "coparent",
  payerName: "Kevin",
});
assert.equal(otherPaid.fields?.other_parent_share, 60);
assert.equal(otherPaid.fields?.amount_owed, -60);
assert.equal(otherPaid.notifyCoparent, true);
assert.match(otherPaid.review, /Kevin paid/);

const owesHalf = detectExpenseLoggingIntent("Kevin owes half.");
assert.equal(owesHalf.intent, "shared");
assert.equal(owesHalf.statedPercent, 50);
const halfPlan = planExpenseEntry({
  intent: owesHalf.intent,
  statedPercent: owesHalf.statedPercent,
  notifyOverride: null,
  allocation: share({ amount: 30, category: "school" }),
  amount: 30,
  payer: "self",
});
assert.equal(halfPlan.mode, "shared");
assert.equal(halfPlan.fields?.other_parent_share, 15);
assert.equal(halfPlan.notifyCoparent, true);

const ambiguousChoice = planExpenseEntry({
  intent: "unspecified",
  statedPercent: null,
  notifyOverride: null,
  allocation: share({ amount: 65, category: "clothing" }),
  amount: 65,
  payer: "self",
});
assert.equal(ambiguousChoice.mode, "choose");
assert.equal(ambiguousChoice.fields, null);

console.log("expense sharing tests passed");
