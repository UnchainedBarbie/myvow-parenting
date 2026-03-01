"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Filter } from "lucide-react";
import { cn } from "@/lib/utils";

export type ColumnFilterOption = { value: string; label: string };

interface ColumnFilterPopoverProps {
  title: string;
  options: ColumnFilterOption[];
  selected: string[];
  onApply: (selected: string[]) => void;
  onClear: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  active: boolean;
  triggerClassName?: string;
  /** Optional: value to use for "no selection" (e.g. No child) */
  noneValue?: string;
  noneLabel?: string;
  /** Optional: label for the "select all" option (default: All) */
  allLabel?: string;
  /** Optional: Tailwind dot class (e.g. bg-red-400) per option value for a colored dot before the label */
  getOptionDotClass?: (value: string) => string | undefined;
}

export function ColumnFilterPopover({
  title,
  options,
  selected,
  onApply,
  onClear,
  open,
  onOpenChange,
  active,
  triggerClassName,
  noneValue,
  noneLabel,
  allLabel = "All",
  getOptionDotClass,
}: ColumnFilterPopoverProps) {
  const [local, setLocal] = useState<string[]>(selected);

  useEffect(() => {
    if (open) setLocal(selected);
  }, [open, selected]);

  function toggle(v: string) {
    setLocal((prev) =>
      prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]
    );
  }

  function toggleAll() {
    const allValues = options.map((o) => o.value);
    if (noneValue) allValues.push(noneValue);
    const allSelected =
      allValues.length > 0 &&
      allValues.every((v) => local.includes(v));
    if (allSelected) setLocal([]);
    else setLocal(allValues);
  }

  function handleApply() {
    onApply(local);
    onOpenChange(false);
  }

  function handleClear() {
    onClear();
    onOpenChange(false);
  }

  const allValues = options.map((o) => o.value);
  if (noneValue) allValues.push(noneValue);
  const isAllSelected =
    allValues.length === 0 || allValues.every((v) => local.includes(v));

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "relative inline-flex items-center justify-center rounded p-1 text-foreground-secondary hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            active && "text-foreground",
            triggerClassName
          )}
          aria-label={`Filter by ${title}`}
        >
          <Filter className={cn("h-3.5 w-3.5", active && "fill-current")} />
          {active && (
            <span
              className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-primary/80"
              aria-hidden
            />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56 p-0" sideOffset={6}>
        <div className="p-3">
          <h3 className="font-heading text-sm font-medium text-foreground mb-2">
            {title}
          </h3>
          <div className="max-h-48 overflow-y-auto space-y-1.5 mb-3">
            <label className="flex items-center gap-2 cursor-pointer text-xs">
              <input
                type="checkbox"
                checked={isAllSelected}
                onChange={toggleAll}
                className="rounded border-border"
              />
              {allLabel}
            </label>
            {noneValue != null && noneLabel != null && (
              <label className="flex items-center gap-2 cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={local.includes(noneValue)}
                  onChange={() => toggle(noneValue)}
                  className="rounded border-border"
                />
                {noneLabel}
              </label>
            )}
            {options.map((opt) => {
              const dotClass = getOptionDotClass?.(opt.value);
              return (
                <label
                  key={opt.value}
                  className="flex items-center gap-2 cursor-pointer text-xs"
                >
                  <input
                    type="checkbox"
                    checked={local.includes(opt.value)}
                    onChange={() => toggle(opt.value)}
                    className="rounded border-border"
                  />
                  {dotClass != null ? (
                    <>
                      <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", dotClass)} aria-hidden />
                      {opt.label}
                    </>
                  ) : (
                    opt.label
                  )}
                </label>
              );
            })}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full h-8 text-xs"
              onClick={handleClear}
            >
              Clear
            </Button>
            <Button
              size="sm"
              className="rounded-full h-8 text-xs"
              onClick={handleApply}
            >
              Apply
            </Button>
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
