import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

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

    return NextResponse.json({
      notifications: notifications.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        message: n.message,
        priority:
          n.priority === "high" || n.priority === "urgent"
            ? n.priority
            : "normal",
        read: n.read,
        created_at: n.created_at,
      })),
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

