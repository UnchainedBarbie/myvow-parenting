import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ message: "Session ID required" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const { flagged, archived, documented, title } = body as {
      flagged?: boolean;
      archived?: boolean;
      documented?: boolean;
      title?: string;
    };

    const updates: {
      flagged?: boolean;
      archived?: boolean;
      documented?: boolean;
      documented_at?: string | null;
      title?: string | null;
      updated_at?: string;
    } = {};
    if (typeof flagged === "boolean") updates.flagged = flagged;
    if (typeof archived === "boolean") updates.archived = archived;
    if (typeof documented === "boolean") {
      updates.documented = documented;
      updates.documented_at = documented ? new Date().toISOString() : null;
    }
    if (typeof title === "string") {
      const trimmed = title.trim();
      if (trimmed.length > 0) {
        updates.title = trimmed;
      }
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ message: "No updates provided" }, { status: 400 });
    }
    updates.updated_at = new Date().toISOString();

    const admin = getServiceRoleClient();
    const { data, error } = await admin
      .from("sage_sessions")
      .update(updates)
      .eq("id", id)
      .eq("user_id", user.id)
      .select(
        "id, user_id, title, category, created_at, updated_at, flagged, archived, documented, documented_at"
      )
      .single();

    if (error) {
      return NextResponse.json(
        { message: error.message },
        { status: error.code === "PGRST116" ? 404 : 500 }
      );
    }

    return NextResponse.json({ session: data });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Failed to update session" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ message: "Session ID required" }, { status: 400 });
    }

    const admin = getServiceRoleClient();
    const { error } = await admin
      .from("sage_sessions")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);

    if (error) {
      return NextResponse.json(
        { message: error.message },
        { status: error.code === "PGRST116" ? 404 : 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Failed to delete session" },
      { status: 500 }
    );
  }
}
