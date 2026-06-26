/**
 * Smoke test for processInboxItem — runs Sage Engine on a stored inbox_items row.
 * Run: npx tsx scripts/test-process-inbox.ts [inbox_item_id]
 * Requires ANTHROPIC_API_KEY in .env.local
 */

import { config } from "dotenv";
import { resolve } from "path";
import { getServiceRoleClient } from "../lib/supabase/server";
import { processInboxItem } from "../lib/sage/process-inbox-item";

config({ path: resolve(process.cwd(), ".env.local") });

async function resolveInboxItemId(cliArg: string | undefined): Promise<string | null> {
  if (cliArg?.trim()) return cliArg.trim();

  const admin = getServiceRoleClient();
  const { data, error } = await admin
    .from("inbox_items")
    .select("id")
    .eq("source_type", "email")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Failed to query latest inbox_items row:", error.message);
    return null;
  }
  return (data as { id?: string } | null)?.id ?? null;
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set. Add it to .env.local and retry.");
    process.exit(1);
  }

  const inboxItemId = await resolveInboxItemId(process.argv[2]);
  if (!inboxItemId) {
    console.error(
      "No inbox item id provided and no email inbox_items row found. Pass an id: npx tsx scripts/test-process-inbox.ts <uuid>"
    );
    process.exit(1);
  }

  console.log(`Processing inbox_items id: ${inboxItemId}`);

  const result = await processInboxItem(inboxItemId);
  console.log("\nprocessInboxItem result:");
  console.log(JSON.stringify(result, null, 2));

  if ("error" in result) {
    process.exit(1);
  }

  const admin = getServiceRoleClient();
  const { data: sageRow, error: fetchError } = await admin
    .from("sage_items")
    .select("*")
    .eq("id", result.sage_item_id)
    .maybeSingle();

  if (fetchError) {
    console.error("\nFailed to fetch sage_items row:", fetchError.message);
    process.exit(1);
  }

  console.log("\nCreated sage_items row:");
  console.log(JSON.stringify(sageRow, null, 2));
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
