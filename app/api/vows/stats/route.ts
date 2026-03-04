import { NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

const THIRTY_DAYS_AGO = new Date();
THIRTY_DAYS_AGO.setDate(THIRTY_DAYS_AGO.getDate() - 30);

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const admin = getServiceRoleClient();

    const { data: membership } = await admin
      .from("case_members")
      .select("case_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    const caseId = membership?.case_id as string | undefined;
    if (!caseId) {
      return NextResponse.json(
        {
          messages_sent: 0,
          messages_softened: 0,
          calm_streak_days: 0,
          vow_alignment_pct: null,
          top_vow_text: null,
          top_trigger_tag: null,
        },
        { status: 200 }
      );
    }

    const since = THIRTY_DAYS_AGO.toISOString();

    const { count: messagesSent, error: sentError } = await admin
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("case_id", caseId)
      .eq("sender_id", user.id)
      .gte("created_at", since);

    if (sentError) {
      return NextResponse.json(
        { message: sentError.message },
        { status: 500 }
      );
    }

    const { count: messagesSoftened, error: softenedError } = await admin
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("case_id", caseId)
      .eq("sender_id", user.id)
      .eq("ai_rewritten", true)
      .gte("created_at", since);

    if (softenedError) {
      return NextResponse.json(
        { message: softenedError.message },
        { status: 500 }
      );
    }

    const { data: intenseMessages, error: intenseError } = await admin
      .from("messages")
      .select("created_at")
      .eq("case_id", caseId)
      .eq("sender_id", user.id)
      .eq("intensity_flag", true)
      .gte("created_at", since);

    if (intenseError) {
      return NextResponse.json(
        { message: intenseError.message },
        { status: 500 }
      );
    }

    const intenseDays = new Set<string>();
    for (const row of intenseMessages ?? []) {
      const d = (row.created_at as string).slice(0, 10);
      intenseDays.add(d);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let calmStreakDays = 0;
    const todayStr = today.toISOString().slice(0, 10);
    for (let i = 0; i < 31; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dayStr = d.toISOString().slice(0, 10);
      if (intenseDays.has(dayStr)) break;
      calmStreakDays += 1;
    }

    // Vow alignment: percentage of messages aligned with vows in the last 30 days.
    let vowAlignmentPct: number | null = null;
    let topVowText: string | null = null;
    let topTriggerTag: string | null = null;

    if ((messagesSent ?? 0) > 0) {
      const { data: alignmentRows, error: alignmentError } = await admin
        .from("messages")
        .select("vow_alignment_score, aligned_bool, analysis_tags")
        .eq("case_id", caseId)
        .eq("sender_id", user.id)
        .gte("created_at", since);

      if (alignmentError) {
        return NextResponse.json(
          { message: alignmentError.message },
          { status: 500 }
        );
      }

      let alignedCount = 0;
      const triggerCounts: Record<string, number> = {};

      for (const row of alignmentRows ?? []) {
        const alignedExplicit = (row as any).aligned_bool as boolean | null;
        const score = (row as any).vow_alignment_score as number | null;
        const aligned =
          alignedExplicit === true ||
          (alignedExplicit == null && score != null && score >= 0.7);
        if (aligned) alignedCount += 1;

        const tags = (row as any).analysis_tags as { triggers?: string[] } | null;
        if (tags?.triggers && Array.isArray(tags.triggers)) {
          for (const t of tags.triggers) {
            if (!t) continue;
            triggerCounts[t] = (triggerCounts[t] ?? 0) + 1;
          }
        }
      }

      if (messagesSent && messagesSent > 0) {
        vowAlignmentPct = Math.round((alignedCount / messagesSent) * 100);
      }

      // Optional: pick most common trigger tag if present.
      const triggerEntries = Object.entries(triggerCounts);
      if (triggerEntries.length > 0) {
        triggerEntries.sort((a, b) => b[1] - a[1]);
        topTriggerTag = triggerEntries[0][0];
      }
    }

    return NextResponse.json({
      messages_sent: messagesSent ?? 0,
      messages_softened: messagesSoftened ?? 0,
      calm_streak_days: calmStreakDays,
      vow_alignment_pct: vowAlignmentPct,
      top_vow_text: topVowText,
      top_trigger_tag: topTriggerTag,
    });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Failed to load stats" },
      { status: 500 }
    );
  }
}
