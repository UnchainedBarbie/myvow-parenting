import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

const SYSTEM_PROMPT = `You are Sage, a calm co-parenting reflection assistant.

Your role is to help the user:
- regulate emotions
- think clearly before responding
- draft respectful communication
- document interactions constructively.

Never insult the coparent.
Never escalate conflict.
Keep responses concise and calm.`;

type SageMessageRow = {
  id: string;
  user_id: string;
  role: "user" | "sage";
  content: string;
  created_at: string;
};

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
    const { data, error } = await admin
      .from("sage_journal_messages")
      .select("id, user_id, role, content, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json(
        { message: error.message },
        { status: 500 }
      );
    }

    const messages: SageMessageRow[] =
      (data ?? []) as unknown as SageMessageRow[];

    return NextResponse.json({ messages });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Failed to load Sage messages" },
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
    const { content } = body as { content?: string };
    const trimmed = (content ?? "").trim();
    if (!trimmed) {
      return NextResponse.json(
        { message: "Content is required." },
        { status: 400 }
      );
    }

    const admin = getServiceRoleClient();
    const now = new Date().toISOString();

    // Insert user message first.
    const { data: userRow, error: insertUserError } = await admin
      .from("sage_journal_messages")
      .insert({
        user_id: user.id,
        role: "user",
        content: trimmed,
        created_at: now,
      })
      .select("id, user_id, role, content, created_at")
      .single();

    if (insertUserError || !userRow) {
      return NextResponse.json(
        { message: insertUserError?.message ?? "Failed to save message." },
        { status: 500 }
      );
    }

    let sageContent =
      "I'm here with you. Take a breath, then tell me what feels most important about this moment for your children.";

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
            max_tokens: 400,
            system: SYSTEM_PROMPT,
            messages: [{ role: "user", content: trimmed }],
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as {
            content?: Array<{ type: string; text?: string }>;
          };
          const text =
            data.content?.find((c) => c.type === "text")?.text?.trim();
          if (text) sageContent = text;
        }
      } catch {
        // Fall back to default sageContent
      }
    }

    const { data: sageRow, error: insertSageError } = await admin
      .from("sage_journal_messages")
      .insert({
        user_id: user.id,
        role: "sage",
        content: sageContent,
        created_at: new Date().toISOString(),
      })
      .select("id, user_id, role, content, created_at")
      .single();

    if (insertSageError || !sageRow) {
      return NextResponse.json(
        { message: insertSageError?.message ?? "Failed to save Sage response." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      user_message: userRow as SageMessageRow,
      sage_message: sageRow as SageMessageRow,
    });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Sage request failed" },
      { status: 500 }
    );
  }
}

