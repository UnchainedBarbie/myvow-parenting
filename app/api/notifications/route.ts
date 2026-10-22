import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { calendarNoticeLink, readCalendarEventRef } from "@/lib/calendar/coparent-notice";

type ParentNotificationRow = {
  id: string;
  type: string;
  title: string;
  message: string;
  priority: "normal" | "high" | "urgent";
  read: boolean;
  created_at: string;
};

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { message: "Unauthorized" },
        { status: 401 }
      );
    }

    const admin = getServiceRoleClient();
    const { data, error } = await admin
      .from("parent_notifications")
      .select("id, type, title, message, priority, read, created_at")
      .eq("user_id", user.id)
      .order("read", { ascending: true })
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { message: error.message ?? "Failed to load notifications" },
        { status: 500 }
      );
    }

    const notifications = (data ?? []) as (ParentNotificationRow & {
      priority?: string | null;
    })[];
    const eventIds = Array.from(
      new Set(
        notifications
          .filter((notice) => notice.type === "calendar_event")
          .map((notice) => readCalendarEventRef(notice.message).eventId)
          .filter((id): id is string => Boolean(id))
      )
    );
    const { data: eventRows } = eventIds.length
      ? await admin
          .from("calendar_events")
          .select("id, case_id, visibility, created_by, description, start_time, deleted_at")
          .in("id", eventIds)
      : { data: [] };
    const caseIds = Array.from(
      new Set((eventRows ?? []).map((row) => (row as { case_id?: string }).case_id).filter((id): id is string => Boolean(id)))
    );
    const { data: memberships } = caseIds.length
      ? await admin.from("case_members").select("case_id").eq("user_id", user.id).in("case_id", caseIds)
      : { data: [] };
    const memberCaseIds = (memberships ?? []).map((row) => (row as { case_id?: string }).case_id).filter((id): id is string => Boolean(id));
    const eventsById = new Map(
      (eventRows ?? []).map((row) => {
        const event = row as {
          id: string;
          case_id?: string | null;
          visibility?: string | null;
          created_by?: string | null;
          description?: string | null;
          start_time?: string | null;
          deleted_at?: string | null;
        };
        return [event.id, event] as const;
      })
    );

    return NextResponse.json({
      notifications: notifications.map((n) => {
        const stored = eventsById.get(readCalendarEventRef(n.message).eventId ?? "");
        const linked = n.type === "calendar_event"
          ? calendarNoticeLink({
              message: n.message,
              viewerId: user.id,
              memberCaseIds,
              event: stored
                ? {
                    id: stored.id,
                    caseId: stored.case_id ?? "",
                    visibility: stored.visibility ?? null,
                    createdBy: stored.created_by ?? null,
                    description: stored.description ?? null,
                    start: stored.start_time ?? null,
                    deleted: Boolean(stored.deleted_at),
                  }
                : null,
            })
          : null;
        return {
          id: n.id,
          type: n.type,
          title: n.title,
          message: linked?.text ?? n.message,
          ...(linked?.href ? { href: linked.href } : {}),
          priority:
            n.priority === "high" || n.priority === "urgent"
              ? n.priority
              : "normal",
          read: n.read,
          created_at: n.created_at,
        };
      }),
    });
  } catch (e) {
    return NextResponse.json(
      {
        message:
          e instanceof Error
            ? e.message
            : "Failed to load notifications",
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { message: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      id?: string;
    };

    const id = typeof body.id === "string" ? body.id : "";
    if (!id) {
      return NextResponse.json(
        { message: "Notification id is required" },
        { status: 400 }
      );
    }

    const admin = getServiceRoleClient();
    const nowIso = new Date().toISOString();

    const { error } = await admin
      .from("parent_notifications")
      .update({ read: true, read_at: nowIso })
      .eq("id", id)
      .eq("user_id", user.id);

    if (error) {
      return NextResponse.json(
        { message: error.message ?? "Failed to update notification" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      {
        message:
          e instanceof Error
            ? e.message
            : "Failed to update notification",
      },
      { status: 500 }
    );
  }
}

