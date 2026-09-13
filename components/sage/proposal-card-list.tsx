"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SageItem, SageProposal } from "./proposal-types";
import {
  canUndo,
  dateKey,
  displayDraft,
  isActionable,
  isBlocked,
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
  className?: string;
};

export function ProposalCardList({
  itemId,
  item,
  proposals,
  hideActions = false,
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
  className,
}: ProposalCardListProps) {
  if (proposals.length === 0) return null;

  const actionableCount = proposals.filter(isActionable).length;
  const checked = selectedIndexes;

  return (
    <div
      className={cn(
        "space-y-2",
        indent && !hideActions && "ml-9",
        className
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[11px] font-medium text-[#5B7A52]">Sage suggests</p>
        {!hideActions && actionableCount > 1 && onToggleMultiSelect && (
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
        {proposals.map((p, idx) => {
          const blocked = isBlocked(p);
          const approved = p.approved === true;
          const waived = isWaived(p);
          const executed = p.executed === true;
          const noteOnly = p.type === "note_only";
          const actionable = isActionable(p);
          const showDate = actionable && needsDateField(p, item);
          const dKey = dateKey(itemId, idx);
          const isChecked = checked.includes(idx);
          const rowBusy = busyKey === `${itemId}:${idx}` || itemBusy;

          return (
            <li
              key={`${itemId}-p-${idx}`}
              className={cn(
                "flex items-start gap-2 rounded-md px-2 py-1.5",
                blocked && "bg-[#F7F5F0] opacity-80"
              )}
            >
              {/* Left controls — hidden in item bulk-select mode */}
              {hideActions ? null : noteOnly || blocked ? (
                <span className="mt-0.5 w-12 shrink-0" aria-hidden />
              ) : canUndo(p) ? (
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
                  aria-label={`Select: ${proposalTypeLabel(p.type)}`}
                />
              ) : (
                <div className="flex shrink-0 items-start gap-1">
                  <button
                    type="button"
                    title="Agree"
                    disabled={
                      rowBusy || (showDate && !(dates[dKey] ?? "").trim())
                    }
                    className={cn(
                      "inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-medium",
                      "bg-[#7B9E87] text-white hover:bg-[#6A8A78]",
                      "disabled:opacity-40 disabled:cursor-not-allowed"
                    )}
                    onClick={() => onAgree([idx])}
                  >
                    ✓
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
                    title="Dismiss"
                    disabled={rowBusy}
                    className={cn(
                      "inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px]",
                      "border border-[#D5D0C6] bg-white text-foreground-secondary hover:bg-[#F2F5EF]",
                      "disabled:opacity-40 disabled:cursor-not-allowed"
                    )}
                    onClick={() => onDismiss([idx])}
                  >
                    ✗
                  </button>
                </div>
              )}

              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center rounded-full bg-[#EEF2E9] px-2 py-0.5 text-[10px] font-medium text-[#5B7A52]">
                    {proposalTypeLabel(p.type)}
                  </span>
                  {executed ? (
                    <span className="text-[10px] font-medium text-[#5B7A52]">
                      ✓ done · added to calendar
                    </span>
                  ) : approved ? (
                    <span className="text-[10px] font-medium text-[#5B7A52]">
                      ✓ approved
                    </span>
                  ) : null}
                  {typeof p.revised_text === "string" &&
                    p.revised_text.trim() &&
                    !approved &&
                    !waived && (
                      <span className="text-[10px] text-[#5B7A52]">
                        revised
                      </span>
                    )}
                  {waived && (
                    <span className="text-[10px] text-foreground-secondary">
                      dismissed
                    </span>
                  )}
                  {blocked && !approved && !waived && (
                    <span className="text-[10px] text-foreground-secondary">
                      waiting on: {p.depends_on}
                    </span>
                  )}
                </div>
                <p
                  className={cn(
                    "text-[12px] leading-snug text-foreground",
                    (blocked || waived) && "text-foreground-secondary"
                  )}
                >
                  {displayDraft(p, showDate)}
                </p>
                {!hideActions && showDate && (
                  <input
                    type="date"
                    className="mt-1 h-7 rounded-md border border-[#E8E4DC] bg-white px-2 text-[11px] text-foreground"
                    value={dates[dKey] ?? ""}
                    onChange={(e) => onDateChange(dKey, e.target.value)}
                    aria-label="Choose date for calendar update"
                  />
                )}
                {p.chosen_date && (
                  <span className="text-[10px] text-foreground-secondary">
                    date: {p.chosen_date}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {!hideActions && multiSelect && actionableCount > 1 && (
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
