"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { OutboundReviewPanel } from "@/components/messages/outbound-review-panel";
import {
  requestEditReview,
  requestOutboundReviewWithReceipt,
  type ReviewedDraft,
} from "@/lib/messages/outbound-review";
import {
  buildProposalSendRequest,
  isAttachmentBlock,
  proposalMessageText,
  routeApprovals,
  type ProposalSendRequest,
  type SendOutcome,
} from "@/lib/messages/proposal-send";
import { draftOriginLabel, proposalListHeading } from "@/lib/messages/message-content";
import { attachmentOutcomeLabel, pendingAttachmentNote } from "@/lib/messages/send-safety";
import {
  isCalendarUpdateProposal,
  isFormExecuteProposal,
  isLogDocumentProposal,
  isLogExpenseProposal,
  isParentClarification,
} from "@/lib/sage/proposal-kind";
import type { SageItem, SageProposal } from "./proposal-types";
import { isSupersededProposal } from "@/lib/sage/proposal-lifecycle";
import { parentProposalStatusMark } from "@/lib/messages/parent-message-visibility";
import {
  calendarCardDate,
  canUndo,
  dateKey,
  displayDraft,
  formatCardDate,
  isActionable,
  isBlocked,
  isCommitted,
  isRevisable,
  isWaived,
  needsDateField,
  proposalTypeLabel,
} from "./proposal-helpers";

export type ProposalCardListProps = {
  itemId: string;
  item?: SageItem | null;
  proposals: SageProposal[];
  /** When true, hide left action controls (item bulk-select mode) */
  hideActions?: boolean;
  /**
   * An earlier transcript render of this item. Shows the original draft
   * and is not actionable. The latest journal row for the item stays live.
   */
  historical?: boolean;
  /** Indent under item icon row (inbox default). Drawer should pass false. */
  indent?: boolean;
  multiSelect?: boolean;
  onToggleMultiSelect?: () => void;
  selectedIndexes?: number[];
  onToggleSelected?: (index: number) => void;
  dates: Record<string, string>;
  onDateChange: (key: string, value: string) => void;
  busyKey: string | null;
  itemBusy?: boolean;
  /**
   * A card that sends a message to the co-parent is reviewed first. `send` then carries the exact
   * approved text and the review proof. The result tells the card whether the message went out.
   */
  onAgree: (indexes: number[], send?: ProposalSendRequest) => Promise<SendOutcome | void> | void;
  /** True where Agree really sends. Sends then wait for the shared outbound review. */
  reviewSends?: boolean;
  onDismiss: (indexes: number[]) => void;
  onUndo: (index: number) => void;
  onRevise?: (index: number, proposal: SageProposal) => void;
  missingRequiredDates?: (indexes: number[]) => boolean;
  /** Proposal index to scroll to and emphasize. Live cards only. */
  emphasisIndex?: number | null;
  className?: string;
};

export function ProposalCardList({
  itemId,
  item,
  proposals,
  hideActions = false,
  historical = false,
  indent = true,
  multiSelect = false,
  onToggleMultiSelect,
  selectedIndexes = [],
  onToggleSelected,
  dates,
  onDateChange,
  busyKey,
  itemBusy = false,
  onAgree,
  reviewSends = false,
  onDismiss,
  onUndo,
  onRevise,
  missingRequiredDates,
  emphasisIndex = null,
  className,
}: ProposalCardListProps) {
  type SendReview = {
    index: number;
    queue: number[];
    reviewed: ReviewedDraft | null;
    sending: boolean;
    error: string | null;
    /** The file cannot be shared. The parent may choose to send the message without it. */
    attachmentBlocked: string | null;
    lastText: string;
    lastEditUnreviewedAck: boolean;
    reviewingEdit: boolean;
  };
  const [sendReview, setSendReview] = useState<SendReview | null>(null);

  async function startReview(queue: number[]) {
    const [index, ...rest] = queue;
    const proposal = proposals[index];
    if (!proposal) return;
    setSendReview({
      index,
      queue: rest,
      reviewed: null,
      sending: false,
      error: null,
      attachmentBlocked: null,
      lastText: "",
      lastEditUnreviewedAck: false,
      reviewingEdit: false,
    });
    const reviewed = await requestOutboundReviewWithReceipt(proposalMessageText(proposal));
    setSendReview((current) => (current && current.index === index ? { ...current, reviewed } : current));
  }

  /** Approving cards. Messages to the co-parent wait for the review. Every other card goes straight through. */
  function requestAgree(indexes: number[]) {
    // A message never goes through onAgree without the review. Where no review can run, it is held.
    const routed = routeApprovals(indexes, proposals, reviewSends);
    if (routed.direct.length > 0) void onAgree(routed.direct);
    if (routed.review.length > 0) void startReview(routed.review);
  }

  /** Text the parent changed after Sage's review gets its own review before it can be sent. */
  async function reviewEdit(text: string) {
    const current = sendReview;
    if (!current?.reviewed || current.sending || current.reviewingEdit) return;
    const index = current.index;
    setSendReview({ ...current, reviewingEdit: true, error: null });
    const reviewed = await requestEditReview(current.reviewed, text);
    setSendReview((latest) =>
      latest && latest.index === index
        ? { ...latest, reviewed, reviewingEdit: false, attachmentBlocked: null }
        : latest
    );
  }

  async function sendReviewed(
    finalText: string,
    acknowledgeAttachmentOmission: boolean,
    editUnreviewedAck = false
  ) {
    const current = sendReview;
    if (!current?.reviewed || current.sending) return;
    setSendReview({
      ...current,
      sending: true,
      error: null,
      attachmentBlocked: null,
      lastText: finalText,
      lastEditUnreviewedAck: editUnreviewedAck,
    });
    const outcome = await onAgree(
      [current.index],
      buildProposalSendRequest({
        proposalIndex: current.index,
        finalText,
        reviewed: current.reviewed,
        acknowledgeAttachmentOmission,
        editUnreviewedAck,
      })
    );
    if (outcome && outcome.ok === false) {
      setSendReview({
        ...current,
        sending: false,
        lastText: finalText,
        lastEditUnreviewedAck: editUnreviewedAck,
        error: isAttachmentBlock(outcome) ? null : outcome.error,
        attachmentBlocked: isAttachmentBlock(outcome) ? outcome.error : null,
      });
      return;
    }
    if (current.queue.length > 0) {
      await startReview(current.queue);
      return;
    }
    setSendReview(null);
  }

  if (proposals.length === 0) return null;

  const visible = proposals
    .map((p, idx) => ({ p, idx }))
    .filter(({ p }) => {
      if ((p.status ?? "").toLowerCase() === "dismissed") return false;
      return !isParentClarification(p) && !(isLogDocumentProposal(p.type) && p.executed === true);
    });
  if (visible.length === 0) return null;

  const suppressActions = hideActions || historical;
  const actionableCount = visible.filter(({ p }) => isActionable(p)).length;
  const checked = selectedIndexes;

  return (
    <div
      className={cn(
        "space-y-2",
        indent && !suppressActions && "ml-9",
        className
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[11px] font-medium text-[#5B7A52]">
          {proposalListHeading(visible.map(({ p }) => p))}
        </p>
        {historical && (
          <span className="text-[10px] text-foreground-secondary">revised below</span>
        )}
        {!suppressActions && actionableCount > 1 && onToggleMultiSelect && (
          <button
            type="button"
            className="text-[11px] text-[#5B7A52] hover:underline"
            onClick={onToggleMultiSelect}
          >
            {multiSelect ? "Single actions" : "Select multiple"}
          </button>
        )}
      </div>

      <ul className="space-y-2">
        {visible.map(({ p, idx }) => {
          const blocked = isBlocked(p);
          const superseded = isSupersededProposal(p);
          const approved = p.approved === true;
          const waived = isWaived(p);
          const executed = p.executed === true;
          const savedMessageId = (p.result_message_id ?? "").trim();
          const done = isCalendarUpdateProposal(p.type)
            ? isCommitted(p)
            : p.type === "reply_coparent"
              ? savedMessageId.length > 0
              : executed;
          const noteOnly = p.type === "note_only";
          const actionable = isActionable(p);
          const showDate = !historical && actionable && needsDateField(p, item);
          const cardDate = calendarCardDate(p);
          const dKey = dateKey(itemId, idx);
          const isChecked = checked.includes(idx);
          const rowBusy = busyKey === `${itemId}:${idx}` || itemBusy;
          const formPending =
            isFormExecuteProposal(p.type) && !done && !waived && !blocked;
          const showUndoOnly = canUndo(p) && !formPending;
          const sendable = p.type === "reply_coparent" && Boolean((p.recipient_email ?? "").trim());
          // A message on a surface that cannot run the review is shown, never approved or sent from here.
          const heldMessage = sendable && !reviewSends && !done;
          // Once a message is sent its text is whatever the parent approved, so no author is claimed.
          const originLabel = p.type === "reply_coparent" && !done ? draftOriginLabel(p) : null;

          return (
            <li
              key={`${itemId}-p-${idx}`}
              id={historical ? undefined : `sage-proposal-${itemId}-${idx}`}
              className={cn(
                "flex items-start gap-2 rounded-md px-2 py-1.5",
                (blocked || superseded) && "bg-[#F7F5F0] opacity-80",
                !historical && emphasisIndex === idx && "ring-2 ring-[#7C8B6E]"
              )}
            >
              {/* Left controls — hidden in item bulk-select mode */}
              {suppressActions ? null : noteOnly || blocked || superseded ? (
                <span className="mt-0.5 w-12 shrink-0" aria-hidden />
              ) : showUndoOnly ? (
                <button
                  type="button"
                  className="mt-0.5 shrink-0 text-[10px] text-[#5B7A52] hover:underline disabled:opacity-40"
                  disabled={rowBusy}
                  onClick={() => onUndo(idx)}
                >
                  Undo
                </button>
              ) : heldMessage ? (
                <div className="flex shrink-0 items-start gap-1">
                  <button
                    type="button"
                    title="Cancel"
                    aria-label="Cancel message"
                    disabled={rowBusy}
                    className="inline-flex h-6 items-center justify-center rounded-full border border-[#D5D0C6] bg-white px-2 text-[11px] text-foreground-secondary hover:bg-[#F2F5EF] disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => onDismiss([idx])}
                  >
                    Cancel
                  </button>
                </div>
              ) : multiSelect ? (
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0 rounded border-[#C5D0C0] accent-[#7B9E87]"
                  checked={isChecked}
                  disabled={rowBusy}
                  onChange={() => onToggleSelected?.(idx)}
                  aria-label={`Select: ${proposalTypeLabel(p.type, p)}`}
                />
              ) : (
                <div className="flex shrink-0 items-start gap-1">
                  <button
                    type="button"
                    title={sendable ? "Send" : "Agree"}
                    aria-label={sendable ? "Send message" : "Agree"}
                    disabled={
                      rowBusy || (showDate && !(dates[dKey] ?? "").trim())
                    }
                    className={cn(
                      "inline-flex h-6 items-center justify-center rounded-full text-[11px] font-medium",
                      sendable ? "px-2" : "w-6",
                      "bg-[#7B9E87] text-white hover:bg-[#6A8A78]",
                      "disabled:opacity-40 disabled:cursor-not-allowed"
                    )}
                    onClick={() => requestAgree([idx])}
                  >
                    {sendable ? "Send" : "✓"}
                  </button>
                  {isRevisable(p) && onRevise && (
                    <button
                      type="button"
                      title="Revise"
                      disabled={rowBusy}
                      className={cn(
                        "inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px]",
                        "border border-[#D5D0C6] bg-white text-foreground-secondary hover:bg-[#F2F5EF]",
                        "disabled:opacity-40 disabled:cursor-not-allowed"
                      )}
                      onClick={() => onRevise(idx, p)}
                    >
                      ✏️
                    </button>
                  )}
                  <button
                    type="button"
                    title={sendable ? "Cancel" : "Dismiss"}
                    aria-label={sendable ? "Cancel message" : "Dismiss"}
                    disabled={rowBusy}
                    className={cn(
                      "inline-flex h-6 items-center justify-center rounded-full text-[11px]",
                      sendable ? "px-2" : "w-6",
                      "border border-[#D5D0C6] bg-white text-foreground-secondary hover:bg-[#F2F5EF]",
                      "disabled:opacity-40 disabled:cursor-not-allowed"
                    )}
                    onClick={() => onDismiss([idx])}
                  >
                    {sendable ? "Cancel" : "✗"}
                  </button>
                </div>
              )}

              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center rounded-full bg-[#EEF2E9] px-2 py-0.5 text-[10px] font-medium text-[#5B7A52]">
                    {proposalTypeLabel(p.type, p)}
                  </span>
                  {!historical && done ? (
                    <span className="text-[10px] font-medium text-[#5B7A52]">
                      {isLogExpenseProposal(p.type)
                        ? "✓ done"
                        : isCalendarUpdateProposal(p.type)
                          ? p.calendar_intent === "update"
                            ? "✓ done · updated on calendar"
                            : "✓ done · added to calendar"
                          : isLogDocumentProposal(p.type)
                            ? "✓ filed"
                            : p.type === "reply_coparent"
                              ? parentProposalStatusMark({
                                  deliveryStatus: p.delivery_status,
                                  deliveredAt: p.delivered_at,
                                })
                              : "✓ done"}
                    </span>
                  ) : !historical && approved && !formPending ? (
                    <span className="text-[10px] font-medium text-[#5B7A52]">
                      ✓ approved
                    </span>
                  ) : null}
                  {!historical &&
                    !superseded &&
                    typeof p.revised_text === "string" &&
                    p.revised_text.trim() &&
                    !approved &&
                    !waived && (
                      <span className="text-[10px] text-[#5B7A52]">
                        revised
                      </span>
                    )}
                  {superseded && (
                    <span className="text-[10px] text-foreground-secondary">
                      Superseded
                    </span>
                  )}
                  {waived && (
                    <span className="text-[10px] text-foreground-secondary">
                      {(p.status ?? "").toLowerCase() === "canceled" ? "canceled" : "dismissed"}
                    </span>
                  )}
                  {blocked && !approved && !waived && (
                    <span className="text-[10px] text-foreground-secondary">
                      waiting on: {p.depends_on}
                    </span>
                  )}
                </div>
                {p.type === "reply_coparent" && (p.recipient_name || p.recipient_email) ? (
                  <p className="text-[11px] leading-snug text-foreground-secondary break-words">
                    To: {p.recipient_name || "Co-parent"}
                    {p.recipient_email ? ` · ${p.recipient_email}` : ""}
                    {p.subject ? ` · ${p.subject}` : ""}
                  </p>
                ) : null}
                {p.type === "reply_coparent" && p.attached_file_name ? (
                  <p
                    className="text-[11px] leading-snug text-foreground-secondary break-words"
                    data-testid="proposal-attachment-note"
                  >
                    {attachmentOutcomeLabel(p.attachment_delivery) ??
                      pendingAttachmentNote(p.attached_file_name)}
                  </p>
                ) : p.attached_file_name ? (
                  <p className="text-[11px] leading-snug text-foreground-secondary break-words">
                    Attachment: {p.attached_file_name}
                  </p>
                ) : null}
                {originLabel ? (
                  <p
                    className="text-[10px] font-semibold uppercase tracking-wide text-[#8A8A8A]"
                    data-testid="proposal-draft-origin"
                  >
                    {originLabel}
                  </p>
                ) : null}
                <p
                  className={cn(
                    "text-[12px] leading-snug text-foreground",
                    (blocked || waived || superseded) && "text-foreground-secondary"
                  )}
                >
                  {historical ? (p.draft ?? "").trim() : displayDraft(p, showDate)}
                </p>
                {heldMessage && !historical ? (
                  <p
                    className="text-[11px] leading-snug text-foreground-secondary"
                    data-testid="proposal-review-elsewhere"
                  >
                    Nothing is sent from here. Open Sage Chats to review this message and send it.
                  </p>
                ) : null}
                {p.type === "log_expense" && p.split_review?.trim() ? (
                  <p className="text-[11px] leading-snug text-foreground-secondary">
                    {p.split_review.trim()}
                  </p>
                ) : null}
                {!suppressActions && showDate && (
                  <input
                    type="date"
                    className="mt-1 h-7 rounded-md border border-[#E8E4DC] bg-white px-2 text-[11px] text-foreground"
                    value={dates[dKey] ?? ""}
                    onChange={(e) => onDateChange(dKey, e.target.value)}
                    aria-label="Choose date for calendar update"
                  />
                )}
                {cardDate ? (
                  <span className="text-[10px] text-foreground-secondary">
                    date: {formatCardDate(cardDate)}
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {sendReview ? (
        <div className="space-y-1" data-testid="proposal-send-review">
          {sendReview.reviewed ? (
            <OutboundReviewPanel
              key={`${sendReview.index}:${sendReview.reviewed.review.status}:${sendReview.reviewed.review.original}:${sendReview.reviewed.receipt ?? ""}`}
              review={sendReview.reviewed.review}
              approveLabel="Send"
              busy={sendReview.sending}
              busyLabel="Sending…"
              error={sendReview.error}
              onApprove={(text, options) => void sendReviewed(text, false, options?.editUnreviewedAck === true)}
              onReviewEdit={sendReview.reviewed.receipt ? (text) => void reviewEdit(text) : undefined}
              reviewingEdit={sendReview.reviewingEdit}
              onCancel={() => setSendReview(null)}
            >
              {proposals[sendReview.index]?.attached_file_name ? (
                <p className="mb-1 text-[11px] text-[#3D3D3D]">
                  {pendingAttachmentNote(proposals[sendReview.index].attached_file_name as string)}
                </p>
              ) : null}
              {sendReview.attachmentBlocked ? (
                <div className="mb-1 space-y-1 rounded-xl border border-[#E8D9B5] bg-[#FDF6E3] px-2.5 py-2 text-[11px]">
                  <p>{sendReview.attachmentBlocked}</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 rounded-full text-[11px]"
                    disabled={sendReview.sending}
                    onClick={() => void sendReviewed(sendReview.lastText, true, sendReview.lastEditUnreviewedAck)}
                  >
                    Send without the file
                  </Button>
                </div>
              ) : null}
            </OutboundReviewPanel>
          ) : (
            <p className="text-[11px] text-foreground-secondary">
              Sage is reviewing your message. Nothing has been sent.
            </p>
          )}
        </div>
      ) : null}

      {!suppressActions && multiSelect && actionableCount > 1 && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            className="h-7 rounded-full px-3 text-[11px] bg-[#7B9E87] text-white hover:bg-[#6A8A78] disabled:opacity-50"
            disabled={
              checked.length === 0 ||
              itemBusy ||
              (missingRequiredDates?.(checked) ?? false)
            }
            onClick={() => requestAgree(checked)}
          >
            Agree
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 rounded-full px-3 text-[11px] disabled:opacity-50"
            disabled={checked.length === 0 || itemBusy}
            onClick={() => onDismiss(checked)}
          >
            Dismiss
          </Button>
        </div>
      )}
    </div>
  );
}
