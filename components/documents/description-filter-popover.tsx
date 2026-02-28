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

interface DescriptionFilterPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onApply: (value: string) => void;
  onClear: () => void;
  active: boolean;
  triggerClassName?: string;
}

export function DescriptionFilterPopover({
  open,
  onOpenChange,
  value,
  onApply,
  onClear,
  active,
  triggerClassName,
}: DescriptionFilterPopoverProps) {
  const [local, setLocal] = useState(value);

  useEffect(() => {
    if (open) setLocal(value);
  }, [open, value]);

  function handleApply() {
    onApply(local.trim());
    onOpenChange(false);
  }

  function handleClear() {
    onClear();
    setLocal("");
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
          aria-label="Filter by description"
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
            Description
          </h3>
          <Input
            type="text"
            placeholder="Filter description…"
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleApply()}
            className="h-8 text-xs mb-3"
            aria-label="Filter description"
          />
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
