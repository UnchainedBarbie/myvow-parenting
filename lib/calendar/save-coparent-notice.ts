import type { getServiceRoleClient } from "@/lib/supabase/server";
import {
  calendarChangeLabels,
  locationLine,
  noticeFingerprint,
  planCalendarNotice,
  withCalendarEventRef,
  type CalendarAudience,
  type CaseMemberNotice,
} from "@/lib/calendar/coparent-notice";

type Admin = ReturnType<typeof getServiceRoleClient>;

export type CalendarNoticeResult = {
  status: "sent" | "already_sent" | "not_registered" | "skipped";
  pendingInvite: boolean;
};

type MemberRow = {
  user_id?: string | null;
  is_participating?: boolean | null;
  external_email?: string | null;
  invited_email?: string | null;
  invitation_status?: string | null;
  role?: string | null;
};

export async function saveCalendarCoparentNotice(
  admin: Admin,
  input: {
    caseId: string;
    eventId: string;
    actorId: string;
    visibility: CalendarAudience;
    notify: boolean;
    kind: "created" | "updated";
    title: string;
    start: string | null;
    end: string | null;
    description: string | null;
    allDay?: boolean;
    previous?: {
      title?: string | null;
      start?: string | null;
      end?: string | null;
      description?: string | null;
    } | null;
  }
): Promise<CalendarNoticeResult> {
  const members = await loadMembers(admin, input.caseId);
  if (members.failed) {
    return { status: "skipped", pendingInvite: false };
  }
  const actorIsMember = members.rows.some(
    (row) => row.user_id === input.actorId && row.is_participating !== false
  );
  if (!actorIsMember) {
    return { status: "skipped", pendingInvite: false };
  }
  const timezone = await actorTimezone(admin, input.actorId);
  const location = locationLine(input.description);
  const changes = calendarChangeLabels(
    input.previous
      ? {
          title: input.previous.title,
          start: input.previous.start,
          end: input.previous.end,
          location: locationLine(input.previous.description),
        }
      : null,
    { title: input.title, start: input.start, end: input.end, location }
  );
  const fingerprint = noticeFingerprint({
    eventId: input.eventId,
    kind: input.kind,
    title: input.title,
    start: input.start,
    end: input.end,
    location,
  });
  const plan = planCalendarNotice({
    eventId: input.eventId,
    visibility: input.visibility,
    choice: input.notify,
    title: input.title,
    kind: input.kind,
    changes,
    location,
    allDay: input.allDay,
    timezone,
    start: input.start,
    end: input.end,
    actorId: input.actorId,
    members: members.notices,
    alreadySent: input.notify ? await noticeAlreadySent(admin, input.eventId, fingerprint) : false,
  });

  let status = plan.status;
  if (status === "sent" && plan.notice) {
    const rows = plan.recipientIds.map((userId) => ({
      case_id: input.caseId,
      user_id: userId,
      type: plan.notice!.type,
      title: plan.notice!.title,
      message: withCalendarEventRef(plan.notice!.message, input.eventId),
      priority: plan.notice!.priority,
    }));
    const { error } = await admin.from("parent_notifications").insert(rows);
    if (error) {
      console.error("[calendar/notice] parent_notifications:", error.message);
      status = "skipped";
    } else {
      const { error: historyError } = await admin.from("calendar_event_history").insert({
        event_id: input.eventId,
        field_changed: "coparent_notified",
        old_value: null,
        new_value: plan.notice.fingerprint,
        note: null,
        changed_by: input.actorId,
      });
      if (historyError) {
        console.error("[calendar/notice] history:", historyError.message);
      }
    }
  }

  return { status, pendingInvite: plan.pendingInvite || members.pendingInvite };
}

async function loadMembers(admin: Admin, caseId: string): Promise<{
  rows: MemberRow[];
  notices: CaseMemberNotice[];
  pendingInvite: boolean;
  failed: boolean;
}> {
  const { data, error } = await admin
    .from("case_members")
    .select("user_id, role, is_participating, external_email, invited_email, invitation_status")
    .eq("case_id", caseId);
  if (error) {
    console.error("[calendar/notice] case_members:", error.message);
    return { rows: [], notices: [], pendingInvite: false, failed: true };
  }
  const rows = ((data ?? []) as MemberRow[]).filter((row) => !row.role || row.role === "parent");
  const notices: CaseMemberNotice[] = rows.map((row) => ({
    userId: row.user_id,
    participating: row.is_participating,
    invited: Boolean(
      (row.invitation_status ?? "").toLowerCase() === "invited" ||
        row.external_email?.trim() ||
        row.invited_email?.trim()
    ) && !row.user_id,
  }));
  return {
    rows,
    notices,
    pendingInvite: notices.some((member) => member.invited === true && !member.userId?.trim()),
    failed: false,
  };
}

async function noticeAlreadySent(admin: Admin, eventId: string, fingerprint: string): Promise<boolean> {
  const { data } = await admin
    .from("calendar_event_history")
    .select("id")
    .eq("event_id", eventId)
    .eq("field_changed", "coparent_notified")
    .eq("new_value", fingerprint)
    .limit(1);
  return Array.isArray(data) && data.length > 0;
}

async function actorTimezone(admin: Admin, actorId: string): Promise<string> {
  const { data } = await admin.from("users").select("timezone").eq("id", actorId).maybeSingle();
  const zone = (data as { timezone?: string | null } | null)?.timezone?.trim() ?? "";
  return zone || "America/Denver";
}
