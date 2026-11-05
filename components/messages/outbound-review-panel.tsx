"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  exactReviewText,
  reviewCoversText,
  type OutboundReview,
} from "@/lib/messages/outbound-review";

type Props = {
  review: OutboundReview;
  /** Label of the final action, for example "Send" or "Continue in Messages". */
  approveLabel: string;
  /** True while the approved text is being sent. Review loading is shown by the caller. */
  busy: boolean;
  busyLabel: string;
  error?: string | null;
  /** `editUnreviewedAck` is true only when the parent chose to use an edit Sage has not read. */
  onApprove: (finalText: string, options?: { editUnreviewedAck?: boolean }) => void;
  /**
   * Review text the parent changed after Sage's review. When given, changed text needs this
   * review or the parent's explicit choice to use it without one.
   */
  onReviewEdit?: (text: string) => void;
  /** True while the edit is being reviewed. */
  reviewingEdit?: boolean;
  onCancel: () => void;
  onDiscard?: () => void;
  /** Extra controls such as an emergency flag. They sit above the final action. */
  children?: ReactNode;
};

/** The field starts as the version that used to be preselected. An insult-only draft starts empty. */
function sendFieldSeed(review: OutboundReview): string {
  if (review.status === "suggestion") return review.suggestion;
  if (review.status === "no_message") return "";
  return review.original;
}

/**
 * The review step for an outgoing message. Used by Messages and Sage Chats.
 * Nothing is sent until the parent presses the final action. The field's contents are what would be sent.
 */
export function OutboundReviewPanel({
  review,
  approveLabel,
  busy,
  busyLabel,
  error,
  onApprove,
  onReviewEdit,
  reviewingEdit = false,
  onCancel,
  onDiscard,
  children,
}: Props) {
  const [text, setText] = useState(() => sendFieldSeed(review));
  const finalText = exactReviewText(text);
  // Text the review did not read needs its own review or the parent's explicit choice.
  const unreviewedEdit = Boolean(onReviewEdit && finalText && !reviewCoversText(review, finalText));
  const locked = busy || reviewingEdit;
  const reviewLine =
    review.status === "suggestion"
      ? null
      : review.status === "no_change"
        ? "Sage reviewed your message and suggests no changes."
        : review.explanation;

  return (
    <div className="mb-3 rounded-2xl border border-[#E8E4DC] bg-[#FDFBF7] px-3 py-2 text-[11px] text-[#3D3D3D]">
      {reviewLine ? <p className="mb-2 text-[11px] text-[#3D3D3D]">{reviewLine}</p> : null}

      <div className="mb-2 space-y-1">
        <label
          htmlFor="outbound-final-text"
          className="text-[10px] font-semibold uppercase tracking-wide text-[#8A8A8A]"
        >
          This exact text will be sent
        </label>
        <Textarea
          id="outbound-final-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          disabled={locked}
          placeholder={
            review.status === "no_message" ? "What do you want your co-parent to know or do?" : undefined
          }
          data-testid="outbound-final-text"
          className="min-h-[64px] resize-none rounded-xl border border-[#7C8B6E] bg-white text-[11px] text-[#3D3D3D]"
        />
      </div>

      {unreviewedEdit ? (
        <p className="mb-1 text-[11px] text-[#8A6A2F]" data-testid="outbound-edit-unreviewed">
          Sage has not read this edited text. Review it first, or choose to use it without another review.
        </p>
      ) : null}
      {children}
      {error ? <p className="mb-1 text-[11px] text-[#C7524A]">{error}</p> : null}

      <div className="mt-2 flex items-center justify-between gap-2">
        {onDiscard ? (
          <button
            type="button"
            className="text-[11px] text-[#8A8A8A] hover:text-[#C7524A] hover:underline"
            onClick={onDiscard}
            disabled={busy}
          >
            Discard
          </button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 rounded-full text-[11px]"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </Button>
          {unreviewedEdit ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 rounded-full text-[11px]"
                disabled={locked || !finalText}
                onClick={() => {
                  if (finalText) onApprove(finalText, { editUnreviewedAck: true });
                }}
              >
                {busy ? busyLabel : `${approveLabel} without another review`}
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-7 rounded-full bg-[#5B7A52] text-[11px] text-white hover:bg-[#476242]"
                disabled={locked || !finalText}
                onClick={() => {
                  if (finalText && onReviewEdit) onReviewEdit(finalText);
                }}
              >
                {reviewingEdit ? "Reviewing..." : "Review my edit"}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              size="sm"
              className="h-7 rounded-full bg-[#5B7A52] text-[11px] text-white hover:bg-[#476242]"
              disabled={locked || !finalText}
              onClick={() => {
                if (finalText) onApprove(finalText);
              }}
            >
              {busy ? busyLabel : approveLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
