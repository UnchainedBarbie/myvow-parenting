"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  isCalendarUpdateProposal,
  isFormExecuteProposal,
  isLogDocumentProposal,
  isLogExpenseProposal,
  isParentClarification,
} from "@/lib/sage/proposal-kind";
import type { SageItem, SageProposal } from "./proposal-types";
import { isSupersededProposal } from "@/lib/sage/proposal-lifecycle";
import {
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
  onAgree: (indexes: number[]) => void;
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
  onDismiss,
  onUndo,
  onRevise,
  missingRequiredDates,
  emphasisIndex = null,
  className,
}: ProposalCardListProps) {
  if (proposals.length === 0) return null;

  const visible = proposals
    .map((p, idx) => ({ p, idx }))
    .filter(({ p }) => !isParentClarification(p) && !(isLogDocumentProposal(p.type) && p.executed === true));
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
        <p className="text-[11px] font-medium text-[#5B7A52]">Sage suggests</p>
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
          const done = isCalendarUpdateProposal(p.type) ? isCommitted(p) : executed;
          const noteOnly = p.type === "note_only";
          const actionable = isActionable(p);
          const showDate = !historical && actionable && needsDateField(p, item);
          const dKey = dateKey(itemId, idx);
          const isChecked = checked.includes(idx);
          const rowBusy = busyKey === `${itemId}:${idx}` || itemBusy;
          const formPending =
            isFormExecuteProposal(p.type) && !done && !waived && !blocked;
          const showUndoOnly = canUndo(p) && !formPending;
          const sendable = p.type === "reply_coparent" && Boolean((p.recipient_email ?? "").trim());

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
                    onClick={() => onAgree([idx])}
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
                              ? p.delivery_status === "delivered"
                                ? "✓ delivered"
                                : "✓ sent"
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
                <p
                  className={cn(
                    "text-[12px] leading-snug text-foreground",
                    (blocked || waived || superseded) && "text-foreground-secondary"
                  )}
                >
                  {historical ? (p.draft ?? "").trim() : displayDraft(p, showDate)}
                </p>
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
                {isCalendarUpdateProposal(p.type) && (p.chosen_date || p.date) ? (
                  <span className="text-[10px] text-foreground-secondary">
                    date: {formatCardDate((p.chosen_date || p.date || "").trim())}
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

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
            onClick={() => onAgree(checked)}
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
