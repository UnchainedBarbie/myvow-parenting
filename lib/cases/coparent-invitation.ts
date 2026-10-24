import { createHash, randomBytes } from "crypto";
import { normalizeMemberEmail } from "@/lib/cases/register-member-email";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Postmark's default transactional stream on the production server. */
export const INVITE_MESSAGE_STREAM = "outbound";

export type ProviderFailure = {
  httpStatus: number | null;
  errorCode: number | null;
  message: string;
};

export type MailResult =
  | { accepted: true }
  | { accepted: false; message: string; failure: ProviderFailure | null };

export type ParentSlot = {
  id: string;
  userId: string | null;
  role: string | null;
};

export type InviteRow = {
  id: string;
  caseId: string;
  userId: string | null;
  status: string | null;
  email: string;
  tokenHash: string | null;
  expiresAt: string | null;
};

export type CoparentPresentation = {
  id: string | null;
  name: string;
  email: string | null;
  status: "not_invited" | "invited" | "connected";
  invitationSentAt: string | null;
  invitationError: string | null;
};

export function createInvitationToken(now = new Date()): {
  token: string;
  tokenHash: string;
  expiresAt: string;
} {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashInvitationToken(token),
    expiresAt: new Date(now.getTime() + INVITE_TTL_MS).toISOString(),
  };
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function invitationMessageStream(): string {
  const configured = process.env.POSTMARK_MESSAGE_STREAM?.trim();
  return configured || INVITE_MESSAGE_STREAM;
}

export function senderDomain(from: string | null | undefined): string | null {
  const match = (from ?? "").match(/@([a-z0-9.-]+\.[a-z]{2,})/i);
  return match ? match[1].toLowerCase() : null;
}

/** Parent-facing text. Credential wording stays generic. */
export function publicDeliveryError(message: string): string {
  const cleaned = safeProviderMessage(message);
  if (!cleaned || /token|password|api[_-]?key|credential|secret/i.test(cleaned)) {
    return "The email provider did not accept the invitation.";
  }
  return cleaned.slice(0, 180);
}

/**
 * Provider wording for server logs. Links, addresses, and long secrets are removed.
 * Words such as "Server Token" stay, because they identify the rejection.
 */
export function safeProviderMessage(message: string): string {
  return message
    .replace(/https?:\/\/\S+/gi, "[link]")
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, "[email]")
    .replace(/\b[a-z0-9_-]{24,}\b/gi, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

export function providerFailure(error: unknown): ProviderFailure {
  const record = error && typeof error === "object" ? (error as { message?: unknown; code?: unknown; statusCode?: unknown }) : {};
  const message = typeof record.message === "string" && record.message.trim()
    ? record.message
    : "The email provider did not accept the invitation.";
  return {
    httpStatus: typeof record.statusCode === "number" ? record.statusCode : null,
    errorCode: typeof record.code === "number" ? record.code : null,
    message: safeProviderMessage(message),
  };
}

export function invitationFailureLog(input: {
  failure: ProviderFailure | null;
  publicError: string | null;
  messageStream: string;
  from: string | null;
  serverTokenConfigured: boolean;
}): {
  httpStatus: number | null;
  errorCode: number | null;
  message: string;
  messageStream: string;
  senderDomain: string | null;
  serverTokenConfigured: boolean;
} {
  return {
    httpStatus: input.failure?.httpStatus ?? null,
    errorCode: input.failure?.errorCode ?? null,
    message: input.failure?.message || input.publicError || "The email provider did not accept the invitation.",
    messageStream: input.messageStream,
    senderDomain: senderDomain(input.from),
    serverTokenConfigured: input.serverTokenConfigured,
  };
}

export function invitationBaseUrl(origin: string | null | undefined): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (configured) return configured;
  if (origin && /^https?:\/\//i.test(origin)) return origin.replace(/\/$/, "");
  return "http://localhost:3000";
}

export function invitationEmailText(input: { inviterName: string; link: string }): {
  subject: string;
  text: string;
} {
  const name = input.inviterName.trim() || "A parent";
  return {
    subject: "You're invited to MyVow Parenting",
    text: [
      `${name} invited you to join them on MyVow Parenting.`,
      "",
      "Use this link to accept. It expires in 7 days and works once:",
      input.link,
      "",
      "Create an account or sign in with the email address that received this invitation.",
      "If you do not accept, they can still message you at this address.",
    ].join("\n"),
  };
}

export function safeInviteNext(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value !== "/invite" && !value.startsWith("/invite?")) return null;
  if (value.includes("//") || value.includes("\\") || value.includes("@")) return null;
  return value;
}

export function maskEmail(email: string): string {
  const normalized = normalizeMemberEmail(email);
  if (!normalized) return "the invited address";
  const [local, domain] = normalized.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

/** One pending parent slot per case. An active co-parent blocks a second membership. */
export function inviteSlotAction(
  members: ParentSlot[],
  currentUserId: string
): { action: "insert" } | { action: "update"; memberId: string } | { action: "reject"; error: string } {
  const parents = members.filter((member) => member.role === "parent");
  const activeOther = parents.find((member) => member.userId && member.userId !== currentUserId);
  if (activeOther) {
    return { action: "reject", error: "A co-parent is already active on this case." };
  }
  const pending = parents.find((member) => !member.userId);
  if (pending) return { action: "update", memberId: pending.id };
  return { action: "insert" };
}

export function invitationDeliveryFields(input: {
  previousSentAt: string | null;
  now: Date;
  mail: MailResult;
  tokenHash: string;
  expiresAt: string;
}): {
  emailSent: boolean;
  error: string | null;
  fields: {
    invitation_token_hash: string;
    invitation_expires_at: string;
    invitation_sent_at: string | null;
    invitation_last_error: string | null;
  };
} {
  const sentAt = input.mail.accepted ? input.now.toISOString() : input.previousSentAt;
  const error = input.mail.accepted ? null : publicDeliveryError(input.mail.message);
  return {
    emailSent: input.mail.accepted,
    error,
    fields: {
      invitation_token_hash: input.tokenHash,
      invitation_expires_at: input.expiresAt,
      invitation_sent_at: sentAt,
      invitation_last_error: error,
    },
  };
}

export function classifyInvite(row: InviteRow | null, now: Date): "invalid" | "expired" | "used" | "valid" {
  if (!row?.tokenHash || !normalizeMemberEmail(row.email)) return "invalid";
  if (row.userId || row.status === "connected") return "used";
  const expires = row.expiresAt ? new Date(row.expiresAt).getTime() : Number.NaN;
  if (!Number.isFinite(expires) || expires <= now.getTime()) return "expired";
  return "valid";
}

export function decideAcceptance(input: {
  row: InviteRow | null;
  now: Date;
  authUserId: string;
  authEmail: string;
  existingCaseIds: string[];
}):
  | { ok: false; status: number; error: string }
  | { ok: true; memberId: string; caseId: string } {
  const kind = classifyInvite(input.row, input.now);
  if (kind === "invalid") {
    return { ok: false, status: 400, error: "This invitation link is not valid." };
  }
  if (kind === "expired") {
    return {
      ok: false,
      status: 400,
      error: "This invitation has expired. Ask the other parent to resend it.",
    };
  }
  if (kind === "used") {
    return { ok: false, status: 400, error: "This invitation has already been used." };
  }
  const row = input.row as InviteRow;
  const authEmail = normalizeMemberEmail(input.authEmail);
  const invited = normalizeMemberEmail(row.email);
  if (!authEmail || authEmail !== invited) {
    return {
      ok: false,
      status: 403,
      error: "This invitation was sent to a different email address. Sign in with the address that received it.",
    };
  }
  if (input.existingCaseIds.includes(row.caseId)) {
    return { ok: false, status: 409, error: "This account is already a member of this family." };
  }
  if (input.existingCaseIds.some((caseId) => caseId !== row.caseId)) {
    return {
      ok: false,
      status: 409,
      error: "This account already belongs to another family, so it cannot join this invitation.",
    };
  }
  return { ok: true, memberId: row.id, caseId: row.caseId };
}

export function acceptanceUpdate(userId: string): {
  user_id: string;
  invitation_status: "connected";
  invitation_token_hash: null;
  invitation_expires_at: null;
  invitation_last_error: null;
} {
  return {
    user_id: userId,
    invitation_status: "connected",
    invitation_token_hash: null,
    invitation_expires_at: null,
    invitation_last_error: null,
  };
}

export function presentCoparent(input: {
  currentUserId: string;
  members: Array<{
    id: string;
    userId: string | null;
    displayName: string | null;
    externalEmail: string | null;
    status: string | null;
    sentAt: string | null;
    lastError: string | null;
  }>;
  users: Array<{ id: string; fullName: string | null; email: string | null }>;
  addresses: Array<{ caseMemberId: string; email: string; isReply: boolean }>;
}): CoparentPresentation {
  const others = input.members.filter((member) => member.userId !== input.currentUserId);
  const active = others.find((member) => member.userId);
  const pending = others.find((member) => !member.userId);
  const member = active ?? pending;
  if (!member) {
    return {
      id: null,
      name: "",
      email: null,
      status: "not_invited",
      invitationSentAt: null,
      invitationError: null,
    };
  }
  const user = input.users.find((row) => row.id === member.userId);
  const forMember = input.addresses.filter((row) => row.caseMemberId === member.id && row.email);
  const reply = forMember.find((row) => row.isReply) ?? (forMember.length === 1 ? forMember[0] : null);
  const email =
    normalizeMemberEmail(reply?.email) ||
    normalizeMemberEmail(member.externalEmail) ||
    normalizeMemberEmail(user?.email) ||
    null;
  const name = (member.displayName ?? "").trim() || (user?.fullName ?? "").trim() || email || "Co-Parent";
  return {
    id: member.id,
    name,
    email,
    status: member.userId ? "connected" : "invited",
    invitationSentAt: member.userId ? null : member.sentAt,
    invitationError: member.userId ? null : member.lastError,
  };
}
