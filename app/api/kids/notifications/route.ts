import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { getKidSession } from "@/lib/kids-session";

type NotificationRow = {
  id: string;
  title: string;
  status: string;
  updated_at: string;
};

/**
 * GET /api/kids/notifications — list unread resolved (approved/declined) event requests for the current child.
 * Used for the in-app notification panel. Does not filter by deleted_at so declined requests (which set deleted_at) are included.
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
      .select("id, title, status, updated_at")
      .eq("requested_by_child_id", childId)
      .in("status", ["approved", "declined"])
      .eq("notification_read", false)
      .order("updated_at", { ascending: false });

    if (error) {
      return NextResponse.json({ message: error.message ?? "Failed to load notifications" }, { status: 500 });
    }

    const notifications: NotificationRow[] = (rows ?? []).map((r) => ({
      id: r.id as string,
      title: r.title as string,
      status: r.status as string,
      updated_at: r.updated_at as string,
    }));

    return NextResponse.json(notifications);
  } catch (e) {
    console.error("[kids/notifications GET]", e);
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Failed to load notifications" },
      { status: 500 }
    );
  }
}
