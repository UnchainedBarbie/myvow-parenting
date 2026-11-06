import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { shapeTopicTitle } from "@/lib/sage/topic-title";

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
      .select("id, user_id, title, conversation_id")
      .eq("id", sessionId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (sessionError || !session) {
      return NextResponse.json(
        { message: "Session not found." },
        { status: 404 }
      );
    }

    // A reply chat already carries the conversation's title. Leave that title alone.
    const boundId = (session as { conversation_id?: string | null }).conversation_id;
    if (typeof boundId === "string" && boundId.trim()) {
      return NextResponse.json({
        title: (session as { title?: string | null }).title ?? "",
      });
    }

    const names = await namesOnCase(admin, user.id);
    let title = shapeTopicTitle(trimmed, names);
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      try {
        const people = names.length > 0 ? names.join(", ") : "none listed";
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 30,
            messages: [
              {
                role: "user",
                content: `Name this as a topic label of two to four words, like "Saturday pickup" or "Choir concert". Sentence case. No quotes. No punctuation. Do not use request, reminder, inquiry, or confirmation. Do not include a person's name unless that person is the subject. People who are not the subject: ${people}. Message: ${trimmed}`,
              },
            ],
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as {
            content?: Array<{ type: string; text?: string }>;
          };
          const text = data.content?.find((c) => c.type === "text")?.text?.trim();
          const shaped = text ? shapeTopicTitle(text, names) : "";
          if (shaped) title = shaped;
        }
      } catch {
        // Keep the label shaped from the message itself.
      }
    }
    if (!title) title = "Message";

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

/** First names on this parent's case. Used only to keep those names out of a topic label. */
async function namesOnCase(
  admin: ReturnType<typeof getServiceRoleClient>,
  userId: string
): Promise<string[]> {
  const { data: membership } = await admin
    .from("case_members")
    .select("case_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  const caseId = (membership as { case_id?: string } | null)?.case_id;
  if (!caseId) return [];

  const names = new Set<string>();
  const { data: children } = await admin
    .from("children")
    .select("first_name")
    .eq("case_id", caseId)
    .is("deleted_at", null);
  for (const child of children ?? []) {
    const name = ((child as { first_name?: string | null }).first_name ?? "").trim();
    if (name) names.add(name);
  }

  const { data: members } = await admin
    .from("case_members")
    .select("user_id, display_name")
    .eq("case_id", caseId);
  const otherIds = (members ?? [])
    .map((member) => member as { user_id?: string | null; display_name?: string | null })
    .filter((member) => member.user_id && member.user_id !== userId);
  for (const member of otherIds) {
    const display = (member.display_name ?? "").trim().split(/\s+/)[0] ?? "";
    if (display) names.add(display);
  }
  const { data: users } = otherIds.length
    ? await admin
        .from("users")
        .select("full_name")
        .in(
          "id",
          otherIds.map((member) => member.user_id).filter((id): id is string => !!id)
        )
    : { data: [] };
  for (const person of users ?? []) {
    const first = ((person as { full_name?: string | null }).full_name ?? "").trim().split(/\s+/)[0] ?? "";
    if (first) names.add(first);
  }
  return [...names];
}
