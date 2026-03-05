import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

type IncidentDoc = {
  id: string;
  title: string | null;
  created_at: string;
  child_id: string | null;
  related_comm_id: string | null;
};

type IncidentPattern = {
  id: string;
  label: string;
  summary: string;
  session_ids: string[];
};

export async function GET(_request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const admin = getServiceRoleClient();

    // Load incident sessions for this user (recent first).
    const { data: sessions } = await admin
      .from("sage_sessions")
      .select("id, session_type, updated_at")
      .eq("user_id", user.id)
      .eq("session_type", "incident")
      .neq("archived", true)
      .order("updated_at", { ascending: false })
      .limit(100);

    const incidentSessions =
      (sessions ?? []).filter((s) => s.session_type === "incident") as {
        id: string;
        updated_at: string;
        session_type: string;
      }[];

    if (incidentSessions.length < 2) {
      return NextResponse.json({ patterns: [] as IncidentPattern[] });
    }

    const sessionIds = incidentSessions.map((s) => s.id);

    // Load associated incident documents created by this user.
    const { data: docs } = await admin
      .from("documents")
      .select("id, title, created_at, child_id, related_comm_id, category, visibility, uploaded_by")
      .eq("uploaded_by", user.id)
      .eq("category", "incident")
      .eq("visibility", "private")
      .in("related_comm_id", sessionIds)
      .order("created_at", { ascending: false })
      .limit(200);

    const incidentDocs: IncidentDoc[] = (docs ?? []).map((d) => ({
      id: d.id as string,
      title: (d.title as string | null) ?? null,
      created_at: d.created_at as string,
      child_id: (d.child_id as string | null) ?? null,
      related_comm_id: (d.related_comm_id as string | null) ?? null,
    }));

    if (incidentDocs.length < 2) {
      return NextResponse.json({ patterns: [] as IncidentPattern[] });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ patterns: [] as IncidentPattern[] });
    }

    const payload = {
      sessions: incidentSessions.map((s) => ({
        id: s.id,
        updated_at: s.updated_at,
      })),
      documents: incidentDocs.map((d) => ({
        id: d.id,
        title: d.title ?? "",
        created_at: d.created_at,
        child_id: d.child_id,
        session_id: d.related_comm_id,
      })),
    };

    const systemPrompt = `You are Sage, a calm, private co-parenting coach.

You see the user's private incident reports. Each report has:
- a title
- created_at timestamp
- the child involved (optional)
- the associated incident session id.

Your job:
- Group incidents into a few meaningful patterns by TYPE (e.g. schedule issues, health & safety, communication, expenses, other).
- For each pattern, write ONE short summary sentence such as:
  "3 Schedule issues in the last 30 days."
- Each pattern must also list the related incident session_ids.

Return ONLY JSON in this exact shape (no extra keys, no commentary):
[
  {
    "id": "schedule_pattern",
    "label": "Schedule issues",
    "summary": "3 Schedule issues in the last 30 days.",
    "session_ids": ["SESSION_ID_1", "SESSION_ID_2"]
  }
]

Rules:
- Use 1–5 patterns.
- session_ids MUST be chosen only from the session ids you see.
- If you cannot find any meaningful patterns, return an empty array: [].`;

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
      return NextResponse.json({ patterns: [] as IncidentPattern[] });
    }

    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = data.content?.find((c) => c.type === "text")?.text ?? "[]";

    let patterns: IncidentPattern[] = [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        patterns = parsed
          .filter(
            (p) =>
              p &&
              typeof p.id === "string" &&
              typeof p.label === "string" &&
              typeof p.summary === "string" &&
              Array.isArray(p.session_ids)
          )
          .map((p) => ({
            id: p.id as string,
            label: p.label as string,
            summary: p.summary as string,
            session_ids: (p.session_ids as string[]).filter((sid) =>
              sessionIds.includes(sid)
            ),
          }))
          .filter((p) => p.session_ids.length > 0);
      }
    } catch {
      patterns = [];
    }

    return NextResponse.json({ patterns });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Failed to load patterns" },
      { status: 500 }
    );
  }
}

