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
    let deliveryStatus: "delivered" | "buffered" | "pending" = "delivered";
    let deliveredAt: string | null = new Date().toISOString();
    let deliverAt: string | null = null;

    if (!is_emergency) {
      const now = new Date();
      const nowIso = now.toISOString();
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
          .gt("ends_at", nowIso)
          .maybeSingle();

        if (cool) {
          // Respect existing cool-off buffering semantics first.
          deliveryStatus = "buffered";
          deliveredAt = null;
        } else {
          // Apply delivery window queuing for the recipient, if enabled.
          const { data: settingsRow } = await admin
            .from("user_settings")
            .select("delivery_window_enabled, delivery_start_time, delivery_end_time")
            .eq("user_id", recipientId)
            .maybeSingle();

          if (
            settingsRow &&
            settingsRow.delivery_window_enabled === true &&
            typeof settingsRow.delivery_start_time === "string" &&
            typeof settingsRow.delivery_end_time === "string"
          ) {
            const windowStart = settingsRow.delivery_start_time as string;
            const windowEnd = settingsRow.delivery_end_time as string;

            const insideWindow = isTimeWithinWindow(now, windowStart, windowEnd);
            if (!insideWindow) {
              const nextWindowStart = computeNextWindowStart(now, windowStart, windowEnd);
              deliveryStatus = "pending";
              deliveredAt = null;
              deliverAt = nextWindowStart.toISOString();
            }
          }
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
        deliver_at: deliverAt,
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

function isTimeWithinWindow(now: Date, startTime: string, endTime: string): boolean {
  const [startH, startM, startS] = startTime.split(":").map((p) => Number(p));
  const [endH, endM, endS] = endTime.split(":").map((p) => Number(p));

  const start = new Date(now);
  start.setHours(startH, startM || 0, startS || 0, 0);

  const end = new Date(now);
  end.setHours(endH, endM || 0, endS || 0, 0);

  if (end.getTime() === start.getTime()) {
    // Degenerate window: treat as always-open.
    return true;
  }

  if (end > start) {
    // Same-day window, e.g. 09:00–17:00
    return now >= start && now <= end;
  }

  // Overnight window, e.g. 22:00–06:00 (wraps past midnight).
  return now >= start || now <= end;
}

function computeNextWindowStart(now: Date, startTime: string, endTime: string): Date {
  const [startH, startM, startS] = startTime.split(":").map((p) => Number(p));
  const [endH, endM, endS] = endTime.split(":").map((p) => Number(p));

  const startToday = new Date(now);
  startToday.setHours(startH, startM || 0, startS || 0, 0);

  const endToday = new Date(now);
  endToday.setHours(endH, endM || 0, endS || 0, 0);

  if (endToday.getTime() === startToday.getTime()) {
    // Degenerate: treat as always-open; "next start" is now.
    return new Date(now);
  }

  const wraps = endToday < startToday;

  if (!wraps) {
    // Same-day window.
    if (now < startToday) {
      return startToday;
    }
    // Already past today's window; next is tomorrow.
    const tomorrow = new Date(startToday);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow;
  }

  // Overnight window (e.g. 22:00–06:00).
  if (now < startToday) {
    // Before evening start today → next is today at start.
    return startToday;
  }

  // After start time (late night) → next start is tomorrow at start.
  const tomorrow = new Date(startToday);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow;
}
