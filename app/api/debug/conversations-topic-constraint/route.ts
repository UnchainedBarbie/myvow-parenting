import { NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server";

/**
 * Returns the conversations_topic_check constraint definition and parsed allowed values.
 * Run: GET /api/debug/conversations-topic-constraint
 * Use the printed allowedValues to align CONVERSATION_TOPICS and API allowedTopics.
 */
function parseAllowedTopicsFromCheckDef(def: string | null): string[] {
  if (!def || typeof def !== "string") return [];
  // Match single-quoted strings in the constraint (e.g. IN ('medical', 'school') or ARRAY['a','b'])
  const matches = def.matchAll(/'([^']*)'/g);
  const values = [...matches].map((m) => m[1].trim()).filter(Boolean);
  return [...new Set(values)];
}

export async function GET() {
  try {
    const admin = getServiceRoleClient();
    const { data: definition, error } = await admin.rpc(
      "get_conversations_topic_check_def"
    );

    if (error) {
      return NextResponse.json(
        {
          error: error.message,
          hint: "Run migration 20260306120000_conversations_topic_check_def.sql and ensure the constraint exists.",
        },
        { status: 500 }
      );
    }

    const defString =
      definition != null && typeof definition !== "object"
        ? String(definition)
        : definition?.definition != null
          ? String((definition as { definition?: string }).definition)
          : null;
    const allowedValues = parseAllowedTopicsFromCheckDef(defString);

    const result = {
      definition: defString ?? null,
      allowedValues,
    };
    // eslint-disable-next-line no-console
    console.log("[conversations_topic_check]", result);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "Failed to read constraint",
      },
      { status: 500 }
    );
  }
}
