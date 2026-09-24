"use client";

import { useEffect, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Flag,
  MoreVertical,
  PenLine,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { SageSessionRow } from "@/lib/sage-sessions-client";

const MENU_ITEM =
  "flex w-full items-center gap-2 px-3 py-2 text-[13px] text-[#3D3D3D] hover:bg-[#F2F5EF] text-left";

type SageSessionOverflowMenuProps = {
  session: SageSessionRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onArchive: () => void;
  onFlag: () => void;
  onRename: () => void;
  onDelete: () => void;
  alwaysVisible?: boolean;
};

export function SageSessionOverflowMenu({
  session,
  open,
  onOpenChange,
  onArchive,
  onFlag,
  onRename,
  onDelete,
  alwaysVisible = false,
}: SageSessionOverflowMenuProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) {
      setConfirmDelete(false);
      return;
    }
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node | null;
      if (target && rootRef.current?.contains(target)) return;
      onOpenChange(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, onOpenChange]);

  const archived = !!session.archived;
  const flagged = !!session.flagged;

  return (
    <div
      ref={rootRef}
      className="relative shrink-0"
      data-sage-session-menu=""
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onOpenChange(!open);
        }}
        className={cn(
          "p-0.5 rounded hover:bg-[#E8E4DC] text-[#B0A899] hover:text-[#6A7A6E] transition-opacity",
          open || alwaysVisible
            ? "opacity-100"
            : "opacity-100 md:opacity-0 md:group-hover:opacity-100"
        )}
        aria-label="Conversation options"
        aria-expanded={open}
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 pt-1">
          <div className="min-w-[180px] rounded-lg border border-[#E8E4DC] bg-white py-1 shadow-lg">
          <button
            type="button"
            className={MENU_ITEM}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onArchive();
              onOpenChange(false);
            }}
          >
            {archived ? (
              <>
                <ArchiveRestore className="h-3.5 w-3.5" /> Unarchive
              </>
            ) : (
              <>
                <Archive className="h-3.5 w-3.5" /> Archive
              </>
            )}
          </button>
          <button
            type="button"
            className={MENU_ITEM}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onFlag();
              onOpenChange(false);
            }}
          >
            <Flag className="h-3.5 w-3.5" />{" "}
            {flagged ? "Remove flag" : "Flag"}
          </button>
          <button
            type="button"
            className={MENU_ITEM}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRename();
              onOpenChange(false);
            }}
          >
            <PenLine className="h-3.5 w-3.5" /> Rename
          </button>
          {confirmDelete ? (
            <div className="border-t border-[#F2F5EF] mt-1 px-3 py-2 text-[12px] text-[#6B6B6B] space-y-1">
              <p>Delete this conversation?</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded px-2 py-1 text-[12px] font-medium text-[#A85C5C] hover:bg-[#FDF2F2]"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onDelete();
                    onOpenChange(false);
                  }}
                >
                  Yes
                </button>
                <button
                  type="button"
                  className="rounded px-2 py-1 text-[12px] font-medium text-[#6B6B6B] hover:bg-[#F2F5EF]"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setConfirmDelete(false);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-[#C3442D] hover:bg-[#FDF2F0] text-left"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setConfirmDelete(true);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete conversation
            </button>
          )}
          </div>
        </div>
      )}
    </div>
  );
}
