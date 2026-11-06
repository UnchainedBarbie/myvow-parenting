import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { ensureConversationSession } from "@/lib/sage/process-inbox-item";

const SESSION_COLUMNS =
  "id, user_id, title, category, created_at, updated_at, flagged, archived, documented, documented_at, session_type, conversation_id";

type SessionRow = {
  id: string;
  user_id: string;
  title: string | null;
  category: string | null;
  created_at: string;
  updated_at: string;
  flagged: boolean;
  archived: boolean;
  documented: boolean;
  documented_at: string | null;
  session_type: "private" | "incident";
  conversation_id: string | null;
};

type Filter = "all" | "incident" | "flagged" | "documented" | "archived";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const filter = (searchParams.get("filter") ?? "all") as Filter;

    const admin = getServiceRoleClient();
    let q = admin
      .from("sage_sessions")
      .select(SESSION_COLUMNS)
      .eq("user_id", user.id);

    // Filters:
    // - Use archived != true so NULLs are included.
    // - Do NOT exclude rows based on session_type when filter === "all".
    if (filter === "archived") {
      q = q.eq("archived", true);
    } else if (filter === "incident") {
      q = q.eq("session_type", "incident").neq("archived", true);
    } else if (filter === "flagged") {
      q = q.eq("flagged", true).neq("archived", true);
    } else if (filter === "documented") {
      q = q.eq("documented", true).neq("archived", true);
    } else {
      // "All" – archived IS NOT TRUE (includes NULL and false in PostgREST semantics).
      q = q.neq("archived", true);
    }

    const { data, error } = await q.order("updated_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { message: error.message },
        { status: 500 }
      );
    }

    const rows = (data ?? []) as (SessionRow & {
      flagged?: boolean | null;
      archived?: boolean | null;
      documented?: boolean | null;
      session_type?: string | null;
    })[];

    // Coerce NULL booleans and missing session_type so legacy rows behave correctly.
    const sessions: SessionRow[] = rows.map((row) => ({
      ...row,
      flagged: !!row.flagged,
      archived: !!row.archived,
      documented: !!row.documented,
      documented_at: (row as any).documented_at ?? null,
      session_type:
        (row.session_type === "incident" ? "incident" : "private") as
          | "private"
          | "incident",
    }));

    return NextResponse.json({ sessions });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[sage/sessions] error:", e);
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Failed to load sessions" },
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

    const body = (await request.json().catch(() => ({}))) as {
      category?: string;
      session_type?: "private" | "incident";
      conversation_id?: string;
    };
    const now = new Date();
    const nowIso = now.toISOString();
    const defaultTitle = `Sage Session — ${now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

    const admin = getServiceRoleClient();
    const requestedConversationId =
      typeof body.conversation_id === "string" ? body.conversation_id.trim() : "";

    // A reply opens the parent's Sage chat for that conversation. The title is the
    // conversation's own title. An existing chat for the pair is reused, not retitled.
    if (requestedConversationId) {
      const { data: conversation, error: convError } = await admin
        .from("conversations")
        .select("id, case_id, subject")
        .eq("id", requestedConversationId)
        .maybeSingle();
      if (convError) {
        return NextResponse.json({ message: convError.message }, { status: 500 });
      }
      const conv = conversation as { id: string; case_id: string; subject: string | null } | null;
      if (!conv) {
        return NextResponse.json(
          { message: "That conversation is not on this case." },
          { status: 404 }
        );
      }
      const { data: member, error: memberError } = await admin
        .from("case_members")
        .select("user_id")
        .eq("case_id", conv.case_id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (memberError) {
        return NextResponse.json({ message: memberError.message }, { status: 500 });
      }
      if (!member) {
        return NextResponse.json(
          { message: "That conversation is not on this case." },
          { status: 404 }
        );
      }
      const title = (conv.subject ?? "").trim() || "(no subject)";
      const ensured = await ensureConversationSession(admin, {
        userId: user.id,
        conversationId: conv.id,
        title,
      });
      if (!ensured.id) {
        return NextResponse.json(
          { message: ensured.error ?? "Failed to open the reply." },
          { status: 500 }
        );
      }
      const { data: bound, error: boundError } = await admin
        .from("sage_sessions")
        .select(SESSION_COLUMNS)
        .eq("id", ensured.id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (boundError || !bound) {
        return NextResponse.json(
          { message: boundError?.message ?? "Failed to open the reply." },
          { status: 500 }
        );
      }
      return NextResponse.json({ session: bound as SessionRow });
    }

    const { data: row, error } = await admin
      .from("sage_sessions")
      .insert({
        user_id: user.id,
        title: defaultTitle,
        category: (body.category ?? null) as string | null,
        session_type: body.session_type ?? "private",
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select(SESSION_COLUMNS)
      .single();

    if (error || !row) {
      return NextResponse.json(
        { message: error?.message ?? "Failed to create session." },
        { status: 500 }
      );
    }

    return NextResponse.json({ session: row as SessionRow });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Failed to create session" },
      { status: 500 }
    );
  }
}
