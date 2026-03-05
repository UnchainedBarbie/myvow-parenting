import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

const ALLOWED_TOPICS = new Set([
  "Medical",
  "School",
  "Schedule",
  "Expenses",
  "General",
  "Emergency",
]);

type ConversationRow = {
  id: string;
  case_id: string;
  subject: string;
  child_id: string | null;
  category: string | null;
  topic: string | null;
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
  is_emergency?: boolean | null;
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
    console.log("[conversations.GET] membership", {
      userId: user.id,
      membership,
      caseId,
    });
    if (!caseId) {
      return NextResponse.json({ conversations: [] });
    }

    const { data: conversationsRaw, error: convError } = await admin
      .from("conversations")
      .select(
        "id, case_id, subject, child_id, category, topic, created_at, updated_at, status"
      )
      .eq("case_id", caseId)
      .order("updated_at", { ascending: false });

    console.log("conversations query error:", convError);
    console.log("conversations data:", conversationsRaw);
    console.log("conversations count:", conversationsRaw?.length);

    console.log("[conversations.GET] conversations query result", {
      caseId,
      count: conversationsRaw?.length ?? 0,
      error: convError,
    });

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
        "id, conversation_id, original_content, ai_rewritten_content, direction, created_at, read_at, category, ai_classification, emotional_intensity_score, is_emergency"
      )
      .in("conversation_id", convIds);

    console.log("[conversations.GET] messages query result", {
      convIdsCount: convIds.length,
      msgCount: messagesRaw?.length ?? 0,
      error: msgError,
    });

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

    // Pins and conversation-level flags (private to user)
    const pinnedConversationIds = new Set<string>();
    const conversationFlaggedIds = new Set<string>();
    try {
      const { data: pins } = await admin
        .from("conversation_user_pins")
        .select("conversation_id")
        .eq("user_id", user.id)
        .in("conversation_id", convIds);
      if (pins) {
        for (const p of pins as { conversation_id: string }[]) {
          pinnedConversationIds.add(p.conversation_id);
        }
      }
    } catch {
      // table may not exist yet
    }
    try {
      const { data: convFlags } = await admin
        .from("conversation_user_flags")
        .select("conversation_id")
        .eq("user_id", user.id)
        .in("conversation_id", convIds);
      if (convFlags) {
        for (const f of convFlags as { conversation_id: string }[]) {
          conversationFlaggedIds.add(f.conversation_id);
        }
      }
    } catch {
      // table may not exist yet
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

      // Topic/category from DB (conversations_topic_check allows title case only)
      const rawTopicTag = (c.topic ?? c.category ?? "General").trim();
      const category: string = ALLOWED_TOPICS.has(rawTopicTag)
        ? rawTopicTag
        : "General";

      // Derive tone (calm / elevated) from AI classification / intensity
      let tone: "calm" | "elevated" = "calm";
      let hasEmergencyMessage = false;
      for (const m of list) {
        const cls = (m.ai_classification ?? "").toLowerCase();
        const intensity =
          typeof m.emotional_intensity_score === "number"
            ? Number(m.emotional_intensity_score)
            : 0;
        if (
          ["escalatory", "threatening", "coercive", "manipulative"].includes(cls) ||
          intensity >= 0.7
        ) {
          tone = "elevated";
        }
        if (m.is_emergency) {
          hasEmergencyMessage = true;
        }
        if (tone === "elevated" && hasEmergencyMessage) {
          break;
        }
      }

      const rawStatus = (c.status as string | null)?.toLowerCase().trim() ?? "open";
      // Treat legacy "resolved" as "archived" for UI purposes.
      const normalizedStatus =
        rawStatus === "archived" || rawStatus === "resolved" ? "archived" : "open";
      const status: "open" | "archived" = normalizedStatus === "archived" ? "archived" : "open";
      const topicTag = category;

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
        category: topicTag,
        message_count: list.length,
        has_flagged_by_me: flaggedByConversation.has(c.id),
        conversation_flagged_by_me: conversationFlaggedIds.has(c.id),
        pinned_by_me: pinnedConversationIds.has(c.id),
        status,
        tone,
        has_emergency: hasEmergencyMessage,
      };
    });

    // Pinned first, then by updated_at desc
    summaries.sort((a, b) => {
      const aPinned = (a as { pinned_by_me?: boolean }).pinned_by_me ?? false;
      const bPinned = (b as { pinned_by_me?: boolean }).pinned_by_me ?? false;
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      return (b.updated_at || "").localeCompare(a.updated_at || "");
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
    const { subject, child_id, category, topic } = body as {
      subject?: string;
      child_id?: string | null;
      category?: string | null;
      topic?: string | null;
    };

    const trimmedSubject = (subject ?? "").trim();
    if (!trimmedSubject) {
      return NextResponse.json(
        { error: "Subject is required" },
        { status: 400 }
      );
    }

    const topicValue = (topic ?? category ?? "").trim();
    if (!topicValue || !ALLOWED_TOPICS.has(topicValue)) {
      return NextResponse.json(
        {
          error:
            "Topic is required and must be one of: " +
            [...ALLOWED_TOPICS].join(", "),
        },
        { status: 400 }
      );
    }

    const { data, error } = await admin
      .from("conversations")
      .insert({
        case_id: caseId,
        subject: trimmedSubject,
        child_id: child_id || null,
        category: topicValue,
        topic: topicValue,
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

