import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { getKidSession } from "@/lib/kids-session";

type EventRequestRow = {
  id: string;
  title: string;
  requested_date: string;
  requested_time: string | null;
  notes: string | null;
  photo_url: string | null;
  status: string;
  created_at: string;
};

/**
 * GET /api/kids/event-requests — list event requests for the current child (kid session).
 * Returns requests ordered by created_at DESC.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getKidSession(request);
    if (!session) {
      return NextResponse.json({ message: "Not logged in" }, { status: 401 });
    }

    const child = session.child as { id?: string };
    const childId = child.id ?? null;
    if (!childId) {
      return NextResponse.json({ message: "No child found" }, { status: 400 });
    }

    const admin = getServiceRoleClient();
    const { data: rows, error } = await admin
      .from("event_requests")
      .select("id, title, requested_date, requested_time, notes, photo_url, status, created_at")
      .eq("requested_by_child_id", childId)
      .eq("status", "pending")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ message: error.message ?? "Failed to load requests" }, { status: 500 });
    }

    const requests: EventRequestRow[] = (rows ?? []).map((r) => ({
      id: r.id as string,
      title: r.title as string,
      requested_date: r.requested_date as string,
      requested_time: (r.requested_time as string | null) ?? null,
      notes: (r.notes as string | null) ?? null,
      photo_url: (r.photo_url as string | null) ?? null,
      status: (r.status as string) ?? "pending",
      created_at: r.created_at as string,
    }));

    return NextResponse.json(requests);
  } catch (e) {
    console.error("[kids/event-requests GET]", e);
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Failed to load requests" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/kids/event-requests — create an event request (kid session).
 * Body: { requested_date: string (YYYY-MM-DD), title: string, requested_time?: string, notes?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getKidSession(request);
    if (!session) {
      return NextResponse.json({ message: "Not logged in" }, { status: 401 });
    }

    const child = session.child as { id?: string; case_id?: string | null };
    const childId = child.id ?? null;
    const caseId = child.case_id ?? null;
    if (!caseId) {
      return NextResponse.json({ message: "No family case found" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({})) as {
      requested_date?: string;
      title?: string;
      requested_time?: string;
      notes?: string;
      photo_url?: string;
      requested_parent?: string;
    };
    const requested_date = typeof body.requested_date === "string" ? body.requested_date.trim().slice(0, 10) : null;
    const title = typeof body.title === "string" ? body.title.trim() : null;
    if (!requested_date || !title || !/^\d{4}-\d{2}-\d{2}$/.test(requested_date)) {
      return NextResponse.json({ message: "requested_date (YYYY-MM-DD) and title are required" }, { status: 400 });
    }

    const requested_time =
      body.requested_time != null && body.requested_time !== ""
        ? String(body.requested_time).trim().slice(0, 8)
        : null;
    const notes = body.notes != null && body.notes !== "" ? String(body.notes).trim() : null;
    const photo_url = body.photo_url != null && body.photo_url !== "" ? String(body.photo_url).trim() : null;
    const requested_parent =
      body.requested_parent === "user" || body.requested_parent === "coparent" || body.requested_parent === "either"
        ? body.requested_parent
        : "either";

    const admin = getServiceRoleClient();
    const { error } = await admin.from("event_requests").insert({
      case_id: caseId,
      requested_by_child_id: childId,
      requested_date,
      requested_time: requested_time ?? null,
      title,
      notes,
      photo_url,
      requested_parent,
      visibility: "just_me_and_kids",
      status: "pending",
    });
    if (error) {
      return NextResponse.json({ message: error.message ?? "Failed to create request" }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[kids/event-requests POST]", e);
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Failed to send request" },
      { status: 500 }
    );
  }
}
