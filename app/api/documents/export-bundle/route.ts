import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/server";

/**
 * POST /api/documents/export-bundle — court-export PDF bundle (stub).
 * Body: { ids: string[] }. Returns 501 with message until implemented.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const ids = Array.isArray(body?.ids) ? body.ids as string[] : [];
    if (ids.length === 0) return NextResponse.json({ message: "No document ids provided" }, { status: 400 });

    const admin = getServiceRoleClient();
    const { data: docs } = await admin
      .from("documents")
      .select("id, case_id")
      .in("id", ids);
    const { data: membership } = await admin
      .from("case_members")
      .select("case_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (!membership) return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    const allowed = (docs ?? []).filter((d) => d.case_id === membership.case_id);
    if (allowed.length === 0) return NextResponse.json({ message: "No documents accessible" }, { status: 403 });

    return NextResponse.json(
      { message: "Court export bundle not yet implemented. Use Download for now.", stub: true },
      { status: 501 }
    );
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Export failed" },
      { status: 500 }
    );
  }
}
