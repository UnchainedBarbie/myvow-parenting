import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

export async function GET(
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
      .single();
    if (fetchError || !row) {
      return NextResponse.json({ message: "Export not found" }, { status: 404 });
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
    const { data: file, error: downloadError } = await admin.storage
      .from("reports")
      .download(row.file_path);
    if (downloadError || !file) {
      return NextResponse.json(
        { message: downloadError?.message || "File not found" },
        { status: 404 }
      );
    }
    return new NextResponse(file, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="export-${exportId}.pdf"`,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Download failed" },
      { status: 500 }
    );
  }
}
