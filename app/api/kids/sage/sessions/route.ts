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

export async function GET(request: NextRequest) {
  try {
    const session = await getKidSession(request);
    if (!session) {
      return NextResponse.json(
        { message: "Not logged in" },
        { status: 401 }
      );
    }

    const admin = getServiceRoleClient();
    const { data, error } = await admin
      .from("kid_sage_sessions")
      .select("id, kid_id, title, created_at, updated_at")
      .eq("kid_id", session.kid_id)
      .order("updated_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { message: error.message ?? "Failed to load sessions" },
        { status: 500 }
      );
    }

    const sessions = (data ?? []) as KidSageSessionRow[];

    return NextResponse.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        title: s.title,
        created_at: s.created_at,
        updated_at: s.updated_at,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      {
        message:
          e instanceof Error ? e.message : "Failed to load sessions",
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

    const body = (await request.json().catch(() => ({}))) as {
      title?: string;
    };

    const now = new Date();
    const nowIso = now.toISOString();
    const defaultTitle = `Sage session — ${now.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })}`;

    const rawTitle =
      typeof body.title === "string" && body.title.trim().length > 0
        ? body.title.trim()
        : defaultTitle;

    const admin = getServiceRoleClient();
    const { data, error } = await admin
      .from("kid_sage_sessions")
      .insert({
        kid_id: session.kid_id,
        title: rawTitle,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select("id, kid_id, title, created_at, updated_at")
      .single();

    if (error || !data) {
      return NextResponse.json(
        {
          message:
            error?.message ?? "Failed to create Sage session",
        },
        { status: 500 }
      );
    }

    const row = data as KidSageSessionRow;

    return NextResponse.json({
      session: {
        id: row.id,
        title: row.title,
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        message:
          e instanceof Error
            ? e.message
            : "Failed to create Sage session",
      },
      { status: 500 }
    );
  }
}

