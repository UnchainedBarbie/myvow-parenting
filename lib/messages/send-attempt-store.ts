import type { getServiceRoleClient } from "@/lib/supabase/server";
import { exactReviewText } from "@/lib/messages/outbound-review";

type Admin = ReturnType<typeof getServiceRoleClient>;

const POSTGRES_UNIQUE_VIOLATION = "23505";

export const SEND_ATTEMPT_CONFLICT_MESSAGE =
  "That send attempt already saved a different message. Review your text and send it again.";

export type AttemptLookup =
  | { kind: "found"; id: string; text: string; conversationId: string | null }
  | { kind: "none" }
  /** The column is missing or the lookup failed. The send proceeds without idempotency. */
  | { kind: "unavailable" };

/** The message this parent already saved for this send attempt. */
export async function findSendAttempt(admin: Admin, senderId: string, attemptId: string): Promise<AttemptLookup> {
  const { data, error } = await admin
    .from("messages")
    .select("id, ai_rewritten_content, conversation_id")
    .eq("sender_id", senderId)
    .eq("send_attempt_id", attemptId)
    .limit(1);
  if (error) {
    if (!/send_attempt_id/.test(error.message)) console.error("[send-attempt] lookup:", error.message);
    return { kind: "unavailable" };
  }
  const row = ((data ?? []) as { id?: string; ai_rewritten_content?: string | null; conversation_id?: string | null }[])[0];
  if (!row?.id) return { kind: "none" };
  return {
    kind: "found",
    id: row.id,
    text: row.ai_rewritten_content ?? "",
    conversationId: (row.conversation_id ?? "").trim() || null,
  };
}

export type AttemptDecision =
  /** Save a new message. `stored` is false when the database cannot record the attempt id yet. */
  | { kind: "new"; stored: boolean }
  /** This attempt already saved this exact text. The saved message is the send. */
  | { kind: "duplicate"; messageId: string; conversationId: string | null }
  /** This attempt id belongs to a message with different text. */
  | { kind: "conflict" };

/**
 * One approval is one attempt. The same attempt with the same text returns the saved message.
 * The same attempt with other text is refused. A new attempt id is always a new message, so
 * identical text sent on purpose twice is two messages.
 */
export async function decideSendAttempt(
  admin: Admin,
  input: { senderId: string; attemptId: string; text: string }
): Promise<AttemptDecision> {
  const existing = await findSendAttempt(admin, input.senderId, input.attemptId);
  if (existing.kind === "unavailable") return { kind: "new", stored: false };
  if (existing.kind === "none") return { kind: "new", stored: true };
  if (exactReviewText(existing.text) !== exactReviewText(input.text)) return { kind: "conflict" };
  return { kind: "duplicate", messageId: existing.id, conversationId: existing.conversationId };
}

export type OutgoingInsert =
  | { ok: true; messageId: string; duplicate: false }
  /** A parallel request of the same attempt saved first. */
  | { ok: true; messageId: string; duplicate: true; conversationId: string | null }
  | { ok: false; message: string };

/** Insert the outgoing row with its attempt id. A parallel save of the same attempt becomes a duplicate. */
export async function insertOutgoingMessage(
  admin: Admin,
  input: { row: Record<string, unknown>; senderId: string; attemptId: string; stored: boolean; text: string }
): Promise<OutgoingInsert> {
  const row = input.stored ? { ...input.row, send_attempt_id: input.attemptId } : input.row;
  const { data, error } = await admin.from("messages").insert(row).select("id").single();
  const id = (data as { id?: string } | null)?.id;
  if (!error && id) return { ok: true, messageId: id, duplicate: false };
  if (error?.code === POSTGRES_UNIQUE_VIOLATION && input.stored) {
    const winner = await findSendAttempt(admin, input.senderId, input.attemptId);
    if (winner.kind === "found" && exactReviewText(winner.text) === exactReviewText(input.text)) {
      return { ok: true, messageId: winner.id, duplicate: true, conversationId: winner.conversationId };
    }
  }
  return { ok: false, message: error?.message ?? "The message could not be saved." };
}
