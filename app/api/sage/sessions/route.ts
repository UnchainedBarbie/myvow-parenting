import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

type SessionRow = {
  id: string;
  user_id: string;
  title: string | null;
  category: string | null;
  created_at: string;
  updated_at: string;
  flagged: boolean;
  archived: boolean;
};

type Filter = "all" | "flagged" | "documented" | "archived";

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
      .select(
        "id, user_id, title, category, created_at, updated_at, flagged, archived, documented, documented_at"
      )
      .eq("user_id", user.id);

    if (filter === "archived") {
      q = q.eq("archived", true);
    } else if (filter === "flagged") {
      q = q.eq("flagged", true).eq("archived", false);
    } else if (filter === "documented") {
      q = q.eq("documented", true).eq("archived", false);
    } else {
      q = q.eq("archived", false);
    }

    const { data, error } = await q.order("updated_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { message: error.message },
        { status: 500 }
      );
    }

    const sessions = (data ?? []) as SessionRow[];
    return NextResponse.json({ sessions });
  } catch (e) {
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

    const body = await request.json().catch(() => ({}));
    const { category } = body as { category?: string };
    const now = new Date();
    const nowIso = now.toISOString();
    const defaultTitle = `Sage Session — ${now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

    const admin = getServiceRoleClient();
    const { data: row, error } = await admin
      .from("sage_sessions")
      .insert({
        user_id: user.id,
        title: defaultTitle,
        category: (category ?? null) as string | null,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select(
        "id, user_id, title, category, created_at, updated_at, flagged, archived, documented, documented_at"
      )
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
