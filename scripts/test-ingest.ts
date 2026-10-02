/**
 * Test script: run ingestMessage() in-process on a simulated hostile incoming message.
 * Run with: npx tsx scripts/test-ingest.ts [conversation_id]
 * Requires Supabase service-role and Anthropic keys in .env.local.
 */

import { config } from "dotenv";
import { resolve } from "path";
import { ingestMessage } from "../lib/messages/ingest-message";
import { getServiceRoleClient } from "../lib/supabase/server";

config({ path: resolve(process.cwd(), ".env.local") });

const CASE_ID = "06fee106-3013-49b8-92ad-b4f93ed9548a";

const originalContent = `You never take the kids to their appointments. I had to leave work AGAIN to take Avery to the doctor because you can't be bothered. You're going to pay for the entire visit since this is your fault.`;

async function resolveConversationId(cliArg: string | undefined): Promise<string | null> {
  if (cliArg?.trim()) return cliArg.trim();

  const admin = getServiceRoleClient();
  const { data, error } = await admin
    .from("conversations")
    .select("id")
    .eq("case_id", CASE_ID)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Failed to query latest conversation:", error.message);
    return null;
  }
  return (data as { id?: string } | null)?.id ?? null;
}

async function main() {
  const conversationId = await resolveConversationId(process.argv[2]);
  if (!conversationId) {
    console.error("No conversation_id. Pass one: npx tsx scripts/test-ingest.ts <conversation_id>");
    process.exit(1);
  }

  console.log("Calling ingestMessage() in-process");
  console.log("Case ID:", CASE_ID);
  console.log("Conversation ID:", conversationId);
  console.log("From (simulated): Kevin <kevin@example.com>");
  console.log("Message:", originalContent);
  console.log("");

  try {
    const data = await ingestMessage({
      case_id: CASE_ID,
      conversation_id: conversationId,
      original_content: originalContent,
      sender_external_email: "kevin@example.com",
    });
    console.log("Ingest OK:", data);
    console.log("Message ID:", data.message_id);
  } catch (e) {
    console.error("Ingest failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

main();
