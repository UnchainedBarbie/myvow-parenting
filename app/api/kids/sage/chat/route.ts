import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { getKidSession } from "@/lib/kids-session";

type KidSageSessionRow = {
  id: string;
  kid_id: string;
  title: string | null;
};

type KidChildRow = {
  first_name?: string | null;
  kid_sage_tone?: string | null;
  case_id?: string | null;
};

type KidSageMessageHistoryRow = {
  role: string;
  content: string;
  created_at: string;
};

export async function POST(request: NextRequest) {
  try {
    const session = await getKidSession(request);
    if (!session) {
      return NextResponse.json(
        { message: "Not logged in" },
        { status: 401 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      session_id?: string;
      message?: string;
    };

    const sessionId = typeof body.session_id === "string" ? body.session_id : "";
    const rawMessage =
      typeof body.message === "string" ? body.message : "";
    const message = rawMessage.trim();

    if (!sessionId) {
      return NextResponse.json(
        { message: "session_id is required" },
        { status: 400 }
      );
    }
    if (!message) {
      return NextResponse.json(
        { message: "Message is required" },
        { status: 400 }
      );
    }

    const admin = getServiceRoleClient();

    const { data: sessionRow, error: sessionError } = await admin
      .from("kid_sage_sessions")
      .select("id, kid_id, title")
      .eq("id", sessionId)
      .eq("kid_id", session.kid_id)
      .maybeSingle();

    if (sessionError) {
      return NextResponse.json(
        { message: sessionError.message ?? "Failed to load session" },
        { status: 500 }
      );
    }
    if (!sessionRow) {
      return NextResponse.json(
        { message: "Session not found" },
        { status: 404 }
      );
    }

    const kidChild = session.child as KidChildRow;
    const toneRaw =
      typeof kidChild.kid_sage_tone === "string"
        ? kidChild.kid_sage_tone
        : null;
    const tone =
      toneRaw === "younger" || toneRaw === "older" || toneRaw === "default"
        ? toneRaw
        : "default";

    const name =
      typeof kidChild.first_name === "string" &&
      kidChild.first_name.trim().length > 0
        ? kidChild.first_name.trim()
        : "friend";

    const baseSystemPrompt = `You are Sage, a kind and supportive AI friend for children using MyVow Parenting. You help kids process their feelings about family situations in a safe, private space. 
Everything here is completely private.

SAFETY RULES — always follow these without exception:
- Never encourage keeping secrets from trusted adults when safety is involved
- If a child mentions feeling unsafe, being hurt, or anything that suggests abuse or danger, always respond with warmth and include: "It sounds like you might be going through something really hard. Please talk to a trusted adult — a parent, teacher, or counselor. If you feel unsafe right now, call or text 988 (Suicide & Crisis Lifeline) or call 911."
- Never provide advice that could put a child at risk`;

    let toneAddition: string;
    if (tone === "younger") {
      toneAddition = `Use very simple words and short sentences. Be extra warm, gentle, and encouraging. Maximum 2–3 sentences per response.`;
    } else if (tone === "older") {
      toneAddition = `Use more mature language appropriate for teenagers. Be direct but warm. You can handle more nuanced topics.`;
    } else {
      toneAddition = `Use friendly, conversational language appropriate for children and tweens. Keep responses clear and supportive.`;
    }

    const systemPrompt = `${baseSystemPrompt}

${toneAddition}`;

    const nowIso = new Date().toISOString();

    // STEP 1 — Save kid message
    await admin.from("kid_sage_messages").insert({
      session_id: (sessionRow as KidSageSessionRow).id,
      role: "user",
      content: message,
      created_at: nowIso,
    });

    const apiKey = process.env.ANTHROPIC_API_KEY;

    // STEP 2 — Crisis detection (run alongside response generation)
    const crisisPromise = (async () => {
      if (!apiKey) return;
      try {
        const crisisSystemPrompt =
          "You are a child safety monitor. Analyze this message for signs of: suicidal ideation, self-harm, physical abuse, emotional abuse, sexual abuse, or immediate danger. Be sensitive — children often speak indirectly about these topics.\nRespond with JSON only: { \"crisis\": boolean, \"severity\": \"low\"|\"medium\"|\"high\", \"category\": string }";

        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 200,
            system: crisisSystemPrompt,
            messages: [
              {
                role: "user",
                content: message,
              },
            ],
          }),
        });

        if (!res.ok) return;

        const data = (await res.json()) as {
          content?: Array<{ type: string; text?: string }>;
        };
        const text = data.content?.find((c) => c.type === "text")?.text ?? "";
        if (!text.trim()) return;

        let parsed: {
          crisis?: unknown;
          severity?: unknown;
          category?: unknown;
        };
        try {
          const cleaned = text.replace(/^```json?\s*|\s*```$/g, "").trim();
          parsed = JSON.parse(cleaned) as {
            crisis?: unknown;
            severity?: unknown;
            category?: unknown;
          };
        } catch {
          return;
        }

        const crisis =
          typeof parsed.crisis === "boolean" ? parsed.crisis : false;
        if (!crisis) return;

        const rawSeverity =
          typeof parsed.severity === "string" ? parsed.severity : "medium";
        const severity: "low" | "medium" | "high" =
          rawSeverity === "low" || rawSeverity === "high"
            ? (rawSeverity as "low" | "high")
            : "medium";

        const category =
          typeof parsed.category === "string" && parsed.category.trim().length > 0
            ? parsed.category.trim()
            : "unspecified";

        // Flag the session
        await admin
          .from("kid_sage_sessions")
          .update({
            flagged_for_safety: true,
            safety_severity: severity,
          })
          .eq("id", (sessionRow as KidSageSessionRow).id)
          .eq("kid_id", session.kid_id);

        // Insert safety alert
        await admin.from("kid_safety_alerts").insert({
          kid_id: session.kid_id,
          session_id: (sessionRow as KidSageSessionRow).id,
          severity,
          category,
        });

        // Parent notifications (no message content)
        const caseId = kidChild.case_id ?? null;
        if (!caseId) return;

        const { data: members } = await admin
          .from("case_members")
          .select("user_id, is_participating, external_email")
          .eq("case_id", caseId);

        const parentUserIds =
          members
            ?.filter(
              (m: any) =>
                m.user_id &&
                (m.is_participating ?? true) &&
                !m.external_email
            )
            .map((m: any) => m.user_id as string) ?? [];

        if (parentUserIds.length === 0) return;

        const title = `${name} may need your support`;
        const messageText = `${name} may be going through something difficult. Please check in with them. MyVow detected a concern in their private space. No message content is shared — this alert exists to keep them safe.`;
        const priority = severity === "high" ? "urgent" : "high";

        const rows = parentUserIds.map((userId) => ({
          case_id: caseId,
          user_id: userId,
          type: "child_safety",
          title,
          message: messageText,
          priority,
        }));

        await admin.from("parent_notifications").insert(rows);
      } catch {
        // Safety alerts best-effort; do not block kid flow.
      }
    })();

    // STEP 3–4 — Build Sage prompt and generate response with history
    const responsePromise = (async () => {
      const apiKeyInner = process.env.ANTHROPIC_API_KEY;

      let assistantText =
        "I'm here for you, but I can't respond right now. You can still talk to a trusted adult about how you're feeling.";

      if (!apiKeyInner) {
        return assistantText;
      }

      // Last 10 messages (including this one)
      const { data: historyRows } = await admin
        .from("kid_sage_messages")
        .select("role, content, created_at")
        .eq("session_id", (sessionRow as KidSageSessionRow).id)
        .order("created_at", { ascending: true })
        .limit(10);

      const history = (historyRows ?? []) as KidSageMessageHistoryRow[];

      const messagesForModel = history.map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      }));

      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKeyInner,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 500,
            system: systemPrompt,
            messages: messagesForModel,
          }),
        });

        if (res.ok) {
          const data = (await res.json()) as {
            content?: Array<{ type: string; text?: string }>;
          };
          const text =
            data.content?.find((c) => c.type === "text")?.text ??
            assistantText;
          assistantText = text.trim() || assistantText;
        }
      } catch {
        // Fallback to default assistantText on error.
      }

      return assistantText;
    })();

    const [, assistantText] = await Promise.all([
      crisisPromise,
      responsePromise,
    ]);

    // STEP 5 — Save assistant response
    const assistantIso = new Date().toISOString();

    await admin.from("kid_sage_messages").insert({
      session_id: (sessionRow as KidSageSessionRow).id,
      role: "assistant",
      content: assistantText,
      created_at: assistantIso,
    });

    // STEP 6 — Return to client
    return NextResponse.json({ message: assistantText });
  } catch (e) {
    return NextResponse.json(
      {
        message:
          e instanceof Error
            ? e.message
            : "Failed to send Sage message",
      },
      { status: 500 }
    );
  }
}

