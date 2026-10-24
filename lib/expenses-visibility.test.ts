import assert from "node:assert/strict";
import {
  expenseReceiptVisibleToViewer,
  expenseVisibilityLabel,
  expenseVisibilityKey,
  expenseVisibleToViewer,
  storedExpenseVisibility,
  visibleExpenseRows,
  EXPENSE_VISIBILITY_UNSET_LABEL,
} from "@/lib/expenses-visibility";

const ashley = { userId: "parent-ashley", role: "parent" as const };
const kevin = { userId: "parent-kevin", role: "parent" as const };

const rows = [
  {
    id: "private-log",
    visibility: "private",
    submitted_by: "parent-ashley",
    other_parent_share: 40,
    description: "Ashley dentist",
  },
  {
    id: "parents-only",
    visibility: "parents_only",
    submitted_by: "parent-ashley",
    other_parent_share: 0,
    amount: "42.00",
    status: "submitted",
    description: "Shared shoes",
  },
  {
    id: "parents-alias",
    visibility: "parents",
    submitted_by: "parent-ashley",
    other_parent_share: 18,
    amount: "80.00",
    status: "awaiting_reimbursement",
    description: "Legacy parents alias",
  },
  {
    id: "family",
    visibility: "family",
    submitted_by: "parent-kevin",
    description: "Family activity",
  },
  {
    id: "legacy",
    visibility: null,
    submitted_by: "parent-ashley",
    other_parent_percent: 50,
    description: "Older expense",
  },
  {
    id: "ambiguous",
    visibility: "secret",
    submitted_by: "parent-ashley",
    description: "Unrecognized visibility",
  },
];

function main() {
  const kevinRows = visibleExpenseRows(rows, kevin).map((row) => row.id);
  assert.deepEqual(kevinRows, ["parents-only", "parents-alias", "family", "legacy"]);
  assert.equal(kevinRows.includes("private-log"), false);
  assert.equal(kevinRows.includes("ambiguous"), false);

  const ashleyRows = visibleExpenseRows(rows, ashley).map((row) => row.id);
  assert.deepEqual(ashleyRows, ["private-log", "parents-only", "parents-alias", "family", "legacy", "ambiguous"]);

  assert.equal(expenseVisibleToViewer(rows[0], kevin), false);
  assert.equal(expenseVisibleToViewer(rows[0], ashley), true);
  assert.equal(expenseVisibleToViewer(rows[1], { userId: "child-avery", role: "child" }), false);
  assert.equal(
    expenseVisibleToViewer(rows[1], { userId: "viewer-1", role: "professional_viewer" }),
    true
  );

  assert.equal(expenseVisibilityLabel("private"), "Just me");
  assert.equal(expenseVisibilityLabel("parents_only"), "Parents only");
  assert.equal(expenseVisibilityLabel("parents"), "Parents only");
  assert.equal(storedExpenseVisibility("parents"), "parents_only");
  assert.equal(storedExpenseVisibility(" parents "), "parents_only");
  assert.equal(storedExpenseVisibility("parents_only"), "parents_only");
  assert.equal(storedExpenseVisibility("private"), "private");
  assert.equal(expenseVisibilityKey("parents"), "parents_only");
  assert.equal(expenseVisibilityKey("Parents_Only"), "parents_only");
  assert.equal(expenseVisibilityKey(null), "");
  assert.equal(expenseVisibilityKey("secret"), "secret");
  const alias = rows.find((row) => row.id === "parents-alias");
  assert.equal(alias?.amount, "80.00");
  assert.equal(alias?.other_parent_share, 18);
  assert.equal(alias?.status, "awaiting_reimbursement");
  assert.equal(expenseVisibleToViewer(alias ?? rows[0], kevin), true);
  assert.equal(expenseVisibleToViewer(alias ?? rows[0], { userId: "child-avery", role: "child" }), false);
  assert.equal(expenseVisibilityLabel("family"), "Family");
  assert.equal(expenseVisibilityLabel(null), EXPENSE_VISIBILITY_UNSET_LABEL);
  assert.equal(expenseVisibilityLabel(undefined), EXPENSE_VISIBILITY_UNSET_LABEL);
  assert.equal(expenseVisibilityLabel(""), EXPENSE_VISIBILITY_UNSET_LABEL);
  assert.equal(expenseVisibilityLabel("secret"), "secret");
  assert.equal(storedExpenseVisibility(null), null);
  assert.notEqual(expenseVisibilityLabel(null), "Parents only");
  assert.notEqual(expenseVisibilityLabel(null), "Just me");

  const privateReceipt = expenseReceiptVisibleToViewer({
    expense: rows[0],
    document: { visibility: "parents_only", uploadedBy: "parent-ashley" },
    viewer: kevin,
  });
  assert.equal(privateReceipt, false);
  const ownerReceipt = expenseReceiptVisibleToViewer({
    expense: rows[0],
    document: { visibility: "private", uploadedBy: "parent-ashley" },
    viewer: ashley,
  });
  assert.equal(ownerReceipt, true);
  const sharedReceipt = expenseReceiptVisibleToViewer({
    expense: rows[1],
    document: { visibility: "private", uploadedBy: "parent-ashley" },
    viewer: kevin,
  });
  assert.equal(sharedReceipt, false);

  const exported = visibleExpenseRows(rows, kevin).map((row) => row.description);
  assert.equal(exported.includes("Ashley dentist"), false);
  assert.equal(exported.includes("Older expense"), true);
  assert.equal(exported.includes("Shared shoes"), true);

  console.log("expense visibility tests passed");
}

main();
