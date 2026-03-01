import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/server";

/**
 * GET /api/documents/[id]/history — fetch edit history for a document (case members only).
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    const { id } = await context.params;
    if (!id) return NextResponse.json({ message: "Missing document id" }, { status: 400 });

    const admin = getServiceRoleClient();
    const { data: doc, error: docErr } = await admin
      .from("documents")
      .select("id, case_id")
      .eq("id", id)
      .single();
    if (docErr || !doc) return NextResponse.json({ message: "Document not found" }, { status: 404 });

    const { data: membership } = await admin
      .from("case_members")
      .select("case_id")
      .eq("case_id", doc.case_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!membership) return NextResponse.json({ message: "Forbidden" }, { status: 403 });

    const { data: rows, error } = await admin
      .from("document_history")
      .select("id, document_id, field_changed, old_value, new_value, changed_by, created_at")
      .eq("document_id", id)
      .order("created_at", { ascending: true });

    if (error) {
      const err = error as { code?: string };
      if (err.code === "42P01") return NextResponse.json([], { status: 200 });
      return NextResponse.json({ message: error.message ?? "Failed to load history" }, { status: 500 });
    }

    const userIds = [...new Set((rows ?? []).map((r) => r.changed_by).filter(Boolean))] as string[];
    let nameMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: userRows } = await admin
        .from("users")
        .select("id, full_name")
        .in("id", userIds);
      nameMap = (userRows ?? []).reduce(
        (acc, u) => {
          acc[u.id] = u.full_name;
          return acc;
        },
        {} as Record<string, string>
      );
    }

    const payload = (rows ?? []).map((r) => ({
      id: r.id,
      field_changed: r.field_changed,
      old_value: r.old_value ?? null,
      new_value: r.new_value ?? null,
      changed_by_name: nameMap[r.changed_by] ?? null,
      created_at: r.created_at,
    }));

    return NextResponse.json(payload, { status: 200 });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Failed to load document history" },
      { status: 500 }
    );
  }
}
