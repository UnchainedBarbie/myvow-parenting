import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

type SuggestedVow = { vow: string; reason: string };

export async function POST(_request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const admin = getServiceRoleClient();

    // Resolve active case for this user
    const { data: membership } = await admin
      .from("case_members")
      .select("case_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    const caseId = (membership?.case_id as string | null) ?? null;
    if (!caseId) {
      return NextResponse.json({ suggestions: [] });
    }

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const fourteenDaysAhead = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    // Messages: last 30 days for this user in this case (outgoing only)
    const { data: messages } = await admin
      .from("messages")
      .select("created_at, original_content, ai_rewritten, ai_rewritten_content")
      .eq("case_id", caseId)
      .eq("sender_id", user.id)
      .gte("created_at", thirtyDaysAgo.toISOString())
      .order("created_at", { ascending: false })
      .limit(100);

    // Vows: active (not deleted) for this user in this case
    const { data: vows } = await admin
      .from("vows")
      .select("content")
      .eq("case_id", caseId)
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(50);

    // Expenses: last 30 days in this case
    const { data: expenses } = await admin
      .from("expenses")
      .select("description, status, dispute_reason, created_at")
      .eq("case_id", caseId)
      .is("deleted_at", null)
      .gte("created_at", thirtyDaysAgo.toISOString())
      .order("created_at", { ascending: false })
      .limit(100);

    // Upcoming calendar events in next 14 days
    const { data: events } = await admin
      .from("calendar_events")
      .select("title, start_time")
      .eq("case_id", caseId)
      .gte("start_time", now.toISOString())
      .lte("start_time", fourteenDaysAhead.toISOString())
      .order("start_time", { ascending: true })
      .limit(50);

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ suggestions: [] });
    }

    const payload = {
      messages: (messages ?? []).map((m) => ({
        created_at: m.created_at,
        content: (m.ai_rewritten ? m.ai_rewritten_content : m.original_content) ?? "",
        softened_by_sage: !!m.ai_rewritten,
      })),
      vows: (vows ?? []).map((v) => v.content ?? ""),
      expenses: (expenses ?? []).map((e) => ({
        created_at: e.created_at,
        description: e.description ?? "",
        status: e.status ?? "",
        dispute_reason: e.dispute_reason ?? "",
      })),
      events: (events ?? []).map((ev) => ({
        title: ev.title ?? "",
        start_time: ev.start_time,
      })),
    };

    const systemPrompt = `You are Sage, a calm, private co-parenting coach.

You see the user's recent messages, vows, expenses, and upcoming calendar events.
Your job is to notice gentle behavioral patterns and suggest 2–3 short first-person vows.

Guidelines:
- Each vow MUST start with "I vow to..." and be at most 12 words.
- Each vow should be agency-preserving and non-blaming.
- For each vow, include a one-sentence "why" explanation referencing the specific pattern
  (e.g., "You've had 3 expense disputes this week."), without shame or judgment.
- Avoid legal advice, diagnoses, or therapy claims.

Return ONLY JSON in this exact shape (no extra keys, no commentary):
[
  { "vow": "I vow to...", "reason": "You've had..." },
  { "vow": "I vow to...", "reason": "You've had..." }
]

If you cannot find any meaningful pattern, return an empty array: [].`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 400,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: JSON.stringify(payload),
          },
        ],
      }),
    });

    if (!res.ok) {
      return NextResponse.json({ suggestions: [] });
    }

    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = data.content?.find((c) => c.type === "text")?.text ?? "[]";

    let suggestions: SuggestedVow[] = [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        suggestions = parsed
          .filter(
            (item) =>
              item &&
              typeof item.vow === "string" &&
              typeof item.reason === "string"
          )
          .slice(0, 3);
      }
    } catch {
      suggestions = [];
    }

    return NextResponse.json({ suggestions });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Failed to load suggested vows" },
      { status: 500 }
    );
  }
}

