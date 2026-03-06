import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { getKidSession } from "@/lib/kids-session";
import { moderateFamilyMessage } from "@/lib/family-message-moderation";

type FamilyThreadRow = {
  id: string;
  case_id: string;
  thread_type: string;
  created_at: string;
};

type FamilyMessageRow = {
  id: string;
  thread_id: string;
  content: string;
  moderation_status: string;
  blocked_reason: string | null;
  created_at: string;
};

const THREAD_TYPES = [
  "mom",
  "dad",
  "both_parents",
  "siblings",
  "family",
] as const;

type ThreadType = (typeof THREAD_TYPES)[number];

export async function GET(request: NextRequest) {
  try {
    const session = await getKidSession(request);
    if (!session) {
      return NextResponse.json(
        { message: "Not logged in" },
        { status: 401 }
      );
    }

    const child = session.child as { case_id?: string | null };
    const caseId = child.case_id ?? null;

    if (!caseId) {
      return NextResponse.json(
        { message: "No family case found" },
        { status: 400 }
      );
    }

    const admin = getServiceRoleClient();

    const { data: threads, error: threadError } = await admin
      .from("family_threads")
      .select("id, case_id, thread_type, created_at")
      .eq("case_id", caseId)
      .order("created_at", { ascending: true });

    if (threadError) {
      return NextResponse.json(
        { message: threadError.message ?? "Failed to load threads" },
        { status: 500 }
      );
    }

    const castThreads = (threads ?? []) as FamilyThreadRow[];

    if (castThreads.length === 0) {
      return NextResponse.json({ threads: [] });
    }

    const threadIds = castThreads.map((t) => t.id);
    const { data: messages, error: msgError } = await admin
      .from("family_messages")
      .select("id, thread_id, content, moderation_status, blocked_reason, created_at")
      .in("thread_id", threadIds)
      .order("created_at", { ascending: false });

    if (msgError) {
      return NextResponse.json(
        { message: msgError.message ?? "Failed to load messages" },
        { status: 500 }
      );
    }

    const castMessages = (messages ?? []) as (FamilyMessageRow & {
      blocked_reason?: string | null;
    })[];

    const lastByThread: Record<
      string,
      {
        id: string;
        content: string;
        created_at: string;
        moderation_status: string;
        blocked_reason: string | null;
      }
    > = {};

    for (const msg of castMessages) {
      if (!lastByThread[msg.thread_id]) {
        lastByThread[msg.thread_id] = {
          id: msg.id,
          content: msg.content,
          created_at: msg.created_at,
          moderation_status: msg.moderation_status,
          blocked_reason: msg.blocked_reason ?? null,
        };
      }
    }

    const result = castThreads.map((t) => ({
      id: t.id,
      thread_type: t.thread_type as ThreadType,
      created_at: t.created_at,
      last_message: lastByThread[t.id] ?? null,
    }));

    return NextResponse.json({ threads: result });
  } catch (e) {
    return NextResponse.json(
      {
        message:
          e instanceof Error
            ? e.message
            : "Failed to load family message threads",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getKidSession(request);
    if (!session) {
      return NextResponse.json(
        { message: "Not logged in" },
        { status: 401 }
      );
    }

    const child = session.child as { case_id?: string | null };
    const caseId = child.case_id ?? null;

    if (!caseId) {
      return NextResponse.json(
        { message: "No family case found" },
        { status: 400 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      thread_id?: string;
      thread_type?: string;
      content?: string;
    };

    const rawContent = typeof body.content === "string" ? body.content : "";
    const content = rawContent.trim();

    if (!content) {
      return NextResponse.json(
        { message: "Message content is required" },
        { status: 400 }
      );
    }

    const admin = getServiceRoleClient();

    let threadId = body.thread_id ?? null;

    if (threadId) {
      const { data: threadRow, error: threadError } = await admin
        .from("family_threads")
        .select("id, case_id, thread_type")
        .eq("id", threadId)
        .maybeSingle();

      if (threadError) {
        return NextResponse.json(
          { message: threadError.message ?? "Failed to load thread" },
          { status: 500 }
        );
      }

      if (!threadRow || threadRow.case_id !== caseId) {
        return NextResponse.json(
          { message: "Thread not found" },
          { status: 404 }
        );
      }
    } else {
      const rawType = body.thread_type;
      const normalizedType =
        typeof rawType === "string" ? rawType.trim() : "";
      const isValidType = THREAD_TYPES.includes(
        normalizedType as ThreadType
      );

      if (!isValidType) {
        return NextResponse.json(
          { message: "Invalid or missing thread_type" },
          { status: 400 }
        );
      }

      const threadType = normalizedType as ThreadType;

      const { data: existing } = await admin
        .from("family_threads")
        .select("id, case_id, thread_type")
        .eq("case_id", caseId)
        .eq("thread_type", threadType)
        .maybeSingle();

      if (existing) {
        threadId = existing.id as string;
      } else {
        const { data: inserted, error: insertThreadError } = await admin
          .from("family_threads")
          .insert({
            case_id: caseId,
            thread_type: threadType,
          })
          .select("id")
          .single();

        if (insertThreadError || !inserted) {
          return NextResponse.json(
            {
              message:
                insertThreadError?.message ??
                "Failed to create family thread",
            },
            { status: 500 }
          );
        }

        threadId = inserted.id as string;
      }
    }

    if (!threadId) {
      return NextResponse.json(
        { message: "Unable to resolve thread" },
        { status: 500 }
      );
    }

    const moderation = await moderateFamilyMessage(content, "kid");

    const { data: messageRow, error: insertMessageError } = await admin
      .from("family_messages")
      .insert({
        thread_id: threadId,
        sender_kid_id: session.kid_id,
        sender_parent_id: null,
        content,
        moderation_status: moderation.approved ? "approved" : "blocked",
        blocked_reason: moderation.approved ? null : moderation.reason ?? null,
      })
      .select("id, content, moderation_status, blocked_reason, created_at")
      .single();

    if (insertMessageError || !messageRow) {
      return NextResponse.json(
        {
          message:
            insertMessageError?.message ??
            "Failed to send family message",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      id: messageRow.id as string,
      thread_id: threadId,
      content: messageRow.content as string,
      moderation_status: messageRow.moderation_status as string,
      blocked_reason:
        (messageRow as { blocked_reason?: string | null }).blocked_reason ??
        null,
      created_at: messageRow.created_at as string,
      approved: moderation.approved,
      moderation_reason: moderation.reason ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      {
        message:
          e instanceof Error
            ? e.message
            : "Failed to send family message",
      },
      { status: 500 }
    );
  }
}

