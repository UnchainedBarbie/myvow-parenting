/**
 * Read conversations.topic CHECK constraint and parse allowed values.
 * Align dropdown and API validation to the actual DB constraint.
 */

import { getServiceRoleClient } from "@/lib/supabase/server";

export function parseAllowedTopicsFromCheckDef(def: string | null): string[] {
  if (!def || typeof def !== "string") return [];
  const matches = def.matchAll(/'([^']*)'/g);
  const values = [...matches].map((m) => m[1].trim()).filter(Boolean);
  return [...new Set(values)];
}

/**
 * Returns allowed topic values from the conversations_topic_check constraint.
 * Requires migration 20260306120000_conversations_topic_check_def.sql and the constraint to exist.
 */
export async function getAllowedTopicValues(): Promise<string[]> {
  const admin = getServiceRoleClient();
  const { data, error } = await admin.rpc("get_conversations_topic_check_def");
  if (error) return [];
  const def =
    typeof data === "string"
      ? data
      : (data as { definition?: string } | null)?.definition ?? null;
  return parseAllowedTopicsFromCheckDef(def);
}
