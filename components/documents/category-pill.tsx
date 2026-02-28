"use client";

import { cn } from "@/lib/utils";
import { getCategoryColor } from "@/lib/categoryColors";

interface CategoryPillProps {
  category: string | null | undefined;
  label: string;
  className?: string;
}

/**
 * Renders a subtle category pill using the shared category color palette.
 * Color is not the only signal: the label is always visible for accessibility and court export.
 */
export function CategoryPill({ category, label, className }: CategoryPillProps) {
  const colors = getCategoryColor(category);
  return (
    <span
      className={cn(
        "inline-block px-2 py-0.5 rounded-full text-xs font-medium",
        colors.pillBgClass,
        colors.pillTextClass,
        className
      )}
    >
      {label}
    </span>
  );
}
