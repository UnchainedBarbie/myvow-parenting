import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { REWRITE_OUTBOUND_SYSTEM_PROMPT } from "@/lib/ai/prompts";

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
    const { message } = body as { message?: string };
    const trimmed = (message ?? "").trim();
    if (!trimmed) {
      return NextResponse.json(
        { message: "message is required." },
        { status: 400 }
      );
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { message: "Rewrite is not configured." },
        { status: 503 }
      );
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: REWRITE_OUTBOUND_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Rewrite this message for my co-parent:\n\n${trimmed}`,
          },
        ],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json(
        { message: err || "Rewrite failed." },
        { status: 502 }
      );
    }

    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = data.content?.find((c) => c.type === "text")?.text?.trim();
    const rewritten = text ?? trimmed;

    return NextResponse.json({ rewritten });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Rewrite failed" },
      { status: 500 }
    );
  }
}
