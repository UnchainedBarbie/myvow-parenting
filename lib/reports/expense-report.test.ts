import assert from "node:assert/strict";
import { sha256String } from "@/lib/reports/build-pdf";
import { buildExpenseReportPdf } from "@/lib/reports/expense-report-pdf";
import {
  buildExpenseReportCsv,
  expenseEnteredInRange,
  expenseStatusLabel,
  formatExpenseCurrency,
  prepareExpenseReport,
  type ExpenseReportOptions,
  type ExpenseReportSource,
} from "@/lib/reports/expense-report";

const parents = [
  { userId: "alex", name: "Alex Rivera" },
  { userId: "jordan", name: "Jordan Lee" },
];

const options: ExpenseReportOptions = {
  ledger: true,
  payments: true,
  disputes: true,
  netBalance: true,
  receiptsZip: false,
};

function expense(partial: Partial<ExpenseReportSource> & Pick<ExpenseReportSource, "id">): ExpenseReportSource {
  return {
    expenseNumber: 1,
    createdAt: "2026-10-10T18:00:00.000Z",
    incurredDate: "2026-10-10",
    description: "Expense",
    category: "medical",
    categoryDescription: null,
    amount: 0,
    submittedBy: "alex",
    amountOwed: null,
    otherParentShare: null,
    otherParentPercent: null,
    splitLabel: null,
    allocationStatus: "pending",
    status: "submitted",
    disputeReason: null,
    approvedBy: null,
    approvedAt: null,
    resolvedAt: null,
    paidAt: null,
    paymentMethod: null,
    paymentReference: null,
    paymentNotes: null,
    receiptName: null,
    receiptDocumentNumber: null,
    childName: "Sam",
    ...partial,
  };
}

const records: ExpenseReportSource[] = [
  expense({
    id: "e1",
    expenseNumber: 1,
    description: "Therapy visit",
    amount: 100,
    otherParentShare: 40,
    otherParentPercent: 40,
    splitLabel: "40/60",
    amountOwed: 40,
    status: "submitted",
  }),
  expense({
    id: "e2",
    expenseNumber: 2,
    description: "Dental cleaning",
    amount: 200,
    otherParentShare: 100,
    amountOwed: 100,
    status: "resolved",
    approvedAt: "2026-10-12T18:00:00.000Z",
    approvedBy: "jordan",
  }),
  expense({
    id: "e3",
    expenseNumber: 3,
    description: "School fee",
    category: "school",
    amount: 50,
    submittedBy: "jordan",
    otherParentShare: 25,
    amountOwed: 25,
    status: "paid",
    paidAt: "2026-10-15T18:00:00.000Z",
    paymentMethod: "Venmo",
    paymentReference: "VN-19",
    approvedBy: "alex",
  }),
  expense({
    id: "e4",
    expenseNumber: 4,
    description: "Clothes",
    category: "clothing",
    amount: 80,
    otherParentShare: null,
    amountOwed: null,
    status: "submitted",
  }),
  expense({
    id: "e5",
    expenseNumber: 5,
    description: "Soccer registration",
    category: "extracurricular",
    amount: 60,
    submittedBy: "jordan",
    otherParentShare: 30,
    amountOwed: 30,
    status: "disputed",
    disputeReason: "The hours do not match the invoice.",
  }),
  expense({
    id: "e6",
    expenseNumber: 6,
    description: "Personal item",
    amount: 10,
    otherParentShare: 0,
    amountOwed: 0,
    status: "resolved",
  }),
  expense({
    id: "e7",
    expenseNumber: 7,
    description: "Therapy visit",
    amount: 100,
    otherParentShare: 40,
    amountOwed: 40,
    status: "submitted",
  }),
  expense({
    id: "e8",
    expenseNumber: 8,
    description: "Copay note",
    amount: 15,
    otherParentShare: 5,
    amountOwed: 5,
    status: "submitted",
    paymentNotes: "Sent $2, will send the rest later.",
  }),
];

const prepared = prepareExpenseReport({
  expenses: records,
  parents,
  caseLabel: "FAM-100",
  timeZone: "America/Denver",
  dateStart: "2026-10-01",
  dateEnd: "2026-10-20",
  generatedAt: new Date("2026-10-20T18:00:00.000Z"),
  viewerId: "alex",
  viewerName: "Alex Rivera",
  options,
  receiptLines: [],
});

const balance = prepared.document.blocks.find((block) => block.kind === "lines" && block.title === "Net balance");
assert.equal(balance?.kind, "lines");
if (balance?.kind !== "lines") throw new Error("missing balance");
const balanceText = balance.lines.join("\n");
assert.match(balanceText, /Shown for Alex Rivera/);
assert.match(balanceText, /Current overall balance/);
assert.match(balanceText, /Selected reporting period/);
assert.match(balanceText, /They owe you: \$185\.00/);
assert.match(balanceText, /You owe them: \$30\.00/);
assert.match(balanceText, /Net: You are owed \$155\.00/);
assert.doesNotMatch(balanceText, /not an established debt|50\/50/);

const ledger = prepared.document.blocks.find((block) => block.kind === "table" && block.title === "All expenses");
assert.equal(ledger?.kind, "table");
if (ledger?.kind !== "table") throw new Error("missing ledger");
assert.deepEqual(ledger.headers, [
  "Expense ID",
  "Description",
  "Category",
  "Child",
  "Date",
  "Total",
  "Split",
  "Their share",
  "Status",
]);
assert.equal(ledger.rows.length, 8);
const byId = new Map(ledger.rows.map((row) => [row[0], row]));
assert.equal(byId.get("EXP-001")?.[6], "40/60");
assert.equal(byId.get("EXP-001")?.[7], "$40.00");
assert.equal(byId.get("EXP-001")?.[8], "Pending");
assert.equal(byId.get("EXP-001")?.[3], "Sam");
assert.match(byId.get("EXP-001")?.[1] ?? "", /Therapy visit/);
assert.equal(byId.get("EXP-003")?.[7], "$25.00");
assert.equal(byId.get("EXP-003")?.[8], "Paid");
assert.equal(byId.get("EXP-004")?.[7], "$0.00");
assert.equal(byId.get("EXP-004")?.[8], "Logged");
assert.equal(byId.get("EXP-005")?.[7], "$30.00");
assert.equal(byId.get("EXP-005")?.[8], "Disputed");
assert.equal(byId.get("EXP-006")?.[8], "Logged");

const payments = prepared.document.blocks.find((block) => block.kind === "table" && block.title === "Payment history");
assert.equal(payments?.kind, "table");
if (payments?.kind !== "table") throw new Error("missing payments");
assert.equal(payments.rows.length, 2);
const paidRow = payments.rows.find((row) => row[2].includes("Allocated share marked paid"));
const partialRow = payments.rows.find((row) => row[2].includes("not treated as payment in full"));
assert.ok(paidRow);
assert.match(paidRow?.[2] ?? "", /\$25\.00/);
assert.equal(paidRow?.[3], "Alex Rivera");
assert.match(paidRow?.[5] ?? "", /Venmo/);
assert.ok(partialRow);

const disputes = prepared.document.blocks.find((block) => block.kind === "table" && block.title === "Dispute history");
assert.equal(disputes?.kind, "table");
if (disputes?.kind !== "table") throw new Error("missing disputes");
assert.equal(disputes.rows.length, 1);
assert.match(disputes.rows[0][2], /hours do not match/);
assert.doesNotMatch(disputes.rows[0].join(" "), /Sage|rewritten/i);

const duplicates = prepared.document.blocks.find(
  (block) => block.kind === "lines" && block.title === "Possible duplicate records"
);
assert.equal(duplicates?.kind, "lines");
if (duplicates?.kind !== "lines") throw new Error("missing duplicates");
assert.match(duplicates.lines.join(" "), /EXP-007, EXP-001/);
assert.match(duplicates.lines.join(" "), /have not been combined/);

assert.match(prepared.document.completeness, /filtered expense report/);
assert.match(prepared.document.completeness, /8 expense records are included/);
assert.match(prepared.document.facts.map((fact) => fact.value).join(" "), /October 1-20, 2026/);
assert.doesNotMatch(JSON.stringify(prepared.document), /Court-Ready/);

const outside = expense({
  id: "old",
  expenseNumber: 9,
  createdAt: "2026-09-01T18:00:00.000Z",
  incurredDate: "2026-09-01",
    amount: 999,
    otherParentShare: 500,
    amountOwed: 500,
    submittedBy: "jordan",
});
const filtered = prepareExpenseReport({
  expenses: [records[0], outside],
  parents,
  caseLabel: "FAM-100",
  timeZone: "America/Denver",
  dateStart: "2026-10-01",
  dateEnd: "2026-10-20",
  generatedAt: new Date("2026-10-20T18:00:00.000Z"),
  viewerId: "alex",
  viewerName: "Alex Rivera",
  options,
  receiptLines: [],
});
assert.equal(filtered.includedCount, 1);
assert.match(filtered.document.completeness, /1 expense record is included/);
assert.match(filtered.document.completeness, /1 other expense record in this case falls outside those dates and remains in the case/);
const filteredBalance = filtered.document.blocks.find((block) => block.kind === "lines" && block.title === "Net balance");
assert.equal(filteredBalance?.kind, "lines");
if (filteredBalance?.kind === "lines") {
  const text = filteredBalance.lines.join("\n");
  assert.match(text, /Current overall balance/);
  assert.match(text, /You owe them: \$500\.00/);
  assert.match(text, /not the current overall balance/);
  assert.match(text, /They owe you: \$40\.00/);
}
assert.equal(expenseEnteredInRange("2026-10-01T05:59:59.000Z", "2026-10-01", "2026-10-20", "America/Denver"), false);
assert.equal(expenseEnteredInRange("2026-10-01T06:00:00.000Z", "2026-10-01", "2026-10-20", "America/Denver"), true);
assert.equal(expenseEnteredInRange("2026-10-21T05:59:59.999Z", "2026-10-01", "2026-10-20", "America/Denver"), true);
assert.equal(expenseEnteredInRange("2026-10-21T06:00:00.000Z", "2026-10-01", "2026-10-20", "America/Denver"), false);

const summaryOnly = prepareExpenseReport({
  expenses: records,
  parents,
  caseLabel: "FAM-100",
  timeZone: "America/Denver",
  dateStart: null,
  dateEnd: null,
  generatedAt: new Date("2026-10-20T18:00:00.000Z"),
  viewerId: "alex",
  viewerName: "Alex Rivera",
  options: { ledger: false, payments: false, disputes: false, netBalance: false, receiptsZip: false },
  receiptLines: [],
});
assert.equal(summaryOnly.document.blocks.some((block) => block.kind === "table"), false);
assert.match(summaryOnly.document.completeness, /all 8 expense records/);

assert.equal(formatExpenseCurrency(1234.5), "$1,234.50");
assert.equal(formatExpenseCurrency(-20), "-$20.00");
assert.equal(expenseStatusLabel("submitted", 0), "Logged");
assert.equal(expenseStatusLabel("submitted", null), "Pending");
assert.equal(expenseStatusLabel("paid", 25), "Paid");

const csv = buildExpenseReportCsv(prepared.document);
assert.match(csv, /EXP-001/);
assert.match(csv, /\$100\.00/);
assert.doesNotMatch(csv, /Court-Ready/);

const many = Array.from({ length: 24 }, (_, index) =>
  expense({
    id: `many-${index}`,
    expenseNumber: index + 1,
    description: `Long description ${index} `.repeat(8),
    amount: 20 + index,
    otherParentShare: 10,
    amountOwed: 10,
    status: index % 4 === 0 ? "paid" : index % 4 === 1 ? "disputed" : index % 4 === 2 ? "resolved" : "submitted",
    disputeReason: index % 4 === 1 ? "Recorded disagreement." : null,
    paidAt: index % 4 === 0 ? "2026-10-11T18:00:00.000Z" : null,
  })
);
const manyReport = prepareExpenseReport({
  expenses: many,
  parents,
  caseLabel: "FAM-100",
  timeZone: "America/Denver",
  dateStart: null,
  dateEnd: null,
  generatedAt: new Date("2026-10-20T18:00:00.000Z"),
  viewerId: "alex",
  viewerName: "Alex Rivera",
  options,
  receiptLines: [],
});
const pdf = buildExpenseReportPdf(manyReport.document, "FAM-100", manyReport.verificationPayload);
assert.ok(pdf.pageCount > 1, `expected multiple pages, got ${pdf.pageCount}`);
assert.equal(pdf.verificationHash, sha256String(manyReport.verificationPayload));
const pdfText = pdf.buffer.toString("latin1");
assert.match(pdfText, /Expense Report/);
assert.match(pdfText, /MYVOW PARENTING/);
assert.match(pdfText, /SHA-256/);
assert.doesNotMatch(pdfText, /Court-Ready/);
assert.match(pdfText, new RegExp(`Page ${pdf.pageCount}`));
assert.match(pdfText, /MediaBox \[0 0 792\.? 612\.?\]/);
assert.match(pdfText, /Their share/);
assert.doesNotMatch(pdfText, /checkbox|Edit|Delete/i);

console.log(`expense report tests passed (${pdf.pageCount} pages)`);
