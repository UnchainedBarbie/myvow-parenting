import { getServiceRoleClient } from "@/lib/supabase/server";
import { mediateIncomingMessage } from "@/lib/ai/mediate";
import { estimateIntensity } from "@/lib/sage/intensity";

export type IngestDeliveryStatus = "delivered" | "buffered" | "pending";

export async function ingestMessage(input: {
  case_id: string;
  original_content: string;
  conversation_id: string;
  sender_id?: string | null;
  sender_external_email?: string | null;
  is_emergency?: boolean;
  email_message_id?: string | null;
  has_attachments?: boolean;
}): Promise<{ message_id: string; created: boolean; delivery_status: IngestDeliveryStatus }> {
  const {
    case_id,
    sender_id,
    sender_external_email,
    original_content,
    conversation_id,
    is_emergency,
    email_message_id,
    has_attachments,
  } = input;

  if (!case_id || !original_content) {
    throw new Error("Missing case_id or original_content");
  }

  const emailMessageId =
    typeof email_message_id === "string" && email_message_id.trim()
      ? email_message_id.trim()
      : null;

  const admin = getServiceRoleClient();

  if (emailMessageId) {
    const { data: existingRows, error: existingErr } = await admin
      .from("messages")
      .select("id, delivery_status")
      .eq("case_id", case_id)
      .eq("email_message_id", emailMessageId)
      .limit(1);

    if (existingErr) {
      throw new Error(existingErr.message);
    }

    const existing = (existingRows ?? [])[0] as
      | { id: string; delivery_status: string | null }
      | undefined;
    if (existing) {
      return {
        message_id: existing.id,
        created: false,
        delivery_status: asDeliveryStatus(existing.delivery_status),
      };
    }
  }

  const result = await mediateIncomingMessage(original_content);
  const contentForIntensity = result.ai_rewritten_content ?? original_content;
  const { score, flag } = estimateIntensity(contentForIntensity);

  let deliveryStatus: IngestDeliveryStatus = "delivered";
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

  const insertRow: Record<string, unknown> = {
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
    email_message_id: emailMessageId,
    has_attachments: has_attachments ?? false,
  };
  // Live messages has no deliver_at until 20260304153000 is applied.
  // Omitting a null is the same as writing null once the column exists.
  if (deliverAt) insertRow.deliver_at = deliverAt;

  const { data: message, error: msgError } = await admin
    .from("messages")
    .insert(insertRow)
    .select("id")
    .single();
  if (msgError || !message) {
    throw new Error(msgError?.message ?? "Failed to insert message");
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
  return {
    message_id: message.id as string,
    created: true,
    delivery_status: deliveryStatus,
  };
}

function asDeliveryStatus(value: string | null | undefined): IngestDeliveryStatus {
  if (value === "buffered" || value === "pending" || value === "delivered") return value;
  return "delivered";
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
