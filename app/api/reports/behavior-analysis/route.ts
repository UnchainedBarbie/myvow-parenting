import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

type BehaviorAnalysisReportData = {
  summary: {
    tone_trend: string | null;
    data_points_reviewed: number | string | null;
    date_range: unknown;
  };
  communication_patterns: {
    tone_breakdown: unknown;
    response_patterns: unknown;
    notable_patterns: unknown;
  };
  financial_compliance: {
    outstanding_amount: unknown;
    late_payments: unknown;
    dispute_ratio: unknown;
    patterns: unknown;
  };
  schedule_compliance: {
    total_events: unknown;
    patterns: unknown;
  };
  incident_summary: {
    count: unknown;
    types: unknown;
    recurring_themes: unknown;
  };
  documents_summary: {
    total: unknown;
    by_category: unknown;
  };
  narrative: string;
  recommended_next_steps: string[];
};

type ReportData = any;

function sanitizeReportData(raw: any): BehaviorAnalysisReportData | null {
  if (!raw || typeof raw !== "object") return null;

  const summaryRaw = raw.summary ?? {};
  const commRaw = raw.communication_patterns ?? {};
  const finRaw = raw.financial_compliance ?? {};
  const schedRaw = raw.schedule_compliance ?? {};
  const incidentRaw = raw.incident_summary ?? {};
  const docsRaw = raw.documents_summary ?? {};

  const narrative =
    typeof raw.narrative === "string" ? raw.narrative : "";
  const stepsRaw = Array.isArray(raw.recommended_next_steps)
    ? raw.recommended_next_steps.filter((s: any) => typeof s === "string")
    : [];

  return {
    summary: {
      tone_trend:
        typeof summaryRaw.tone_trend === "string"
          ? summaryRaw.tone_trend
          : null,
      data_points_reviewed:
        typeof summaryRaw.data_points_reviewed === "number" ||
        typeof summaryRaw.data_points_reviewed === "string"
          ? summaryRaw.data_points_reviewed
          : null,
      date_range: summaryRaw.date_range ?? null,
    },
    communication_patterns: {
      tone_breakdown: commRaw.tone_breakdown ?? null,
      response_patterns: commRaw.response_patterns ?? null,
      notable_patterns: commRaw.notable_patterns ?? null,
    },
    financial_compliance: {
      outstanding_amount: finRaw.outstanding_amount ?? null,
      late_payments: finRaw.late_payments ?? null,
      dispute_ratio: finRaw.dispute_ratio ?? null,
      patterns: finRaw.patterns ?? null,
    },
    schedule_compliance: {
      total_events: schedRaw.total_events ?? null,
      patterns: schedRaw.patterns ?? null,
    },
    incident_summary: {
      count: incidentRaw.count ?? null,
      types: incidentRaw.types ?? null,
      recurring_themes: incidentRaw.recurring_themes ?? null,
    },
    documents_summary: {
      total: docsRaw.total ?? null,
      by_category: docsRaw.by_category ?? null,
    },
    narrative,
    recommended_next_steps: stepsRaw,
  };
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const admin = getServiceRoleClient();
    const { searchParams } = new URL(request.url);
    const include = searchParams.get("include");
    const selectColumns =
      include === "full"
        ? "id, date_from, date_to, created_at, report_data"
        : "id, date_from, date_to, created_at";

    const { data, error } = await admin
      .from("behavior_analysis_reports")
      .select(selectColumns)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { message: error.message ?? "Failed to load reports" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      reports: data ?? [],
    });
  } catch (e) {
    return NextResponse.json(
      {
        message:
          e instanceof Error ? e.message : "Failed to load reports",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { date_from, date_to } = body as {
      date_from?: string;
      date_to?: string;
    };

    if (!date_from || !date_to) {
      return NextResponse.json(
        { message: "Missing date_from or date_to" },
        { status: 400 }
      );
    }

    const fromDate = new Date(date_from);
    const toDate = new Date(date_to);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return NextResponse.json(
        { message: "Invalid date range" },
        { status: 400 }
      );
    }

    const fromIso = fromDate.toISOString();
    const toIso = toDate.toISOString();

    const admin = getServiceRoleClient();

    // Resolve the user's case_id from case_members (first membership).
    const { data: membership, error: membershipError } = await admin
      .from("case_members")
      .select("case_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (membershipError) {
      return NextResponse.json(
        { message: membershipError.message ?? "Failed to resolve case" },
        { status: 500 }
      );
    }

    if (!membership || !membership.case_id) {
      return NextResponse.json(
        { message: "No case found for user" },
        { status: 400 }
      );
    }

    const caseId = membership.case_id as string;

    // 1. Messages and conversations within date range for this case.
    const { data: messages } = await admin
      .from("messages")
      .select(
        "id, case_id, conversation_id, created_at, direction, ai_classification, emotional_intensity_score, intensity_score, intensity_flag, category, sub_category, is_emergency, delivery_status, current_status"
      )
      .eq("case_id", caseId)
      .gte("created_at", fromIso)
      .lte("created_at", toIso);

    const convIds = Array.from(
      new Set(
        (messages ?? [])
          .map(
            (m) =>
              (m as { conversation_id?: string | null }).conversation_id ??
              null
          )
          .filter((id): id is string => !!id)
      )
    );

    let conversationsById: Record<
      string,
      { topic: string | null; category: string | null }
    > = {};

    if (convIds.length > 0) {
      const { data: conversations } = await admin
        .from("conversations")
        .select("id, topic, category")
        .in("id", convIds);
      for (const c of conversations ?? []) {
        const id = (c as { id: string }).id;
        conversationsById[id] = {
          topic: (c as { topic?: string | null }).topic ?? null,
          category: (c as { category?: string | null }).category ?? null,
        };
      }
    }

    const messageIds = (messages ?? []).map((m) => m.id as string);
    let flagsByMessageId: Record<
      string,
      { flag_type: string; description: string | null }[]
    > = {};

    if (messageIds.length > 0) {
      const { data: flags } = await admin
        .from("message_flags")
        .select("message_id, flag_type, description")
        .in("message_id", messageIds);

      for (const f of flags ?? []) {
        const mid = f.message_id as string;
        if (!flagsByMessageId[mid]) {
          flagsByMessageId[mid] = [];
        }
        flagsByMessageId[mid].push({
          flag_type: f.flag_type as string,
          description: (f as { description?: string | null }).description ?? null,
        });
      }
    }

    const messageSummary = {
      total_messages: (messages ?? []).length,
      by_direction: (messages ?? []).reduce(
        (acc, m) => {
          const dir = (m as { direction?: string }).direction ?? "unknown";
          acc[dir] = (acc[dir] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      ),
      by_category: (messages ?? []).reduce(
        (acc, m) => {
          const cat = (m as { category?: string | null }).category ?? "unknown";
          acc[cat] = (acc[cat] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      ),
      emergency_count: (messages ?? []).filter(
        (m) => (m as { is_emergency?: boolean }).is_emergency === true
      ).length,
      flagged_count: Object.keys(flagsByMessageId).length,
      topics: (messages ?? []).reduce(
        (acc, m) => {
          const convId = (m as { conversation_id?: string | null })
            .conversation_id;
          if (!convId) return acc;
          const topic = conversationsById[convId]?.topic;
          if (!topic) return acc;
          acc[topic] = (acc[topic] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      ),
      messages_sample: (messages ?? [])
        .slice(0, 50)
        .map((m) => {
          const convId = (m as { conversation_id?: string | null })
            .conversation_id;
          const convMeta = convId ? conversationsById[convId] ?? null : null;
          return {
            id: m.id,
            created_at: m.created_at,
            direction: m.direction,
            category: m.category,
            sub_category: m.sub_category,
            ai_classification: m.ai_classification,
            emotional_intensity_score: m.emotional_intensity_score,
            intensity_score: (m as { intensity_score?: number | null })
              .intensity_score ?? null,
            intensity_flag: (m as { intensity_flag?: boolean | null })
              .intensity_flag ?? null,
            is_emergency: m.is_emergency,
            delivery_status: m.delivery_status,
            current_status: m.current_status,
            topic: convMeta?.topic ?? null,
            conversation_category: convMeta?.category ?? null,
            flags: flagsByMessageId[m.id as string] ?? [],
          };
        }),
    };

    // 2. Incidents (sage_sessions where session_type = 'incident' for this user).
    const { data: incidents } = await admin
      .from("sage_sessions")
      .select(
        "id, title, category, created_at, updated_at, flagged, documented"
      )
      .eq("user_id", user.id)
      .eq("session_type", "incident")
      .gte("created_at", fromIso)
      .lte("created_at", toIso)
      .order("created_at", { ascending: true });

    const incidentSummary = {
      count: (incidents ?? []).length,
      by_category: (incidents ?? []).reduce(
        (acc, i) => {
          const cat = (i as { category?: string | null }).category ?? "uncategorized";
          acc[cat] = (acc[cat] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      ),
      flagged_count: (incidents ?? []).filter(
        (i) => (i as { flagged?: boolean | null }).flagged === true
      ).length,
      documented_count: (incidents ?? []).filter(
        (i) => (i as { documented?: boolean | null }).documented === true
      ).length,
      incidents: (incidents ?? []).map((i) => ({
        id: i.id,
        title: i.title,
        category: i.category,
        created_at: i.created_at,
        updated_at: (i as { updated_at?: string | null }).updated_at ?? null,
        flagged: (i as { flagged?: boolean | null }).flagged ?? false,
        documented: (i as { documented?: boolean | null }).documented ?? false,
      })),
    };

    // 3. Expenses for this case within date range.
    const { data: expenses } = await admin
      .from("expenses")
      .select(
        "id, created_at, amount, amount_owed, status, dispute_reason, paid_at"
      )
      .eq("case_id", caseId)
      .is("deleted_at", null)
      .gte("created_at", fromIso)
      .lte("created_at", toIso)
      .order("created_at", { ascending: true });

    const expenseStatusCounts = (expenses ?? []).reduce(
      (acc, e) => {
        const status = (e as { status?: string | null }).status ?? "unknown";
        acc[status] = (acc[status] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    const expensesSummary = {
      total_expenses: (expenses ?? []).length,
      status_counts: expenseStatusCounts,
      total_amount: (expenses ?? []).reduce(
        (sum, e) => sum + Number((e as { amount?: number | null }).amount ?? 0),
        0
      ),
      total_amount_owed: (expenses ?? []).reduce(
        (sum, e) =>
          sum +
          Number((e as { amount_owed?: number | null }).amount_owed ?? 0),
        0
      ),
      expenses: (expenses ?? []).map((e) => ({
        id: e.id,
        created_at: e.created_at,
        amount: e.amount,
        amount_owed: (e as { amount_owed?: number | null }).amount_owed ?? null,
        status: e.status,
        dispute_reason: (e as { dispute_reason?: string | null })
          .dispute_reason ?? null,
        paid_at: (e as { paid_at?: string | null }).paid_at ?? null,
      })),
    };

    // 4. Calendar events for this case and range.
    const { data: events } = await admin
      .from("calendar_events")
      .select(
        "id, event_type, start_time, end_time, all_day, visibility, kid_title"
      )
      .eq("case_id", caseId)
      .gte("start_time", fromIso)
      .lte("start_time", toIso)
      .order("start_time", { ascending: true });

    const eventTypeCounts = (events ?? []).reduce(
      (acc, ev) => {
        const type = (ev as { event_type?: string | null }).event_type ?? "other";
        acc[type] = (acc[type] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    const calendarSummary = {
      total_events: (events ?? []).length,
      event_type_counts: eventTypeCounts,
      custody_exchange_count:
        eventTypeCounts["custody_exchange"] ?? 0,
      events: (events ?? []).map((ev) => ({
        id: ev.id,
        event_type: ev.event_type,
        start_time: (ev as { start_time?: string | null }).start_time ?? null,
        end_time: (ev as { end_time?: string | null }).end_time ?? null,
        all_day: (ev as { all_day?: boolean | null }).all_day ?? false,
        visibility: ev.visibility,
        kid_title: (ev as { kid_title?: string | null }).kid_title ?? null,
      })),
    };

    // 5. Documents for this case and range.
    const { data: documents } = await admin
      .from("documents")
      .select("id, category, visibility, created_at")
      .eq("case_id", caseId)
      .gte("created_at", fromIso)
      .lte("created_at", toIso)
      .order("created_at", { ascending: true });

    const docsByCategory = (documents ?? []).reduce(
      (acc, d) => {
        const cat = (d as { category?: string | null }).category ?? "uncategorized";
        acc[cat] = (acc[cat] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    const documentsSummary = {
      total: (documents ?? []).length,
      by_category: docsByCategory,
    };

    const hasAnyMessages = (messages ?? []).length > 0;
    const hasAnyIncidents = (incidents ?? []).length > 0;
    const hasAnyExpenses = (expenses ?? []).length > 0;
    const hasAnyEvents = (events ?? []).length > 0;

    if (!hasAnyMessages && !hasAnyIncidents && !hasAnyExpenses && !hasAnyEvents) {
      const fallbackReport: BehaviorAnalysisReportData = {
        summary: {
          tone_trend: "insufficient_data",
          data_points_reviewed: 0,
          date_range: { from: date_from, to: date_to },
        },
        communication_patterns: {
          tone_breakdown: null,
          response_patterns: null,
          notable_patterns: null,
        },
        financial_compliance: {
          outstanding_amount: null,
          late_payments: null,
          dispute_ratio: null,
          patterns: null,
        },
        schedule_compliance: {
          total_events: null,
          patterns: null,
        },
        incident_summary: {
          count: null,
          types: null,
          recurring_themes: null,
        },
        documents_summary: {
          total: null,
          by_category: null,
        },
        narrative:
          "There is not enough data in this date range to generate an analysis. Try selecting a longer date range or generate the report after more activity has been logged.",
        recommended_next_steps: [
          "Log messages with your co-parent",
          "Record any incidents using Sage",
          "Track shared expenses",
        ],
      };

      const { data: inserted, error: insertError } = await admin
        .from("behavior_analysis_reports")
        .insert({
          case_id: caseId,
          user_id: user.id,
          date_from,
          date_to,
          report_data: fallbackReport,
        })
        .select("id, created_at, report_data")
        .single();

      if (insertError || !inserted) {
        return NextResponse.json(
          { message: insertError?.message ?? "Failed to save report" },
          { status: 500 }
        );
      }

      return NextResponse.json({
        id: inserted.id,
        report_data: inserted.report_data,
        created_at: inserted.created_at,
      });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { message: "Anthropic API key not configured" },
        { status: 500 }
      );
    }

    const systemPrompt = `You are Sage, a private AI assistant for MyVow Parenting. 
You are analyzing co-parenting data to help a parent understand 
patterns and prepare for difficult conversations or legal 
proceedings. Be factual, specific, and compassionate. 
Frame all observations neutrally using phrases like 
"the data shows" or "patterns suggest". Never make definitive 
legal conclusions. Always maintain a calm, empowering tone.

Privacy rules:
- Do NOT include any names, email addresses, phone numbers, case IDs, user IDs, or other direct identifiers in your response.
- Refer to "the other parent" or "co-parent" instead of using names.
- Do not quote messages or documents verbatim; summarize them instead.`;

    const userPayload = {
      date_range: { from: date_from, to: date_to },
      data_sets: {
        messages: messageSummary,
        incidents: incidentSummary,
        expenses: expensesSummary,
        calendar: calendarSummary,
        documents: documentsSummary,
      },
      instructions: {
        goal: "Analyze the co-parenting data and return a structured JSON object summarizing patterns and risks.",
        required_output_shape: {
          summary: {
            tone_trend:
              "string describing how communication tone has shifted over the date range",
            data_points_reviewed:
              "number of total data points reviewed across all sources",
            date_range:
              "the exact date range you considered, either as an object { from, to } or a descriptive string",
          },
          communication_patterns: {
            tone_breakdown:
              "neutral, factual description of tone distribution over time",
            response_patterns:
              "observations about responsiveness, delays, and escalation/de-escalation patterns",
            notable_patterns:
              "any other notable communication themes or topics (no names, no quotes)",
          },
          financial_compliance: {
            outstanding_amount:
              "estimated amount still owed or unresolved, based on expenses data",
            late_payments:
              "description and approximate count of significantly delayed payments",
            dispute_ratio:
              "ratio or qualitative description of disputed vs total expenses",
            patterns:
              "patterns in which categories or time periods tend to see issues",
          },
          schedule_compliance: {
            total_events:
              "total number of calendar events in the range (including custody exchanges)",
            patterns:
              "patterns around missed, shifted, or dense custody exchanges or important events (based on event types only)",
          },
          incident_summary: {
            count:
              "total number of incident sessions recorded during the period",
            types:
              "description or breakdown of the main types/categories of incidents",
            recurring_themes:
              "themes that recur across multiple incidents (no names or specific quotes)",
          },
          documents_summary: {
            total: "total number of documents added in the range",
            by_category:
              "object mapping each document category to its count for the period",
          },
          narrative:
            "2-3 paragraphs that synthesize the findings in a compassionate, empowering tone, without legal conclusions or personal identifiers.",
          recommended_next_steps:
            "array of concrete, practical next steps the parent could take. Each step should be a short sentence.",
        },
        formatting: {
          response_must_be_json_object: true,
          top_level_keys: [
            "summary",
            "communication_patterns",
            "financial_compliance",
            "schedule_compliance",
            "incident_summary",
            "documents_summary",
            "narrative",
            "recommended_next_steps",
          ],
        },
      },
    };

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: JSON.stringify(userPayload),
          },
        ],
      }),
    });

    if (!res.ok) {
      return NextResponse.json(
        { message: "Failed to generate analysis" },
        { status: 500 }
      );
    }

    const aiData = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };

    const rawText = aiData.content?.find(
      (c: { type: string }) => c.type === "text"
    )?.text ?? "{}";

    const cleaned = rawText
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    let parsed: ReportData;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("[behavior-analysis] Parse failed. Raw:", rawText);
      return NextResponse.json(
        { message: "Failed to parse AI response. Please try again." },
        { status: 500 }
      );
    }

    const reportData = sanitizeReportData(parsed);
    if (!reportData) {
      return NextResponse.json(
        { message: "AI response missing required fields" },
        { status: 500 }
      );
    }

    const { data: inserted, error: insertError } = await admin
      .from("behavior_analysis_reports")
      .insert({
        case_id: caseId,
        user_id: user.id,
        date_from,
        date_to,
        report_data: reportData,
      })
      .select("id, created_at, report_data")
      .single();

    if (insertError || !inserted) {
      return NextResponse.json(
        { message: insertError?.message ?? "Failed to save report" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      id: inserted.id,
      report_data: inserted.report_data,
      created_at: inserted.created_at,
    });
  } catch (e) {
    return NextResponse.json(
      {
        message:
          e instanceof Error
            ? e.message
            : "Failed to generate behavior analysis report",
      },
      { status: 500 }
    );
  }
}

