import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

type SessionRow = {
  id: string;
  user_id: string;
  title: string | null;
  category: string | null;
  created_at: string;
  updated_at: string;
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
      .from("sage_sessions")
      .select("id, user_id, title, category, created_at, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });

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
    const now = new Date().toISOString();

    const admin = getServiceRoleClient();
    const { data: row, error } = await admin
      .from("sage_sessions")
      .insert({
        user_id: user.id,
        title: null,
        category: (category ?? null) as string | null,
        created_at: now,
        updated_at: now,
      })
      .select("id, user_id, title, category, created_at, updated_at")
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
