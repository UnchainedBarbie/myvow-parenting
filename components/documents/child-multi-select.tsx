"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, X } from "lucide-react";

export type ChildOption = { id: string; first_name: string };

interface ChildMultiSelectProps {
  children: ChildOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  /** Optional id for the trigger (for form labels). */
  id?: string;
  className?: string;
}

export function ChildMultiSelect({
  children,
  value,
  onChange,
  id,
  className,
}: ChildMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      const el = containerRef.current;
      if (!el || el.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  const label =
    value.length === 0
      ? "No child"
      : value.length === children.length
        ? "All children"
        : children
            .filter((c) => value.includes(c.id))
            .map((c) => c.first_name)
            .join(", ");

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        id={id}
        type="button"
        onClick={() => {
          console.log("DROPDOWN TOGGLED", { wasOpen: open });
          setOpen((prev) => !prev);
        }}
        className={cn(
          "flex h-8 w-full items-center justify-between rounded-card border border-input bg-background px-3 py-1 text-xs text-left",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        )}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-foreground-secondary transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-1 w-56 rounded-card border border-border bg-background p-2 shadow-card"
          role="listbox"
          onClick={(e) => {
            console.log("LISTBOX CONTAINER CLICKED", e.target);
            e.stopPropagation();
          }}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-foreground-secondary">Select children</span>
            <button type="button" onClick={() => setOpen(false)} className="p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div
            role="option"
            aria-selected={children.length > 0 && value.length === children.length}
            className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-muted"
            onClick={(e) => {
              console.log("ALL CHILDREN ROW CLICKED", { currentValue: value, childrenCount: children.length });
              e.stopPropagation();
              if (value.length === children.length) {
                onChange([]);
              } else {
                onChange(children.map((c) => c.id));
              }
            }}
          >
            <input
              type="checkbox"
              checked={children.length > 0 && value.length === children.length}
              onChange={() => {}}
              className="pointer-events-none rounded border-border"
              tabIndex={-1}
              aria-hidden={true}
            />
            <span>All children</span>
          </div>
          {children.map((c) => (
            <div
              key={c.id}
              role="option"
              aria-selected={value.includes(c.id)}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-muted"
              onClick={(e) => {
                console.log("CHILD ROW CLICKED", { childId: c.id, childName: c.first_name });
                e.stopPropagation();
                onChange(
                  value.includes(c.id) ? value.filter((id) => id !== c.id) : [...value, c.id]
                );
              }}
            >
              <input
                type="checkbox"
                checked={value.includes(c.id)}
                onChange={() => {}}
                className="pointer-events-none rounded border-border"
                tabIndex={-1}
                aria-hidden={true}
              />
              <span>{c.first_name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
