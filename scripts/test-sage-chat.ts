/**
 * Headless smoke test: typed chat → shared Sage engine (same as email).
 * Run: npx tsx scripts/test-sage-chat.ts
 * Or:  npm run test:sage-chat
 *
 * Requires ANTHROPIC_API_KEY + Supabase service role in .env.local
 */

import { config } from "dotenv";
import { resolve } from "path";
import { processChatMessage } from "../lib/sage/chat";

config({ path: resolve(process.cwd(), ".env.local") });

/** Same case used by scripts/test-resolver.ts (Ashley lives here). */
const CASE_ID = "06fee106-3013-49b8-92ad-b4f93ed9548a";
const TZ = "America/Denver";

const MESSAGES = [
  "Add Ashley's dentist Thursday at 3",
  "Move Ashley's dentist to 4",
  "Tell Co-Parent Ashley has a dentist Thursday",
];

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set. Add it to .env.local and retry.");
    process.exit(1);
  }

  console.log("Talk-to-Sage chat smoke test (single-intent)");
  console.log(`case_id: ${CASE_ID}  timezone: ${TZ}\n`);

  for (const message of MESSAGES) {
    console.log("════════════════════════════════════════");
    console.log(`USER: ${message}`);
    console.log("────────────────────────────────────────");

    try {
      const { reply, actions, result } = await processChatMessage({
        message,
        case_id: CASE_ID,
        timezone: TZ,
      });

      console.log(`REPLY: ${reply}`);
      console.log(
        `intent: ${result.interpretation.intent.item_type} / ${result.interpretation.intent.domain}`
      );
      console.log(`summary: ${result.interpretation.intent.summary}`);
      console.log(`child_ids: ${JSON.stringify(result.child_ids)}`);
      console.log(
        `unresolved_children: ${JSON.stringify(result.unresolved_children)}`
      );
      console.log(
        `resolved_dates: ${JSON.stringify(result.resolved_dates, null, 2)}`
      );
      console.log(`plan.status: ${result.plan.status}`);
      console.log("ACTIONS (canonical proposals):");
      console.log(JSON.stringify(actions, null, 2));
    } catch (e) {
      console.error("FAILED:", e instanceof Error ? e.message : e);
    }

    console.log("");
  }
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
