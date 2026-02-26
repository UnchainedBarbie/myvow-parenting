import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { mediateIncomingMessage } from "@/lib/ai/mediate";

/**
 * Ingest incoming email (from webhook/cron). Service role only.
 * Process raw message → AI mediate → store message + flags.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      case_id,
      sender_id,
      sender_external_email,
      original_content,
    } = body as {
      case_id?: string;
      sender_id?: string;
      sender_external_email?: string;
      original_content?: string;
    };
    if (!case_id || !original_content) {
      return NextResponse.json(
        { message: "Missing case_id or original_content" },
        { status: 400 }
      );
    }
    const result = await mediateIncomingMessage(original_content);
    const admin = getServiceRoleClient();
    const { data: message, error: msgError } = await admin
      .from("messages")
      .insert({
        case_id,
        direction: "incoming",
        sender_id: sender_id ?? null,
        sender_external_email: sender_external_email ?? null,
        original_content,
        ai_rewritten_content: result.ai_rewritten_content,
        ai_classification: result.ai_classification,
        ai_confidence_score: result.ai_confidence_score,
        emotional_intensity_score: result.emotional_intensity_score,
        category: result.category ?? null,
        sub_category: result.sub_category ?? null,
        current_status: "delivered",
      })
      .select("id")
      .single();
    if (msgError) {
      return NextResponse.json(
        { message: msgError.message },
        { status: 500 }
      );
    }
    for (const f of result.flags) {
      await admin.from("message_flags").insert({
        message_id: message.id,
        case_id,
        flag_type: f.flag_type,
        description: f.description,
        ai_confidence: f.confidence,
      });
    }
    return NextResponse.json({ message_id: message.id });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Ingest failed" },
      { status: 500 }
    );
  }
}
