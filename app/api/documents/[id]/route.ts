import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/server";

const TITLE_MAX = 120;
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
    const { history: historyEntries, ...rest } = body;
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (rest.title != null) {
      const t = String(rest.title).trim();
      if (t.length > TITLE_MAX) {
        return NextResponse.json({ message: `Title must be ${TITLE_MAX} characters or fewer.` }, { status: 400 });
      }
      updates.title = t;
    }
    if (rest.category != null) updates.category = String(rest.category);
    if (rest.child_id !== undefined) updates.child_id = rest.child_id === "" ? null : rest.child_id;
    if (rest.description != null) {
      const d = String(rest.description).trim();
      if (d.length > DESCRIPTION_MAX) {
        return NextResponse.json({ message: `Description must be ${DESCRIPTION_MAX} characters or fewer.` }, { status: 400 });
      }
      updates.description = d;
    }
    if (rest.visibility != null) {
      const v = String(rest.visibility);
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

    if (Array.isArray(historyEntries) && historyEntries.length > 0) {
      const rows = historyEntries.map((h: { field_changed: string; old_value?: string | null; new_value?: string | null }) => ({
        document_id: id,
        changed_by: user.id,
        field_changed: h.field_changed,
        old_value: h.old_value ?? null,
        new_value: h.new_value ?? null,
      }));
      const { error: historyErr } = await admin.from("document_history").insert(rows);
      if (historyErr) {
        // Non-fatal: document was updated
        console.warn("[documents PATCH] document_history insert failed:", historyErr.message);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Update failed" },
      { status: 500 }
    );
  }
}
