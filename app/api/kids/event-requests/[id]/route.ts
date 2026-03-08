import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { getKidSession } from "@/lib/kids-session";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PATCH /api/kids/event-requests/[id] — update a pending event request (kid session).
 * Body: { title?, requested_date?, requested_time?, notes?, photo_url? }
 * Only allowed if status = 'pending'.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await getKidSession(request);
    if (!session) {
      return NextResponse.json({ message: "Not logged in" }, { status: 401 });
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ message: "Missing request id" }, { status: 400 });
    }

    const child = session.child as { id?: string };
    const childId = child.id ?? null;
    if (!childId) {
      return NextResponse.json({ message: "No child found" }, { status: 400 });
    }

    const admin = getServiceRoleClient();
    const { data: existing, error: fetchError } = await admin
      .from("event_requests")
      .select("id, status, requested_by_child_id")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();

    if (fetchError || !existing) {
      return NextResponse.json({ message: "Request not found" }, { status: 404 });
    }
    if ((existing.requested_by_child_id as string) !== childId) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }
    if ((existing.status as string) !== "pending") {
      return NextResponse.json({ message: "Only pending requests can be updated" }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      title?: string;
      requested_date?: string;
      requested_time?: string;
      notes?: string;
      photo_url?: string;
      requested_parent?: string;
    };

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.title === "string") {
      const t = body.title.trim();
      if (t) updates.title = t;
    }
    if (typeof body.requested_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.requested_date.trim().slice(0, 10))) {
      updates.requested_date = body.requested_date.trim().slice(0, 10);
    }
    if (body.requested_time !== undefined) {
      updates.requested_time = body.requested_time != null && String(body.requested_time).trim() !== ""
        ? String(body.requested_time).trim().slice(0, 8)
        : null;
    }
    if (body.notes !== undefined) {
      updates.notes = body.notes != null && String(body.notes).trim() !== "" ? String(body.notes).trim() : null;
    }
    if (body.photo_url !== undefined) {
      updates.photo_url = body.photo_url != null && String(body.photo_url).trim() !== "" ? String(body.photo_url).trim() : null;
    }
    if (body.requested_parent === "user" || body.requested_parent === "coparent" || body.requested_parent === "either") {
      updates.requested_parent = body.requested_parent;
    }

    const { error: updateError } = await admin
      .from("event_requests")
      .update(updates)
      .eq("id", id);

    if (updateError) {
      return NextResponse.json({ message: updateError.message ?? "Failed to update" }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[kids/event-requests/[id] PATCH]", e);
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Failed to update request" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/kids/event-requests/[id] — soft delete a pending event request (kid session).
 * Sets deleted_at = now(). Only allowed if status = 'pending'.
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const session = await getKidSession(request);
    if (!session) {
      return NextResponse.json({ message: "Not logged in" }, { status: 401 });
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ message: "Missing request id" }, { status: 400 });
    }

    const child = session.child as { id?: string };
    const childId = child.id ?? null;
    if (!childId) {
      return NextResponse.json({ message: "No child found" }, { status: 400 });
    }

    const admin = getServiceRoleClient();
    const { data: existing, error: fetchError } = await admin
      .from("event_requests")
      .select("id, status, requested_by_child_id")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();

    if (fetchError || !existing) {
      return NextResponse.json({ message: "Request not found" }, { status: 404 });
    }
    if ((existing.requested_by_child_id as string) !== childId) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }
    if ((existing.status as string) !== "pending") {
      return NextResponse.json({ message: "Only pending requests can be cancelled" }, { status: 400 });
    }

    const { error: updateError } = await admin
      .from("event_requests")
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", id);

    if (updateError) {
      return NextResponse.json({ message: updateError.message ?? "Failed to delete" }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[kids/event-requests/[id] DELETE]", e);
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Failed to cancel request" },
      { status: 500 }
    );
  }
}
