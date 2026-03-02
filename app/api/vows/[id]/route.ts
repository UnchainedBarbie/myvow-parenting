import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const id = params.id;
    if (!id) {
      return NextResponse.json(
        { message: "Missing vow id" },
        { status: 400 }
      );
    }

    const admin = getServiceRoleClient();

    const { data: vow, error: loadError } = await admin
      .from("vows")
      .select("id, case_id, user_id")
      .eq("id", id)
      .maybeSingle();

    if (loadError) {
      return NextResponse.json(
        { message: loadError.message },
        { status: 500 }
      );
    }
    if (!vow) {
      return NextResponse.json(
        { message: "Vow not found" },
        { status: 404 }
      );
    }
    if (vow.user_id !== user.id) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    const now = new Date().toISOString();

    const { error: updateError } = await admin
      .from("vows")
      .update({ deleted_at: now, is_pinned: false, updated_at: now })
      .eq("id", id);

    if (updateError) {
      return NextResponse.json(
        { message: updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Failed to delete vow" },
      { status: 500 }
    );
  }
}

