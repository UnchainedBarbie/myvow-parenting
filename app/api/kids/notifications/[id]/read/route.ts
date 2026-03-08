import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { getKidSession } from "@/lib/kids-session";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PATCH /api/kids/notifications/[id]/read — mark a notification (resolved event request) as read.
 * Only the requesting child can mark their own notification as read.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await getKidSession(request);
    if (!session) {
      return NextResponse.json({ message: "Not logged in" }, { status: 401 });
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ message: "Missing notification id" }, { status: 400 });
    }

    const child = session.child as { id?: string };
    const childId = child.id ?? null;
    if (!childId) {
      return NextResponse.json({ message: "No child found" }, { status: 400 });
    }

    const admin = getServiceRoleClient();
    const { data: existing, error: fetchError } = await admin
      .from("event_requests")
      .select("id, requested_by_child_id, status")
      .eq("id", id)
      .in("status", ["approved", "declined"])
      .maybeSingle();

    if (fetchError || !existing) {
      return NextResponse.json({ message: "Notification not found" }, { status: 404 });
    }
    if ((existing.requested_by_child_id as string) !== childId) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    const { error: updateError } = await admin
      .from("event_requests")
      .update({ notification_read: true, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (updateError) {
      return NextResponse.json({ message: updateError.message ?? "Failed to mark as read" }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[kids/notifications/[id]/read PATCH]", e);
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Failed to update" },
      { status: 500 }
    );
  }
}
