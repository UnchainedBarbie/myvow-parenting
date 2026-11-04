"use client";

import { Button } from "@/components/ui/button";

export type ReportChoice = {
  id: string;
  label: string;
};

export function SelectionReportDialog({
  open,
  title,
  countLabel,
  choices,
  selected,
  onToggle,
  onClose,
  onGenerate,
  generating,
  error,
}: {
  open: boolean;
  title: string;
  countLabel: string;
  choices: ReportChoice[];
  selected: Record<string, boolean>;
  onToggle: (id: string) => void;
  onClose: () => void;
  onGenerate: () => void;
  generating: boolean;
  error: string | null;
}) {
  if (!open) return null;
  const anySelected = choices.some((choice) => selected[choice.id]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="selection-report-title"
      onClick={(event) => {
        if (event.target === event.currentTarget && !generating) onClose();
      }}
    >
      <div
        className="bg-background border border-border rounded-card shadow-card max-w-md w-full p-4 space-y-3"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 id="selection-report-title" className="font-heading text-base font-semibold text-foreground">
              {title}
            </h3>
            <p className="text-xs text-foreground-secondary mt-1">{countLabel}</p>
          </div>
          <button
            type="button"
            className="text-xs text-foreground-secondary hover:text-foreground underline"
            onClick={onClose}
            disabled={generating}
          >
            Close
          </button>
        </div>
        <fieldset className="space-y-2" disabled={generating}>
          <legend className="sr-only">Report sections</legend>
          {choices.map((choice) => (
            <label key={choice.id} className="flex items-start gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                className="mt-0.5 rounded border-border accent-[#7B9E87]"
                checked={selected[choice.id] === true}
                onChange={() => onToggle(choice.id)}
              />
              <span>{choice.label}</span>
            </label>
          ))}
        </fieldset>
        {error && (
          <p className="text-sm text-[#7A3434]" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-full px-3 text-xs"
            onClick={onClose}
            disabled={generating}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8 rounded-full bg-[#7B9E87] px-3 text-xs text-white hover:bg-[#6A8A78]"
            onClick={onGenerate}
            disabled={generating || !anySelected}
          >
            {generating ? "Creating report…" : "Create Report"}
          </Button>
        </div>
      </div>
    </div>
  );
}
