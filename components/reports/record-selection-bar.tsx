"use client";

import type { LucideIcon } from "lucide-react";
import { Trash2 } from "lucide-react";

export type SelectionAction = {
  label: string;
  hint: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  busyLabel?: string;
};

export function RecordSelectionBar({
  count,
  actions,
  onDelete,
  deleting,
}: {
  count: number;
  actions: SelectionAction[];
  onDelete: () => void;
  deleting?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 py-2 px-3 rounded-card border border-border bg-background-secondary/60">
      <span className="text-xs text-foreground-secondary shrink-0">{count} selected</span>
      <div className="flex flex-wrap items-stretch gap-2">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.label}
              type="button"
              onClick={action.onClick}
              disabled={action.disabled || deleting}
              className="flex min-w-[9.5rem] flex-col items-start rounded-card border border-[#C5D0C0] bg-white px-2.5 py-1.5 text-left hover:bg-[#F7F5F0] disabled:opacity-60"
            >
              <span className="inline-flex items-center gap-1 text-xs font-medium text-[#5B7A52]">
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {action.disabled && action.busyLabel ? action.busyLabel : action.label}
              </span>
              <span className="text-[11px] leading-tight text-foreground-secondary">{action.hint}</span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onDelete}
        disabled={deleting}
        className="ml-auto inline-flex items-center gap-1 text-xs text-red-600/90 hover:text-red-700 hover:underline disabled:opacity-60"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
        {deleting ? "Deleting…" : "Delete"}
      </button>
    </div>
  );
}
