/**
 * Smoke test for Sage Resolver (children + dates).
 * Run: npx tsx scripts/test-resolver.ts
 * Requires Supabase service-role env in .env.local (for child tests)
 */

import { config } from "dotenv";
import { resolve } from "path";
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
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
