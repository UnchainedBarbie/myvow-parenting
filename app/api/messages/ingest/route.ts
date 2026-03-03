import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { mediateIncomingMessage } from "@/lib/ai/mediate";
import { estimateIntensity } from "@/lib/sage/intensity";

/**
 * Ingest incoming email (from webhook/cron). Service role only.
 * Process raw message → AI mediate → store message + flags.
 * Sets intensity_score/intensity_flag; delivery_status buffered if recipient is in cool-off.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const {
      case_id,
      sender_id,
      sender_external_email,
      original_content,
      conversation_id,
      is_emergency,
    } = body as {
      case_id?: string;
      sender_id?: string | null;
      sender_external_email?: string | null;
      original_content?: string;
      conversation_id?: string | null;
      is_emergency?: boolean;
    };
    if (!case_id || !original_content) {
      return NextResponse.json(
        { message: "Missing case_id or original_content" },
        { status: 400 }
      );
    }
    const result = await mediateIncomingMessage(original_content);
    const contentForIntensity = result.ai_rewritten_content ?? original_content;
    const { score, flag } = estimateIntensity(contentForIntensity);

    const admin = getServiceRoleClient();
    let deliveryStatus: "delivered" | "buffered" = "delivered";
    let deliveredAt: string | null = new Date().toISOString();
    if (!is_emergency) {
      const { data: members } = await admin
        .from("case_members")
        .select("user_id")
        .eq("case_id", case_id);
      const recipientId = (members ?? []).find((m) => m.user_id && m.user_id !== sender_id)?.user_id;
      if (recipientId) {
        const { data: cool } = await admin
          .from("cool_off")
          .select("id")
          .eq("user_id", recipientId)
          .eq("is_active", true)
          .gt("ends_at", new Date().toISOString())
          .maybeSingle();
        if (cool) {
          deliveryStatus = "buffered";
          deliveredAt = null;
        }
      }
    }

    const { data: message, error: msgError } = await admin
      .from("messages")
      .insert({
        case_id,
        conversation_id: conversation_id ?? null,
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
        current_status: deliveryStatus === "delivered" ? "delivered" : "pending",
        delivery_status: deliveryStatus,
        delivered_at: deliveredAt,
        intensity_score: score,
        intensity_flag: flag,
        is_emergency: is_emergency ?? false,
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
