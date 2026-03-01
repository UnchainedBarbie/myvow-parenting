"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Filter } from "lucide-react";
import { cn } from "@/lib/utils";

export type TitleSortValue = "title_asc" | "title_desc";

interface TitleFilterPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  /** Current sort (may be date or title); used to init local sort when opening. */
  currentSort: string;
  onApply: (value: string, titleSort: TitleSortValue) => void;
  onClear: () => void;
  active: boolean;
  triggerClassName?: string;
}

export function TitleFilterPopover({
  open,
  onOpenChange,
  value,
  currentSort,
  onApply,
  onClear,
  active,
  triggerClassName,
}: TitleFilterPopoverProps) {
  const [local, setLocal] = useState(value);
  const [localSort, setLocalSort] = useState<TitleSortValue>("title_asc");

  useEffect(() => {
    if (open) {
      setLocal(value);
      setLocalSort(
        currentSort === "title_asc" || currentSort === "title_desc"
          ? currentSort
          : "title_asc"
      );
    }
  }, [open, value, currentSort]);

  function handleApply() {
    onApply(local.trim(), localSort);
    onOpenChange(false);
  }

  function handleClear() {
    onClear();
    setLocal("");
    setLocalSort("title_asc");
    onOpenChange(false);
  }

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
          aria-label="Filter and sort by title"
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
      <DropdownMenuContent align="start" className="w-64 p-0" sideOffset={6}>
        <div className="p-3">
          <h3 className="font-heading text-sm font-medium text-foreground mb-2">
            Title
          </h3>
          <Input
            type="text"
            placeholder="Filter title…"
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleApply()}
            className="h-8 text-xs mb-3"
            aria-label="Filter title"
          />
          <div className="mb-3">
            <p className="text-xs font-medium text-foreground mb-1.5">Sort</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setLocalSort("title_asc")}
                className={cn(
                  "flex-1 rounded-card border px-2 py-1.5 text-xs font-medium transition-colors",
                  localSort === "title_asc"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background hover:bg-muted/50 text-foreground-secondary"
                )}
              >
                A → Z
              </button>
              <button
                type="button"
                onClick={() => setLocalSort("title_desc")}
                className={cn(
                  "flex-1 rounded-card border px-2 py-1.5 text-xs font-medium transition-colors",
                  localSort === "title_desc"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background hover:bg-muted/50 text-foreground-secondary"
                )}
              >
                Z → A
              </button>
            </div>
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
