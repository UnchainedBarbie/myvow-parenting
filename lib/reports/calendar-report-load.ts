import { getServiceRoleClient } from "@/lib/supabase/server";
import {
  classifySupportingFile,
  supportingFileSentence,
  type SupportingFile,
} from "@/lib/reports/embed-attachments";
import {
  eventDescriptionForReport,
  eventVisibleToViewer,
  formatEventNumber,
  type CalendarReportEvent,
  type CalendarReportOptions,
  type DayOverride,
  type HolidayAssignment,
  type StoredCustodySchedule,
} from "@/lib/reports/calendar-report";

type Admin = ReturnType<typeof getServiceRoleClient>;

export type CalendarReportLoad = {
  events: CalendarReportEvent[];
  parents: { userId: string | null; name: string }[];
  caseLabel: string;
  timeZone: string;
  viewerName: string;
  viewerIsParent: boolean;
  schedule: StoredCustodySchedule | null;
  overrides: DayOverride[];
  holidays: HolidayAssignment[];
  withheldCount: number;
  fieldWarning: string | null;
  fileLines: string[];
  files: SupportingFile[];
};

const DEFAULT_TIMEZONE = "America/Denver";
const CORE_COLUMNS =
  "id, title, description, event_type, child_id, start_time, end_time, all_day, status, visibility, created_by, created_at, recurring_rule";
const EXTRA_COLUMNS =
  "event_number, is_swap_request, swap_status, swap_original_message, actual_exchange_time, transported_by, exchange_location";

function safeZone(timeZone: string | null | undefined): string {
  const trimmed = timeZone?.trim() || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed }).format(new Date());
    return trimmed;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function partyName(
  member: {
    display_name?: string | null;
    invited_name?: string | null;
    external_email?: string | null;
    invited_email?: string | null;
  },
  user: { full_name?: string | null; email?: string | null } | undefined
): string {
  const name = member.display_name?.trim() || member.invited_name?.trim() || user?.full_name?.trim() || "";
  const email = member.external_email?.trim() || member.invited_email?.trim() || user?.email?.trim() || "";
  if (name && email) return `${name} (${email})`;
  return name || email;
}

function missingRelation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  return error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(message);
}

export async function loadCalendarReport(input: {
  admin: Admin;
  caseId: string;
  userId: string;
  options: CalendarReportOptions;
}): Promise<CalendarReportLoad> {
  const { admin, caseId, userId } = input;
  const [caseResult, memberResult, viewerResult, scheduleResult] = await Promise.all([
    admin.from("cases").select("id, family_code").eq("id", caseId).maybeSingle(),
    admin
      .from("case_members")
      .select("user_id, role, display_name, invited_name, external_email, invited_email")
      .eq("case_id", caseId)
      .eq("role", "parent"),
    admin.from("users").select("id, full_name, email, timezone").eq("id", userId).maybeSingle(),
    admin
      .from("custody_schedules")
      .select("schedule_type, rotation_start_date, user_starts_first, manual_pattern, updated_at")
      .eq("case_id", caseId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  let fieldWarning: string | null = null;
  const fullEventResult = await admin
    .from("calendar_events")
    .select(`${CORE_COLUMNS}, ${EXTRA_COLUMNS}`)
    .eq("case_id", caseId)
    .is("deleted_at", null)
    .order("start_time", { ascending: true });
  let rawEvents = (fullEventResult.data ?? []) as Record<string, unknown>[];
  if (fullEventResult.error && /column|schema cache/i.test(fullEventResult.error.message)) {
    fieldWarning =
      "Some event fields, such as event number or exchange details, could not be read. Those values are shown as not recorded.";
    const coreEventResult = await admin
      .from("calendar_events")
      .select(CORE_COLUMNS)
      .eq("case_id", caseId)
      .is("deleted_at", null)
      .order("start_time", { ascending: true });
    if (coreEventResult.error) throw new Error(coreEventResult.error.message);
    rawEvents = (coreEventResult.data ?? []) as Record<string, unknown>[];
  } else if (fullEventResult.error) {
    throw new Error(fullEventResult.error.message);
  }
  const visible = rawEvents.filter((row) =>
    eventVisibleToViewer(
      {
        visibility: typeof row.visibility === "string" ? row.visibility : null,
        description: typeof row.description === "string" ? row.description : null,
        createdBy: typeof row.created_by === "string" ? row.created_by : null,
      },
      userId
    )
  );
  const withheldCount = rawEvents.length - visible.length;

  const childIds = [
    ...new Set(
      visible
        .map((row) => (typeof row.child_id === "string" ? row.child_id : ""))
        .filter(Boolean)
    ),
  ];
  const creatorIds = [
    ...new Set(
      visible
        .map((row) => (typeof row.created_by === "string" ? row.created_by : ""))
        .filter(Boolean)
    ),
  ];
  const [childResult, creatorResult] = await Promise.all([
    childIds.length > 0
      ? admin.from("children").select("id, first_name").in("id", childIds)
      : Promise.resolve({ data: [] as { id: string; first_name?: string | null }[] }),
    creatorIds.length > 0
      ? admin.from("users").select("id, full_name").in("id", creatorIds)
      : Promise.resolve({ data: [] as { id: string; full_name?: string | null }[] }),
  ]);
  const childNames = new Map(
    ((childResult.data ?? []) as { id: string; first_name?: string | null }[]).map((child) => [
      child.id,
      child.first_name?.trim() || "Unnamed child",
    ])
  );
  const creatorNames = new Map(
    ((creatorResult.data ?? []) as { id: string; full_name?: string | null }[]).map((user) => [
      user.id,
      user.full_name?.trim() || "",
    ])
  );

  const eventIds = visible.map((row) => String(row.id));
  const attachmentNames = new Map<string, string[]>();
  const attachmentRows: {
    id: string;
    eventId: string;
    type: string;
    storagePath: string | null;
    contentText: string | null;
  }[] = [];
  if (eventIds.length > 0) {
    const attachmentResult = await admin
      .from("calendar_event_attachments")
      .select("id, event_id, attachment_type, storage_path, content_text")
      .in("event_id", eventIds);
    if (attachmentResult.error) {
      if (!missingRelation(attachmentResult.error)) throw new Error(attachmentResult.error.message);
      fieldWarning = fieldWarning ?? "Event attachments could not be read.";
    } else {
      for (const row of attachmentResult.data ?? []) {
        const eventId = String((row as { event_id?: string }).event_id ?? "");
        const type = String((row as { attachment_type?: string }).attachment_type ?? "file");
        const path = (row as { storage_path?: string | null }).storage_path ?? null;
        const text = (row as { content_text?: string | null }).content_text ?? null;
        const name = path?.split("/").pop() || (text ? "Email" : type);
        const list = attachmentNames.get(eventId) ?? [];
        list.push(name);
        attachmentNames.set(eventId, list);
        attachmentRows.push({
          id: String((row as { id?: string }).id ?? `${eventId}-${list.length}`),
          eventId,
          type,
          storagePath: path,
          contentText: text,
        });
      }
    }
  }

  const events: CalendarReportEvent[] = visible.map((row) => {
    const id = String(row.id);
    const childId = typeof row.child_id === "string" ? row.child_id : null;
    const createdBy = typeof row.created_by === "string" ? row.created_by : null;
    return {
      id,
      eventNumber: typeof row.event_number === "number" ? row.event_number : null,
      title: typeof row.title === "string" ? row.title : "",
      description: typeof row.description === "string" ? row.description : null,
      eventType: typeof row.event_type === "string" ? row.event_type : null,
      childName: childId ? childNames.get(childId) ?? "Unnamed child" : null,
      startTime: typeof row.start_time === "string" ? row.start_time : "",
      endTime: typeof row.end_time === "string" ? row.end_time : null,
      allDay: row.all_day === true,
      status: typeof row.status === "string" ? row.status : null,
      visibility: typeof row.visibility === "string" ? row.visibility : null,
      createdBy,
      createdByName: createdBy ? creatorNames.get(createdBy) || null : null,
      createdAt: typeof row.created_at === "string" ? row.created_at : null,
      recurringRule: typeof row.recurring_rule === "string" ? row.recurring_rule : null,
      isSwapRequest: row.is_swap_request === true,
      swapStatus: typeof row.swap_status === "string" ? row.swap_status : null,
      swapOriginalMessage: typeof row.swap_original_message === "string" ? row.swap_original_message : null,
      actualExchangeTime: typeof row.actual_exchange_time === "string" ? row.actual_exchange_time : null,
      transportedBy: typeof row.transported_by === "string" ? row.transported_by : null,
      exchangeLocation: typeof row.exchange_location === "string" ? row.exchange_location : null,
      attachmentNames: attachmentNames.get(id) ?? [],
    };
  });

  const overridesResult = await admin
    .from("custody_day_overrides")
    .select("date, custodial_parent")
    .eq("case_id", caseId)
    .is("deleted_at", null);
  const overrides: DayOverride[] = [];
  if (overridesResult.error) {
    if (!missingRelation(overridesResult.error)) throw new Error(overridesResult.error.message);
  } else {
    for (const row of overridesResult.data ?? []) {
      const date = (row as { date?: string }).date;
      const parent = (row as { custodial_parent?: string }).custodial_parent;
      if (date && parent) overrides.push({ date, custodialParent: parent });
    }
  }

  const holidayResult = await admin
    .from("holiday_custody")
    .select("holiday_name, start_date, end_date, custodial_parent")
    .eq("case_id", caseId)
    .is("deleted_at", null);
  const holidays: HolidayAssignment[] = [];
  if (holidayResult.error) {
    if (!missingRelation(holidayResult.error)) throw new Error(holidayResult.error.message);
  } else {
    for (const row of holidayResult.data ?? []) {
      const name = (row as { holiday_name?: string }).holiday_name;
      const start = (row as { start_date?: string }).start_date;
      const end = (row as { end_date?: string }).end_date;
      const parent = (row as { custodial_parent?: string }).custodial_parent;
      if (name && start && end && parent) {
        holidays.push({ name, startDate: start, endDate: end, custodialParent: parent });
      }
    }
  }

  const scheduleRow = scheduleResult.error ? null : (scheduleResult.data as Record<string, unknown> | null);
  if (scheduleResult.error && !missingRelation(scheduleResult.error)) throw new Error(scheduleResult.error.message);
  const schedule: StoredCustodySchedule | null = scheduleRow?.schedule_type
    ? {
        schedule_type: String(scheduleRow.schedule_type),
        rotation_start_date:
          typeof scheduleRow.rotation_start_date === "string" ? scheduleRow.rotation_start_date : null,
        user_starts_first:
          typeof scheduleRow.user_starts_first === "boolean" ? scheduleRow.user_starts_first : null,
        manual_pattern: Array.isArray(scheduleRow.manual_pattern)
          ? (scheduleRow.manual_pattern as (string | null)[])
          : null,
        updatedAt: typeof scheduleRow.updated_at === "string" ? scheduleRow.updated_at : null,
      }
    : null;

  const files: SupportingFile[] = [];
  const fileLines: string[] = [];
  if (input.options.includeFiles) {
    const order = new Map(events.map((event, index) => [event.id, index]));
    const sorted = [...attachmentRows].sort(
      (a, b) => (order.get(a.eventId) ?? 0) - (order.get(b.eventId) ?? 0)
    );
    for (const attachment of sorted) {
      const event = events.find((item) => item.id === attachment.eventId);
      if (!event) continue;
      const record = formatEventNumber(event.eventNumber);
      const label = record === "—" ? event.id : record;
      const fileName = attachment.storagePath?.split("/").pop() || (attachment.contentText ? "Email.txt" : attachment.type);
      const file: SupportingFile = {
        key: attachment.id,
        records: [label],
        documentLabel: "No document ID stored",
        fileName,
        mimeType: null,
        bytes: null,
        unavailableReason: null,
      };
      if (attachment.contentText?.trim() && !attachment.storagePath) {
        fileLines.push(
          `${label} — ${fileName} — stored email text: ${eventDescriptionForReport(attachment.contentText, null)}`
        );
        continue;
      }
      if (!attachment.storagePath) {
        file.unavailableReason = "No file is stored for this attachment.";
      } else {
        const downloaded = await admin.storage.from("calendar-inbox").download(attachment.storagePath);
        if (downloaded.error || !downloaded.data) {
          const documents = await admin.storage.from("documents").download(attachment.storagePath);
          if (documents.error || !documents.data) file.unavailableReason = "The file could not be downloaded.";
          else file.bytes = Buffer.from(await documents.data.arrayBuffer());
        } else {
          file.bytes = Buffer.from(await downloaded.data.arrayBuffer());
        }
      }
      const disposition = await classifySupportingFile(file);
      fileLines.push(supportingFileSentence(file, disposition));
      files.push(file);
    }
  }

  const members = (memberResult.data ?? []) as {
    user_id?: string | null;
    role?: string | null;
    display_name?: string | null;
    invited_name?: string | null;
    external_email?: string | null;
    invited_email?: string | null;
  }[];
  const userIds = members.map((member) => member.user_id).filter((id): id is string => Boolean(id));
  const userRows =
    userIds.length > 0
      ? await admin.from("users").select("id, full_name, email").in("id", userIds)
      : { data: [] as { id: string; full_name?: string | null; email?: string | null }[] };
  const users = new Map(
    ((userRows.data ?? []) as { id: string; full_name?: string | null; email?: string | null }[]).map((user) => [
      user.id,
      user,
    ])
  );
  const parents = members.map((member) => ({
    userId: member.user_id ?? null,
    name: partyName(member, member.user_id ? users.get(member.user_id) : undefined),
  }));
  const viewer = (viewerResult.data as { full_name?: string | null; email?: string | null; timezone?: string | null } | null);
  const viewerParent = parents.find((parent) => parent.userId === userId);
  const familyCode = (caseResult.data as { family_code?: string | null } | null)?.family_code?.trim() || "";

  return {
    events,
    parents,
    caseLabel: familyCode || caseId,
    timeZone: safeZone(viewer?.timezone),
    viewerName: viewerParent?.name || viewer?.full_name?.trim() || viewer?.email?.trim() || "",
    viewerIsParent: Boolean(viewerParent),
    schedule,
    overrides,
    holidays,
    withheldCount,
    fieldWarning,
    fileLines,
    files,
  };
}
