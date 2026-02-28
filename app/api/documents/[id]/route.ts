import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/server";

const DESCRIPTION_MAX = 250;
const VISIBILITY_VALUES = ["family", "parents_only", "private", "family_read_only"] as const;

/**
 * PATCH /api/documents/[id] — update metadata (category, child_id, description, visibility).
 */
export async function PATCH(
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

    const body = await request.json();
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (body.category != null) updates.category = String(body.category);
    if (body.child_id !== undefined) updates.child_id = body.child_id === "" ? null : body.child_id;
    if (body.description != null) {
      const d = String(body.description).trim();
      if (d.length > DESCRIPTION_MAX) {
        return NextResponse.json({ message: `Description must be ${DESCRIPTION_MAX} characters or fewer.` }, { status: 400 });
      }
      updates.description = d;
    }
    if (body.visibility != null) {
      const v = String(body.visibility);
      if (!VISIBILITY_VALUES.includes(v as (typeof VISIBILITY_VALUES)[number])) {
        return NextResponse.json({ message: "Invalid visibility" }, { status: 400 });
      }
      updates.visibility = v;
    }

    const { error: updateErr } = await admin
      .from("documents")
      .update(updates)
      .eq("id", id);
    if (updateErr) return NextResponse.json({ message: updateErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Update failed" },
      { status: 500 }
    );
  }
}
