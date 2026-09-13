/**
 * Smoke test for Sage Resolver (children + dates).
 * Run: npx tsx scripts/test-resolver.ts
 * Requires Supabase service-role env in .env.local (for child tests)
 */

import { config } from "dotenv";
import { resolve } from "path";
import {
  buildCalendarTitle,
  buildExpenseInitialValues,
  inferCalendarEventType,
} from "../components/sage/proposal-helpers";
import type { SageItem } from "../components/sage/proposal-types";
import { resolveChildren, resolveDate } from "../lib/sage/resolver";

config({ path: resolve(process.cwd(), ".env.local") });

const CASE_ID = "06fee106-3013-49b8-92ad-b4f93ed9548a";

const CASES: { label: string; names: string[] }[] = [
  { label: '["Ashley"] → exact', names: ["Ashley"] },
  { label: '["ashley"] → exact (case-insensitive)', names: ["ashley"] },
  { label: '["Ashley","Kyle"] → both resolve', names: ["Ashley", "Kyle"] },
  { label: '["Zzz"] → unresolved', names: ["Zzz"] },
  { label: '["Bob"] → prefix? (test data)', names: ["Bob"] },
];

const FIXED_TODAY = new Date("2026-09-12T12:00:00-06:00");
const TZ = "America/Denver";

const DATE_CASES = [
  "today",
  "tomorrow",
  "Jun 26",
  "Dec 25",
  "9/15",
  "on 9/15 at 6pm",
  "2024-09-15",
  "9/15/2024",
  "6/26/2026",
  "Thursday",
  "next Friday",
  "blah",
];

async function main() {
  console.log(`Resolver smoke test — case_id: ${CASE_ID}\n`);

  for (const test of CASES) {
    console.log(`========== ${test.label} ==========`);
    console.log("Input:", JSON.stringify(test.names));
    const result = await resolveChildren(CASE_ID, test.names);
    console.log("child_ids:", result.child_ids);
    console.log("resolved:");
    console.log(JSON.stringify(result.resolved, null, 2));
    console.log("");
  }

  console.log("========== Date resolution ==========");
  console.log(`Fixed today: ${FIXED_TODAY.toISOString()} (tz ${TZ})\n`);

  for (const input of DATE_CASES) {
    const r = resolveDate(input, FIXED_TODAY, TZ);
    console.log(
      `"${input}" → ${r.status} | ${r.iso ?? "null"} | ${r.reason}`
    );
  }

  const choirItem: SageItem = {
    id: "test",
    item_type: "calendar_update",
    domain: "calendar",
    summary:
      "You'd like to add a choir concert for Avery on 9/15 at 6pm to your calendar.",
    evidence_excerpt: "choir concert",
    urgency: "normal",
    action_required: true,
    child_ids: ["child-1"],
    tool_input: {
      children: [{ name: "Avery", confidence: 1 }],
      dates: [{ raw: "9/15", value: "2024-09-15" }],
    },
    plan: null,
    status: "open",
    created_at: new Date().toISOString(),
  };
  console.log("\n========== Calendar pre-fill ==========");
  console.log("title:", buildCalendarTitle(choirItem));
  console.log("category:", inferCalendarEventType(choirItem));

  const rawAsk: SageItem = {
    ...choirItem,
    summary:
      "create a calendar event for avery for choir concert on 9/15 at 6pm",
  };
  console.log("title (raw ask):", buildCalendarTitle(rawAsk));
  console.log("category (raw ask):", inferCalendarEventType(rawAsk));

  const expenseItem: SageItem = {
    ...choirItem,
    item_type: "expense",
    domain: "expense",
    summary:
      "You'd like to log a $20 expense for Ashley's dentist visit on Sept 10.",
    child_ids: ["367d8922-aad5-4655-b592-75b006240b8b"],
    tool_input: {
      children: [{ name: "Ashley", confidence: 1 }],
      amounts: [{ value: 20, currency: "USD" }],
      dates: [{ raw: "9/10", value: "" }],
      resolved_dates: [
        { raw: "9/10", status: "resolved", iso: "2026-09-10" },
      ],
    },
  };
  console.log("\n========== Expense pre-fill ==========");
  console.log(
    JSON.stringify(
      buildExpenseInitialValues(expenseItem, {
        type: "log_expense",
        draft: expenseItem.summary ?? "",
        depends_on: null,
      }),
      null,
      2
    )
  );

  const dentistAppt: SageItem = {
    ...expenseItem,
    domain: "expense",
    summary: "You'd like to log Ashley's dentist appt.",
    evidence_excerpt: "ashley's dentist appt",
    tool_input: {
      children: [{ name: "Ashley", confidence: 1 }],
      amounts: [],
    },
  };
  const dentistPrefill = buildExpenseInitialValues(dentistAppt, {
    type: "log_expense",
    draft: "You'd like to log Ashley's dentist appt for your records.",
    depends_on: null,
  });
  console.log("\n========== Dentist appt category ==========");
  console.log("category:", dentistPrefill.category);
  console.log("description:", dentistPrefill.description);

  const dentistWithAmount: SageItem = {
    ...expenseItem,
    domain: "expense",
    summary: "You'd like to log a $20 expense for Ashley's dentist appt.",
    evidence_excerpt: "dentist's appt",
    tool_input: {
      children: [{ name: "Ashley", confidence: 1 }],
      amounts: [],
    },
  };
  const dentistAmtPrefill = buildExpenseInitialValues(dentistWithAmount, {
    type: "log_expense",
    draft: dentistWithAmount.summary ?? "",
    depends_on: null,
  });
  console.log("\n========== Dentist $20 category/amount ==========");
  console.log("category:", dentistAmtPrefill.category);
  console.log("amount:", dentistAmtPrefill.amount);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
