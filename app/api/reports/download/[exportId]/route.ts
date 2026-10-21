import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

export async function GET(
  request: NextRequest,
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
    const bundle = request.nextUrl.searchParams.get("bundle") === "1";
    const inline = request.nextUrl.searchParams.get("inline") === "1";
    const filePath = bundle
      ? `exports/${row.case_id}/${exportId}-bundle.zip`
      : row.file_path;
    const { data: file, error: downloadError } = await admin.storage
      .from("reports")
      .download(filePath);
    if (downloadError || !file) {
      return NextResponse.json(
        { message: downloadError?.message || "File not found" },
        { status: 404 }
      );
    }
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "pdf";
    const contentType =
      ext === "csv"
        ? "text/csv"
        : ext === "zip"
          ? "application/zip"
          : ext === "xlsx"
            ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            : "application/pdf";
    const filename = bundle ? `omitted-files-${exportId}.zip` : `export-${exportId}.${ext}`;
    const disposition = inline && contentType === "application/pdf" ? "inline" : "attachment";
    return new NextResponse(file, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `${disposition}; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Download failed" },
      { status: 500 }
    );
  }
}
