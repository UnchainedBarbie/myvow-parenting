import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ exportId: string }> }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { exportId } = await params;
    const admin = getServiceRoleClient();

    const { data: row, error: fetchError } = await admin
      .from("court_exports")
      .select("case_id, file_path")
      .eq("id", exportId)
      .maybeSingle();

    if (fetchError || !row) {
      return NextResponse.json({ message: "Report not found" }, { status: 404 });
    }

    const { data: membership } = await admin
      .from("case_members")
      .select("case_id")
      .eq("case_id", row.case_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    if (row.file_path) {
      // Best-effort delete of underlying file; ignore if it fails.
      await admin.storage.from("reports").remove([row.file_path as string]);
    }

    const { error: deleteError } = await admin
      .from("court_exports")
      .delete()
      .eq("id", exportId);

    if (deleteError) {
      return NextResponse.json(
        { message: deleteError.message ?? "Failed to delete report" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Delete failed" },
      { status: 500 }
    );
  }
}

