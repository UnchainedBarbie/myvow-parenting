import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

type ConversationRow = {
  id: string;
  case_id: string;
  subject: string;
  child_id: string | null;
  category: string | null;
  created_at: string;
  updated_at: string;
  status?: string | null;
};

type MessageRow = {
  id: string;
  conversation_id: string | null;
  original_content: string;
  ai_rewritten_content: string | null;
  direction: "incoming" | "outgoing";
  created_at: string;
  read_at: string | null;
  category: string | null;
  ai_classification: string | null;
  emotional_intensity_score: number | null;
};

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = getServiceRoleClient();

    const { data: membership } = await admin
      .from("case_members")
      .select("case_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    const caseId = membership?.case_id as string | null;
    if (!caseId) {
      return NextResponse.json({ conversations: [] });
    }

    const { data: conversationsRaw, error: convError } = await admin
      .from("conversations")
      .select("id, case_id, subject, child_id, category, created_at, updated_at, status")
      .eq("case_id", caseId)
      .order("updated_at", { ascending: false });

    if (convError) {
      return NextResponse.json(
        { error: convError.message },
        { status: 500 }
      );
    }

    const conversations = (conversationsRaw ?? []) as ConversationRow[];
    if (conversations.length === 0) {
      return NextResponse.json({ conversations: [] });
    }

    const convIds = conversations.map((c) => c.id);

    const { data: messagesRaw, error: msgError } = await admin
      .from("messages")
      .select(
        "id, conversation_id, original_content, ai_rewritten_content, direction, created_at, read_at, category, ai_classification, emotional_intensity_score"
      )
      .in("conversation_id", convIds);

    if (msgError) {
      return NextResponse.json(
        { error: msgError.message },
        { status: 500 }
      );
    }

    const messages = (messagesRaw ?? []) as MessageRow[];

    const byConversation: Record<string, MessageRow[]> = {};
    for (const m of messages) {
      const cid = m.conversation_id;
      if (!cid) continue;
      if (!byConversation[cid]) byConversation[cid] = [];
      byConversation[cid].push(m);
    }

    // Determine which conversations have messages flagged by the current user
    const messageIds = messages.map((m) => m.id);
    const flaggedByConversation = new Set<string>();
    if (messageIds.length > 0) {
      const { data: flags } = await admin
        .from("message_user_flags")
        .select("message_id")
        .eq("user_id", user.id)
        .in("message_id", messageIds);

      if (flags && flags.length > 0) {
        const flaggedIds = new Set<string>(
          flags.map((f: { message_id: string }) => f.message_id)
        );
        for (const m of messages) {
          if (flaggedIds.has(m.id) && m.conversation_id) {
            flaggedByConversation.add(m.conversation_id);
          }
        }
      }
    }

    const summaries = conversations.map((c) => {
      const list = (byConversation[c.id] ?? []).slice().sort((a, b) =>
        a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0
      );
      const last = list[list.length - 1] ?? null;
      const unreadCount = list.filter(
        (m) => m.direction === "incoming" && m.read_at == null
      ).length;
      const lastPreview = last
        ? (last.ai_rewritten_content ?? last.original_content ?? "")
        : "";

      // User-selected topic at conversation level (fallback to general)
      const rawCategory = (c.category ?? "").toLowerCase().trim();
      const allowed = new Set([
        "medical",
        "schedule",
        "school",
        "expense",
        "therapy",
        "behavior",
        "general",
      ]);
      const category: string = allowed.has(rawCategory) ? rawCategory : "general";

      // Derive tone (calm / elevated) from AI classification / intensity
      let tone: "calm" | "elevated" = "calm";
      for (const m of list) {
        const cls = (m.ai_classification ?? "").toLowerCase();
        const intensity = typeof m.emotional_intensity_score === "number" ? Number(m.emotional_intensity_score) : 0;
        if (
          ["escalatory", "threatening", "coercive", "manipulative"].includes(cls) ||
          intensity >= 0.7
        ) {
          tone = "elevated";
          break;
        }
      }

      const rawStatus = (c.status as string | null)?.toLowerCase().trim() ?? "open";
      // Treat legacy "resolved" as "archived" for UI purposes.
      const normalizedStatus =
        rawStatus === "archived" || rawStatus === "resolved" ? "archived" : "open";
      const status: "open" | "archived" = normalizedStatus === "archived" ? "archived" : "open";

      return {
        id: c.id,
        case_id: c.case_id,
        subject: c.subject,
        child_id: c.child_id,
        created_at: c.created_at,
        updated_at: c.updated_at,
        last_message_preview: lastPreview,
        last_message_created_at: last?.created_at ?? null,
        unread_count: unreadCount,
        category,
        message_count: list.length,
        has_flagged_by_me: flaggedByConversation.has(c.id),
        status,
        tone,
      };
    });

    return NextResponse.json({ conversations: summaries });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load conversations" },
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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = getServiceRoleClient();

    const {
      data: membership,
      error: membershipError,
    } = await admin
      .from("case_members")
      .select("case_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (membershipError) {
      return NextResponse.json(
        { error: membershipError.message },
        { status: 500 }
      );
    }

    const caseId = membership?.case_id as string | null;
    if (!caseId) {
      return NextResponse.json(
        { error: "No active case" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { subject, child_id, category } = body as {
      subject?: string;
      child_id?: string | null;
      category?: string | null;
    };

    const trimmedSubject = (subject ?? "").trim();
    if (!trimmedSubject) {
      return NextResponse.json(
        { error: "Subject is required" },
        { status: 400 }
      );
    }

    const rawCategory = (category ?? "").toLowerCase().trim();
    const allowedCategories = new Set([
      "medical",
      "schedule",
      "school",
      "expense",
      "therapy",
      "behavior",
      "general",
    ]);
    if (!allowedCategories.has(rawCategory)) {
      return NextResponse.json(
        { error: "Topic is required" },
        { status: 400 }
      );
    }

    const { data, error } = await admin
      .from("conversations")
      .insert({
        case_id: caseId,
        subject: trimmedSubject,
        child_id: child_id || null,
        category: rawCategory,
        created_by: user.id,
      })
      .select("id, case_id, subject, child_id, created_at, updated_at")
      .single();

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ conversation: data });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to create conversation" },
      { status: 500 }
    );
  }
}

