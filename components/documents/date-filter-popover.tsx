"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Filter } from "lucide-react";
import { cn } from "@/lib/utils";

/** YYYY-MM-DD or "" */
export type DateFilterValue = { startDate: string; endDate: string };

const QUICK_FILTERS: { id: string; label: string; getRange?: () => DateFilterValue }[] = [
  {
    id: "all",
    label: "All time",
    getRange: undefined,
  },
  {
    id: "today",
    label: "Today",
    getRange: () => {
      const d = new Date();
      const s = toYYYYMMDD(d);
      return { startDate: s, endDate: s };
    },
  },
  {
    id: "last7",
    label: "Last 7 days",
    getRange: () => {
      const end = new Date();
      const start = new Date(end);
      start.setDate(start.getDate() - 6);
      return { startDate: toYYYYMMDD(start), endDate: toYYYYMMDD(end) };
    },
  },
  {
    id: "last30",
    label: "Last 30 days",
    getRange: () => {
      const end = new Date();
      const start = new Date(end);
      start.setDate(start.getDate() - 29);
      return { startDate: toYYYYMMDD(start), endDate: toYYYYMMDD(end) };
    },
  },
  {
    id: "month",
    label: "This month",
    getRange: () => {
      const end = new Date();
      const start = new Date(end.getFullYear(), end.getMonth(), 1);
      return { startDate: toYYYYMMDD(start), endDate: toYYYYMMDD(end) };
    },
  },
  {
    id: "year",
    label: "This year",
    getRange: () => {
      const end = new Date();
      const start = new Date(end.getFullYear(), 0, 1);
      return { startDate: toYYYYMMDD(start), endDate: toYYYYMMDD(end) };
    },
  },
];

function toYYYYMMDD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

interface DateFilterPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  startDate: string;
  endDate: string;
  onApply: (value: DateFilterValue) => void;
  onClear: () => void;
  active: boolean;
  triggerClassName?: string;
}

export function DateFilterPopover({
  open,
  onOpenChange,
  startDate,
  endDate,
  onApply,
  onClear,
  active,
  triggerClassName,
}: DateFilterPopoverProps) {
  const [localStart, setLocalStart] = useState(startDate);
  const [localEnd, setLocalEnd] = useState(endDate);

  useEffect(() => {
    if (open) {
      setLocalStart(startDate);
      setLocalEnd(endDate);
    }
  }, [open, startDate, endDate]);

  function handleQuickFilter(getRange?: () => DateFilterValue) {
    if (!getRange) {
      onClear();
      onOpenChange(false);
      return;
    }
    const next = getRange();
    onApply(next);
    onOpenChange(false);
  }

  function handleApply() {
    onApply({ startDate: localStart, endDate: localEnd });
    onOpenChange(false);
  }

  function handleClear() {
    onClear();
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
          aria-label="Filter by date"
        >
          <Filter className={cn("h-3.5 w-3.5", active && "fill-current")} />
          {active && (
            <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-primary/80" aria-hidden />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72 p-0" sideOffset={6}>
        <div className="p-3">
          <h3 className="font-heading text-sm font-medium text-foreground mb-3">Date uploaded</h3>

          <section className="mb-4">
            <p className="text-xs text-foreground-secondary mb-2">Quick filters</p>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_FILTERS.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => handleQuickFilter(q.getRange)}
                  className="rounded-md px-2 py-1.5 text-xs bg-background-secondary/80 text-foreground hover:bg-muted border border-border"
                >
                  {q.label}
                </button>
              ))}
            </div>
          </section>

          <section className="mb-4">
            <p className="text-xs text-foreground-secondary mb-2">Custom range</p>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex-1 min-w-[120px]">
                <Label htmlFor="date-filter-start" className="text-xs sr-only">Start date</Label>
                <Input
                  id="date-filter-start"
                  type="date"
                  value={localStart}
                  onChange={(e) => setLocalStart(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <span className="text-foreground-secondary text-xs">→</span>
              <div className="flex-1 min-w-[120px]">
                <Label htmlFor="date-filter-end" className="text-xs sr-only">End date</Label>
                <Input
                  id="date-filter-end"
                  type="date"
                  value={localEnd}
                  onChange={(e) => setLocalEnd(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            </div>
          </section>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" className="rounded-full h-8 text-xs" onClick={handleClear}>
              Clear
            </Button>
            <Button size="sm" className="rounded-full h-8 text-xs" onClick={handleApply}>
              Apply
            </Button>
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
