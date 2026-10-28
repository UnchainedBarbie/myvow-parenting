"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  reviewDefaultChoice,
  reviewEditSeed,
  reviewCoversText,
  reviewFinalText,
  type OutboundReview,
  type ReviewChoice,
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

/**
 * The review step for an outgoing message. Used by Messages and Sage Chats.
 * Nothing is sent until the parent selects a version and presses the final action.
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
  const [choice, setChoice] = useState<ReviewChoice>(() => reviewDefaultChoice(review));
  const [edited, setEdited] = useState(() => reviewEditSeed(review));
  const finalText = reviewFinalText({ review, choice, edited });
  // Text the review did not read needs its own review or the parent's explicit choice.
  const unreviewedEdit = Boolean(onReviewEdit && finalText && !reviewCoversText(review, finalText));
  const locked = busy || reviewingEdit;

  const radio = (value: Exclude<ReviewChoice, null>, label: string) => (
    <label className="flex items-center gap-1 text-[11px]">
      <input
        type="radio"
        name="outbound-review-choice"
        className="h-3 w-3"
        checked={choice === value}
        disabled={locked}
        onChange={() => setChoice(value)}
      />
      <span>{label}</span>
    </label>
  );

  return (
    <div className="mb-3 rounded-2xl border border-[#E8E4DC] bg-[#FDFBF7] px-3 py-2 text-[11px] text-[#3D3D3D]">
      {review.status === "suggestion" ? (
        <div className="mb-2 grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8A8A8A]">Your draft</p>
            <div className="min-h-[64px] whitespace-pre-wrap rounded-xl border border-[#E8E4DC] bg-white px-2.5 py-2">
              {review.original}
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8A8A8A]">Sage version</p>
            <div className="min-h-[64px] whitespace-pre-wrap rounded-xl border border-[#E8E4DC] bg-[#F9F6F0] px-2.5 py-2">
              {review.suggestion}
            </div>
          </div>
        </div>
      ) : (
        <div className="mb-2 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8A8A8A]">Your draft</p>
          <div className="whitespace-pre-wrap rounded-xl border border-[#E8E4DC] bg-white px-2.5 py-2">
            {review.original}
          </div>
          <p className="text-[11px] text-[#3D3D3D]">
            {review.status === "no_change"
              ? "Sage reviewed your message and suggests no changes."
              : review.explanation}
          </p>
        </div>
      )}

      <div className="mb-2 space-y-1">
        {review.status === "suggestion" ? radio("sage", "Use Sage version") : null}
        {radio("original", "Send my message as written")}
        {radio("edit", review.status === "no_message" ? "Write what I want to say" : "Edit before sending")}
      </div>

      {choice === "edit" ? (
        <Textarea
          value={edited}
          onChange={(e) => setEdited(e.target.value)}
          rows={3}
          disabled={locked}
          placeholder={
            review.status === "no_message" ? "What do you want your co-parent to know or do?" : undefined
          }
          className="mb-2 min-h-[64px] resize-none rounded-xl border border-[#E8E4DC] bg-[#F9F6F0] text-[11px] text-[#3D3D3D]"
        />
      ) : null}

      <div className="mb-2 space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8A8A8A]">
          {finalText ? "This exact text will be sent" : "Choose a version to continue"}
        </p>
        {finalText ? (
          <div
            className="whitespace-pre-wrap rounded-xl border border-[#7C8B6E] bg-white px-2.5 py-2"
            data-testid="outbound-final-text"
          >
            {finalText}
          </div>
        ) : null}
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
