import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { exactReviewText } from "@/lib/messages/outbound-review";

/**
 * Proof that text went through the shared outbound review.
 * The review route issues a receipt for the draft it read and, when Sage offered one, the Sage
 * version. A send route accepts only text the receipt covers. Edited text needs a new review, or
 * the parent's explicit acknowledgement that it was not reviewed. Receipts hold no message text.
 */

const RECEIPT_VERSION = "r1";
export const REVIEW_RECEIPT_TTL_MS = 60 * 60 * 1000;

export type ReviewReceiptStatus = "reviewed" | "review_unavailable";

function secret(): string {
  return process.env.REVIEW_RECEIPT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}

export function reviewedDraftHash(text: string): string {
  return createHash("sha256").update(exactReviewText(text)).digest("hex");
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(`${RECEIPT_VERSION}.${payload}`).digest("base64url");
}

export function issueReviewReceipt(input: {
  userId: string;
  draft: string;
  /** The Sage version the review offered, when it offered one. */
  suggestion?: string | null;
  status: ReviewReceiptStatus;
  now?: number;
  key?: string;
}): string | null {
  const key = input.key ?? secret();
  if (!key || !input.userId.trim() || !input.draft.trim()) return null;
  const suggestion = (input.suggestion ?? "").trim();
  const payload = Buffer.from(
    JSON.stringify({
      u: input.userId.trim(),
      h: reviewedDraftHash(input.draft),
      ...(suggestion ? { g: reviewedDraftHash(suggestion) } : {}),
      s: input.status,
      e: (input.now ?? Date.now()) + REVIEW_RECEIPT_TTL_MS,
    })
  ).toString("base64url");
  return `${RECEIPT_VERSION}.${payload}.${sign(payload, key)}`;
}

export type ReceiptCheck =
  | { ok: true; status: ReviewReceiptStatus }
  | { ok: false; reason: "missing" | "invalid" | "expired" | "wrong_user" | "not_covered" };

/** The receipt is genuine, current, the parent's own, and covers this exact text. */
export function verifyReviewReceipt(input: {
  receipt: unknown;
  userId: string;
  text: string;
  now?: number;
  key?: string;
}): ReceiptCheck {
  const key = input.key ?? secret();
  const raw = typeof input.receipt === "string" ? input.receipt.trim() : "";
  if (!raw) return { ok: false, reason: "missing" };
  const parts = raw.split(".");
  if (parts.length !== 3 || parts[0] !== RECEIPT_VERSION || !key) return { ok: false, reason: "invalid" };
  const expected = Buffer.from(sign(parts[1], key));
  const actual = Buffer.from(parts[2]);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, reason: "invalid" };
  }
  let claim: { u?: unknown; h?: unknown; g?: unknown; s?: unknown; e?: unknown };
  try {
    claim = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (typeof claim.e !== "number" || (input.now ?? Date.now()) > claim.e) return { ok: false, reason: "expired" };
  if (claim.u !== input.userId.trim()) return { ok: false, reason: "wrong_user" };
  const hash = reviewedDraftHash(input.text);
  if (claim.h !== hash && claim.g !== hash) return { ok: false, reason: "not_covered" };
  return {
    ok: true,
    status: claim.s === "review_unavailable" ? "review_unavailable" : "reviewed",
  };
}

export type ReviewGateStatus =
  | ReviewReceiptStatus
  | "unavailable_acknowledged"
  | "edited_unreviewed_acknowledged";

/**
 * A send needs one of:
 *  - a receipt that covers the exact final text,
 *  - an acknowledgement that the review could not run (no receipt exists),
 *  - an acknowledgement that edited text was not reviewed (the receipt is genuine but covers other text).
 * Each acknowledgement is recorded with the send. A review of one text is never treated as a
 * review of different text.
 */
export function reviewGate(input: {
  receipt: unknown;
  unavailableAcknowledged: boolean;
  editUnreviewedAcknowledged?: boolean;
  userId: string;
  /** The exact final text that will be sent. */
  text: string;
  now?: number;
  key?: string;
}): { ok: true; status: ReviewGateStatus } | { ok: false; reason: ReceiptCheckFailure } {
  const checked = verifyReviewReceipt(input);
  if (checked.ok) return { ok: true, status: checked.status };
  if (checked.reason === "missing" && input.unavailableAcknowledged) {
    return { ok: true, status: "unavailable_acknowledged" };
  }
  if (checked.reason === "not_covered" && input.editUnreviewedAcknowledged) {
    return { ok: true, status: "edited_unreviewed_acknowledged" };
  }
  return { ok: false, reason: checked.reason };
}

export type ReceiptCheckFailure = Extract<ReceiptCheck, { ok: false }>["reason"];

export const REVIEW_REQUIRED_MESSAGE =
  "Review this message with Sage before sending. Nothing was sent.";
export const EDIT_NOT_REVIEWED_MESSAGE =
  "This text changed after Sage's review. Review the edit, or confirm you want to send it without another review. Nothing was sent.";

/** The error body for a refused send. */
export function reviewGateFailure(reason: ReceiptCheckFailure): { message: string; code: string } {
  return reason === "not_covered"
    ? { message: EDIT_NOT_REVIEWED_MESSAGE, code: "edit_not_reviewed" }
    : { message: REVIEW_REQUIRED_MESSAGE, code: "review_required" };
}
