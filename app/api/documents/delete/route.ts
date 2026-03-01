import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/server";

/**
 * POST /api/documents/delete — soft delete documents by ID (set deleted_at).
 * Body: { ids: string[] }
 * Only deletes documents in the authenticated user's case.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const ids = Array.isArray(body.ids) ? (body.ids as string[]).filter((id) => typeof id === "string") : [];
    if (ids.length === 0) {
      return NextResponse.json({ error: "No document IDs provided" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const admin = getServiceRoleClient();
    const { data: membership } = await admin
      .from("case_members")
      .select("case_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { error } = await admin
      .from("documents")
      .update({ deleted_at: new Date().toISOString() })
      .in("id", ids)
      .eq("case_id", membership.case_id);

    if (error) {
      console.error("[delete-documents] Supabase error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[delete-documents] Error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
