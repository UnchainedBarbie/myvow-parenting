import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

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
    const { firstMessage, sessionId } = body as {
      firstMessage?: string;
      sessionId?: string;
    };
    const trimmed = (firstMessage ?? "").trim();
    if (!sessionId || typeof sessionId !== "string" || !trimmed) {
      return NextResponse.json(
        { message: "firstMessage and sessionId are required." },
        { status: 400 }
      );
    }

    const admin = getServiceRoleClient();

    const { data: session, error: sessionError } = await admin
      .from("sage_sessions")
      .select("id, user_id")
      .eq("id", sessionId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (sessionError || !session) {
      return NextResponse.json(
        { message: "Session not found." },
        { status: 404 }
      );
    }

    let title = trimmed.slice(0, 40);
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 60,
            messages: [
              {
                role: "user",
                content: `Generate a short title (max 6 words, no quotes, no punctuation) that captures the topic of this message: ${trimmed}`,
              },
            ],
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as {
            content?: Array<{ type: string; text?: string }>;
          };
          const text = data.content?.find((c) => c.type === "text")?.text?.trim();
          if (text) {
            const cleaned = text.replace(/^["']|["']$/g, "").slice(0, 80);
            if (cleaned.length > 0) title = cleaned;
          }
        }
      } catch {
        // Keep fallback title from first message
      }
    }

    const now = new Date().toISOString();
    const { error: updateError } = await admin
      .from("sage_sessions")
      .update({ title, updated_at: now })
      .eq("id", sessionId)
      .eq("user_id", user.id);

    if (updateError) {
      return NextResponse.json(
        { message: updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ title });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Title generation failed" },
      { status: 500 }
    );
  }
}
