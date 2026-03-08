import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/server";

/**
 * GET /api/event-requests — list pending event requests for the current user's case. Parent auth.
 * Only returns requests directed to this parent: requested_parent = 'user' for primary, 'coparent' for co-parent, 'either' for both.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const admin = getServiceRoleClient();
    const { data: membership } = await admin
      .from("case_members")
      .select("case_id, is_primary")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (!membership?.case_id) return NextResponse.json({ requests: [] });

    const isPrimary = membership.is_primary === true;
    const { data: rows, error } = await admin
      .from("event_requests")
      .select("id, requested_by_child_id, requested_date, requested_time, title, notes, photo_url, status, created_at, requested_parent")
      .eq("case_id", membership.case_id)
      .eq("status", "pending")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const rawRows = (rows ?? []).filter((r) => {
      const rp = (r as { requested_parent?: string | null }).requested_parent ?? "either";
      if (rp === "either") return true;
      if (rp === "user") return isPrimary;
      if (rp === "coparent") return !isPrimary;
      return true;
    });
    const childIds = [...new Set(rawRows.map((x) => x.requested_by_child_id).filter(Boolean))] as string[];
    let childNameById = new Map<string, string>();
    if (childIds.length > 0) {
      const { data: childrenRows } = await admin
        .from("children")
        .select("id, first_name")
        .in("id", childIds);
      childNameById = new Map((childrenRows ?? []).map((c) => [c.id, c.first_name]));
    }
    const requests = rawRows.map((r) => ({
      id: r.id,
      requested_by_child_id: r.requested_by_child_id,
      requested_date: r.requested_date,
      requested_time: r.requested_time,
      title: r.title,
      notes: r.notes,
      photo_url: (r as { photo_url?: string | null }).photo_url ?? null,
      status: r.status,
      created_at: r.created_at,
      child_name: r.requested_by_child_id ? childNameById.get(r.requested_by_child_id as string) ?? null : null,
    }));
    return NextResponse.json({ requests });
  } catch (e) {
    console.error("[event-requests GET]", e);
    return NextResponse.json({ error: "Failed to load requests" }, { status: 500 });
  }
}
