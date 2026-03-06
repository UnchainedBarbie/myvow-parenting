import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { getKidSession } from "@/lib/kids-session";

type KidSageSessionRow = {
  id: string;
  kid_id: string;
  title: string | null;
  created_at: string;
  updated_at: string | null;
};

type KidSageMessageRow = {
  id: string;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
};

export async function GET(
  request: NextRequest,
  { params }: { params: { session_id: string } }
) {
  try {
    const session = await getKidSession(request);
    if (!session) {
      return NextResponse.json(
        { message: "Not logged in" },
        { status: 401 }
      );
    }

    const { session_id } = params;
    if (!session_id) {
      return NextResponse.json(
        { message: "Missing session_id" },
        { status: 400 }
      );
    }

    const admin = getServiceRoleClient();

    const { data: sessionRow, error: sessionError } = await admin
      .from("kid_sage_sessions")
      .select("id, kid_id, title, created_at, updated_at")
      .eq("id", session_id)
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

    const castSession = sessionRow as KidSageSessionRow;

    const { data: messages, error: messagesError } = await admin
      .from("kid_sage_messages")
      .select("id, session_id, role, content, created_at")
      .eq("session_id", castSession.id)
      .order("created_at", { ascending: true });

    if (messagesError) {
      return NextResponse.json(
        { message: messagesError.message ?? "Failed to load messages" },
        { status: 500 }
      );
    }

    const castMessages = (messages ?? []) as KidSageMessageRow[];

    return NextResponse.json({
      session: {
        id: castSession.id,
        title: castSession.title,
        created_at: castSession.created_at,
        updated_at: castSession.updated_at,
      },
      messages: castMessages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        created_at: m.created_at,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      {
        message:
          e instanceof Error
            ? e.message
            : "Failed to load Sage session",
      },
      { status: 500 }
    );
  }
}

