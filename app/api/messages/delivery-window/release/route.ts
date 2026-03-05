import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

/**
 * Gentle delivery for queued messages based on the recipient's delivery window.
 *
 * - Emergency messages are never queued here (is_emergency=true bypasses delivery window at ingest time).
 * - When the window opens, deliver 1 queued message with a normal notification,
 *   mark remaining as delivered with notification_suppressed=true, and emit a single summary.
 * - A 2-minute buffer at window open is applied when there is more than one queued message.
 */
export async function POST(_request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = getServiceRoleClient();

    // Load delivery window settings for this user.
    const { data: settingsRow } = await admin
      .from("user_settings")
      .select("delivery_window_enabled, delivery_start_time, delivery_end_time")
      .eq("user_id", user.id)
      .maybeSingle();

    if (
      !settingsRow ||
      settingsRow.delivery_window_enabled !== true ||
      typeof settingsRow.delivery_start_time !== "string" ||
      typeof settingsRow.delivery_end_time !== "string"
    ) {
      return NextResponse.json({ released: 0 });
    }

    const now = new Date();
    const nowIso = now.toISOString();

    // Only release when we are actually inside the user's delivery window.
    if (
      !isTimeWithinWindow(now, settingsRow.delivery_start_time, settingsRow.delivery_end_time)
    ) {
      return NextResponse.json({ released: 0 });
    }

    // Identify all of the user's cases.
    const { data: memberships } = await admin
      .from("case_members")
      .select("case_id")
      .eq("user_id", user.id);

    const caseIds = (memberships ?? []).map((m) => m.case_id).filter(Boolean);
    if (caseIds.length === 0) {
      return NextResponse.json({ released: 0 });
    }

    // Find queued incoming messages that are due to be delivered.
    const { data: queued } = await admin
      .from("messages")
      .select("id, case_id, conversation_id, deliver_at, created_at")
      .in("case_id", caseIds as string[])
      .eq("direction", "incoming")
      .eq("delivery_status", "pending")
      .is("delivered_at", null)
      .lte("deliver_at", nowIso)
      .order("created_at", { ascending: true });

    if (!queued || queued.length === 0) {
      return NextResponse.json({ released: 0 });
    }

    // Optional 2-minute buffer at window open when there are multiple messages.
    if (queued.length > 1 && queued[0]?.deliver_at) {
      const firstDeliverAt = new Date(queued[0].deliver_at as string);
      const bufferUntil = firstDeliverAt.getTime() + 2 * 60 * 1000;
      if (now.getTime() < bufferUntil) {
        // Still in the quiet buffer window; hold off on batch delivery.
        return NextResponse.json({ released: 0, buffered: true });
      }
    }

    const first = queued[0];
    const rest = queued.slice(1);

    const updatedIds: string[] = [];

    // Deliver the first message with normal notification semantics.
    const { data: firstUpdated, error: firstError } = await admin
      .from("messages")
      .update({
        delivery_status: "delivered",
        delivered_at: nowIso,
        notification_suppressed: false,
      })
      .eq("id", first.id)
      .select("id, conversation_id");

    if (firstError) {
      return NextResponse.json(
        { error: firstError.message ?? "Failed to release first message" },
        { status: 500 }
      );
    }

    if (firstUpdated && firstUpdated.length > 0) {
      updatedIds.push(firstUpdated[0].id as string);
    }

    let summaryText: string | null = null;

    if (rest.length > 0) {
      const restIds = rest.map((m) => m.id as string);
      const { data: restUpdated } = await admin
        .from("messages")
        .update({
          delivery_status: "delivered",
          delivered_at: nowIso,
          notification_suppressed: true,
        })
        .in("id", restIds)
        .select("id, conversation_id");

      if (restUpdated && restUpdated.length > 0) {
        updatedIds.push(...restUpdated.map((r) => r.id as string));
      }

      // Build a human-friendly summary notification message.
      const allConversationIds = new Set<string>();
      for (const row of [firstUpdated?.[0], ...(restUpdated ?? [])]) {
        if (row && row.conversation_id) {
          allConversationIds.add(row.conversation_id as string);
        }
      }

      const extraCount = rest.length;
      if (allConversationIds.size === 1) {
        const onlyConvId = Array.from(allConversationIds)[0];
        const { data: conv } = await admin
          .from("conversations")
          .select("subject")
          .eq("id", onlyConvId)
          .maybeSingle();

        if (conv?.subject) {
          summaryText = `You have ${extraCount} new messages in “${conv.subject}”.`;
        } else {
          summaryText = `You have ${extraCount} new messages.`;
        }
      } else {
        summaryText = `You have ${extraCount} new messages.`;
      }
    }

    return NextResponse.json({
      released: updatedIds.length,
      first_message_id: first.id,
      summary_notification: summaryText,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Delivery window release failed" },
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

