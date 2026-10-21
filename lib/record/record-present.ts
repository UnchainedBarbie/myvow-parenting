import type { ParentIdentity } from "@/lib/record/record-filters";

export type MemberRow = {
  id: string;
  user_id: string | null;
  display_name: string | null;
  external_email: string | null;
  invited_email: string | null;
  invited_name: string | null;
};

export type UserRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  timezone: string | null;
};

export type MessageRow = {
  id: string;
  created_at: string;
  direction: string;
  sender_id: string | null;
  sender_external_email: string | null;
  original_content: string | null;
  conversation_id: string | null;
  current_status: string | null;
  delivery_status: string | null;
  delivered_at: string | null;
  has_attachments: boolean | null;
  email_message_id?: string | null;
  recipient_email?: string | null;
  recipient_cc?: string | null;
};

export type ConversationRow = {
  id: string;
  topic: string | null;
  category: string | null;
  subject: string | null;
};

export type RecordEntry = {
  message: MessageRow;
  number: string;
};

export type Attachment = {
  fileName: string;
  documentNumber: number | null;
};

const NOT_PASSED = new Set([
  "draft",
  "pending",
  "pending_approval",
  "ai_processing",
  "failed",
]);

const DEFAULT_TIMEZONE = "America/Denver";

const TOPIC_LABELS: Record<string, string> = {
  medical: "Medical",
  school: "School",
  schedule: "Schedule",
  expenses: "Expenses",
  expense: "Expenses",
  general: "General",
  emergency: "Emergency",
};

export function zoneOrDenver(timezone: string | null | undefined): string {
  const trimmed = timezone?.trim();
  return trimmed ? trimmed : DEFAULT_TIMEZONE;
}

export function safeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function uniqueEmails(values: Array<string | null | undefined>): string[] {
  return [
    ...new Set(
      values
        .map((value) => value?.trim().toLowerCase())
        .filter((value): value is string => Boolean(value))
    ),
  ];
}

export function parentIdentities(
  members: MemberRow[],
  usersById: Map<string, UserRow>,
  viewerId: string
): ParentIdentity[] {
  const identities = new Map<string, ParentIdentity>();
  for (const member of members) {
    if (!member.user_id) continue;
    const user = usersById.get(member.user_id);
    identities.set(member.user_id, {
      userId: member.user_id,
      emails: uniqueEmails([member.external_email, member.invited_email, user?.email]),
    });
  }
  if (!identities.has(viewerId)) {
    identities.set(viewerId, {
      userId: viewerId,
      emails: uniqueEmails([usersById.get(viewerId)?.email]),
    });
  }
  return [...identities.values()];
}

export function formatWhen(iso: string, timezone: string | null | undefined): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: zoneOrDenver(timezone),
  }).format(date);
}

export function formatDay(iso: string, timezone: string | null | undefined): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: zoneOrDenver(timezone),
  }).format(date);
}

export function passedBetweenParents(message: MessageRow): boolean {
  const status = (message.current_status ?? "").toLowerCase();
  if (NOT_PASSED.has(status)) return false;
  const delivery = (message.delivery_status ?? "").toLowerCase();
  if (delivery === "pending" || delivery === "buffered" || delivery === "blocked") return false;
  if (delivery === "delivered" || message.delivered_at != null) return true;
  return (
    status === "sent" ||
    status === "received" ||
    status === "delivered" ||
    status === "approved"
  );
}

function deliveryStatusWords(status: string): string | null {
  switch (status.trim().toLowerCase()) {
    case "delivered":
      return "Delivered";
    case "pending":
      return "Pending delivery";
    case "buffered":
      return "Held before delivery";
    case "blocked":
      return "Blocked";
    default:
      return null;
  }
}

export function deliveryEvidence(message: MessageRow, timezone: string): string[] {
  const direction = (message.direction ?? "").trim().toLowerCase();
  if (direction === "incoming") {
    if (!message.current_status?.trim() && !message.delivery_status?.trim()) return [];
    return ["Received"];
  }
  const lines: string[] = [];
  const status = message.delivery_status?.trim() ?? "";
  const deliveredAt = message.delivered_at?.trim() ?? "";
  const words = status ? deliveryStatusWords(status) : null;
  if (deliveredAt) {
    lines.push(`Delivered ${formatWhen(deliveredAt, timezone)}`);
  } else if (words) {
    lines.push(words);
  }
  if (deliveredAt && words && status.toLowerCase() !== "delivered") {
    lines.unshift(words);
  }
  return lines;
}

export function messageNumber(index: number): string {
  return `MSG-${String(index + 1).padStart(3, "0")}`;
}

export function documentLabel(attachment: Attachment): string {
  if (attachment.documentNumber == null) return attachment.fileName;
  return `${attachment.fileName} (DOC-${String(attachment.documentNumber).padStart(3, "0")})`;
}

function storedName(member: MemberRow | undefined, user: UserRow | undefined): string {
  return (
    member?.display_name?.trim() ||
    member?.invited_name?.trim() ||
    user?.full_name?.trim() ||
    ""
  );
}

function storedEmail(member: MemberRow | undefined, user: UserRow | undefined): string {
  return (
    member?.external_email?.trim() ||
    member?.invited_email?.trim() ||
    user?.email?.trim() ||
    ""
  );
}

export function partyLabel(member: MemberRow, user: UserRow | undefined): string {
  const name = storedName(member, user);
  const email = storedEmail(member, user);
  if (name && email) return `${name} (${email})`;
  return name || email;
}

export function senderIdentity(
  message: MessageRow,
  usersById: Map<string, UserRow>,
  members: MemberRow[]
): { name: string; email: string } {
  if (message.sender_id) {
    const user = usersById.get(message.sender_id);
    const member = members.find((row) => row.user_id === message.sender_id);
    return {
      name: storedName(member, user),
      email: user?.email?.trim() || storedEmail(member, undefined),
    };
  }
  const email = message.sender_external_email?.trim() || "";
  const member = members.find((row) => {
    const stored = (row.external_email || row.invited_email || "").trim().toLowerCase();
    return email !== "" && stored === email.toLowerCase();
  });
  return {
    name: storedName(member, undefined),
    email,
  };
}

export function senderLine(direction: string, sender: { name: string; email: string }): string {
  const name = sender.name.trim();
  const email = sender.email.trim();
  if (name && email && name.toLowerCase() !== email.toLowerCase()) {
    return `${direction}, sent by ${name} (${email})`;
  }
  const who = name || email;
  return who ? `${direction}, sent by ${who}` : direction;
}

export function conversationHeading(conversation: ConversationRow | undefined): string {
  const subject = conversation?.subject?.trim() || "";
  if (subject) return subject;
  const raw = conversation?.topic?.trim() || conversation?.category?.trim() || "";
  if (raw) return TOPIC_LABELS[raw.toLowerCase()] ?? raw;
  return "Conversation";
}

export function messageTime(iso: string): number {
  const time = new Date(iso).getTime();
  return Number.isNaN(time) ? 0 : time;
}

export function senderCell(sender: { name: string; email: string }): string {
  const name = sender.name.trim();
  const email = sender.email.trim();
  if (name && email && name.toLowerCase() !== email.toLowerCase()) return `${name}\n${email}`;
  return name || email || "Not recorded";
}
