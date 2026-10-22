import type { getServiceRoleClient } from "@/lib/supabase/server";
import { withProposalIds } from "@/lib/sage/proposal-lifecycle";
import {
  calendarChangeLabels,
  locationLine,
  noticeFingerprint,
  planCalendarNotice,
  registeredCoparentIds,
  type CalendarAudience,
  type CaseMemberNotice,
} from "@/lib/calendar/coparent-notice";

type Admin = ReturnType<typeof getServiceRoleClient>;

export type CalendarNoticeResult = {
  status: "sent" | "already_sent" | "not_registered" | "skipped";
  pendingInvite: boolean;
  draft: "queued" | "already_queued" | "not_registered" | "unavailable" | null;
};

type MemberRow = {
  id?: string | null;
  user_id?: string | null;
  is_participating?: boolean | null;
  external_email?: string | null;
  invited_email?: string | null;
  invitation_status?: string | null;
  display_name?: string | null;
  invited_name?: string | null;
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
    previous?: {
      title?: string | null;
      start?: string | null;
      end?: string | null;
      description?: string | null;
    } | null;
    draftMessage?: string | null;
  }
): Promise<CalendarNoticeResult> {
  const members = await loadMembers(admin, input.caseId);
  if (members.failed) {
    return { status: "skipped", pendingInvite: false, draft: null };
  }
  const actorIsMember = members.rows.some(
    (row) => row.user_id === input.actorId && row.is_participating !== false
  );
  if (!actorIsMember) {
    return { status: "skipped", pendingInvite: false, draft: null };
  }
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
      message: plan.notice!.message,
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

  const draft = await queueDraft(admin, {
    caseId: input.caseId,
    eventId: input.eventId,
    actorId: input.actorId,
    title: input.title,
    body: input.draftMessage ?? "",
    members: members.rows,
    recipientIds: registeredCoparentIds(members.notices, input.actorId),
    pendingInvite: plan.pendingInvite || members.pendingInvite,
  });

  return { status, pendingInvite: plan.pendingInvite || members.pendingInvite, draft };
}

async function loadMembers(admin: Admin, caseId: string): Promise<{
  rows: MemberRow[];
  notices: CaseMemberNotice[];
  pendingInvite: boolean;
  failed: boolean;
}> {
  const { data, error } = await admin
    .from("case_members")
    .select("id, user_id, role, is_participating, external_email, invited_email, invitation_status, display_name, invited_name")
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

async function queueDraft(
  admin: Admin,
  input: {
    caseId: string;
    eventId: string;
    actorId: string;
    title: string;
    body: string;
    members: MemberRow[];
    recipientIds: string[];
    pendingInvite: boolean;
  }
): Promise<CalendarNoticeResult["draft"]> {
  const body = input.body.trim();
  if (!body) return null;
  if (input.recipientIds.length === 0) return input.pendingInvite ? "not_registered" : "unavailable";
  if (input.recipientIds.length !== 1) return "unavailable";
  const recipientId = input.recipientIds[0];
  const { data: existing } = await admin
    .from("sage_items")
    .select("id")
    .eq("case_id", input.caseId)
    .eq("visible_to", input.actorId)
    .eq("source_type", "chat")
    .eq("source_id", input.eventId)
    .eq("item_type", "message")
    .limit(1);
  if (Array.isArray(existing) && existing.length > 0) return "already_queued";

  const { data: userRow } = await admin
    .from("users")
    .select("full_name, email")
    .eq("id", recipientId)
    .maybeSingle();
  const user = userRow as { full_name?: string | null; email?: string | null } | null;
  const member = input.members.find((row) => row.user_id === recipientId);
  const email = await savedCoparentEmail(admin, member, user?.email);
  if (!email) return "unavailable";
  const name = member?.display_name?.trim() || member?.invited_name?.trim() || user?.full_name?.trim() || "Co-parent";
  const plan = withProposalIds({
    status: "ready" as const,
    reasoning: "A calendar review asked for a co-parent message. Nothing is sent until it is approved.",
    proposals: [
      {
        type: "reply_coparent",
        draft: body.slice(0, 2000),
        depends_on: null,
        requires_approval: true,
        recipient_name: name,
        recipient_email: email,
      },
    ],
  });
  const { error } = await admin.from("sage_items").insert({
    case_id: input.caseId,
    source_type: "chat",
    source_id: input.eventId,
    visible_to: input.actorId,
    item_type: "message",
    domain: "coordination",
    summary: `Message about ${input.title}`.slice(0, 180),
    evidence_excerpt: body.slice(0, 240),
    action_required: true,
    action_type: "propose",
    urgency: "normal",
    confidence: 1,
    tool_input: {},
    plan,
    status: "pending",
  });
  if (error) {
    console.error("[calendar/notice] draft:", error.message);
    return "unavailable";
  }
  return "queued";
}

async function savedCoparentEmail(
  admin: Admin,
  member: MemberRow | undefined,
  loginEmail: string | null | undefined
): Promise<string> {
  const login = loginEmail?.trim() ?? "";
  const memberId = member?.id?.trim() ?? "";
  if (memberId) {
    const { data } = await admin
      .from("case_member_emails")
      .select("email, is_reply")
      .eq("case_member_id", memberId);
    const rows = (data ?? []) as Array<{ email?: string | null; is_reply?: boolean | null }>;
    const saved = rows.map((row) => ({ email: row.email?.trim() ?? "", reply: row.is_reply === true })).filter((row) => row.email);
    const reply = saved.find((row) => row.reply);
    if (reply) return reply.email;
    if (saved.length === 1) return saved[0].email;
  }
  return member?.external_email?.trim() || member?.invited_email?.trim() || login;
}
