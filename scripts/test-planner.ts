/**
 * Smoke test for Sage Planner.
 * Run: npx tsx scripts/test-planner.ts
 * Requires ANTHROPIC_API_KEY in .env.local
 */

import { config } from "dotenv";
import { resolve } from "path";
import { plan, type PlanContext } from "../lib/sage/planner";

config({ path: resolve(process.cwd(), ".env.local") });

const CASES: { label: string; ctx: PlanContext }[] = [
  {
    label: "A. dentist schedule_change + Thursday needs_clarification",
    ctx: {
      item_type: "schedule_change",
      domain: "calendar",
      action_required: true,
      summary:
        "It looks like your co-parent is asking to move pickup for Ashley's dentist appointment.",
      child_ids: ["367d8922-aad5-4655-b592-75b006240b8b"],
      unresolved_children: [],
      resolved_dates: [
        { raw: "Thursday", status: "needs_clarification", iso: null },
      ],
      sender: "Co-Parent",
    },
  },
  {
    label: "B. schedule_change with resolved date",
    ctx: {
      item_type: "schedule_change",
      domain: "calendar",
      action_required: true,
      summary:
        "It looks like your co-parent is asking to move pickup for Ashley's dentist appointment to 5:30.",
      child_ids: ["367d8922-aad5-4655-b592-75b006240b8b"],
      unresolved_children: [],
      resolved_dates: [
        { raw: "2026-09-17", status: "resolved", iso: "2026-09-17" },
      ],
      sender: "Co-Parent",
    },
  },
  {
    label: "C. information_only grade update",
    ctx: {
      item_type: "information_only",
      domain: "school",
      action_required: false,
      summary: "Your co-parent shared that Avery got a B on her math test.",
      child_ids: [],
      unresolved_children: [],
      resolved_dates: [],
      sender: "Co-Parent",
    },
  },
  {
    label: "D. expense item, resolved",
    ctx: {
      item_type: "expense",
      domain: "expense",
      action_required: true,
      summary: "Your co-parent shared an orthodontic receipt for $612.",
      child_ids: [],
      unresolved_children: [],
      resolved_dates: [],
      sender: "Co-Parent",
    },
  },
];

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set. Add it to .env.local and retry.");
    process.exit(1);
  }

  for (const test of CASES) {
    console.log(`\n========== ${test.label} ==========`);
    const result = await plan(test.ctx);
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
