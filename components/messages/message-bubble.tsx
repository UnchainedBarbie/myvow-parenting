"use client";

import { useState } from "react";
import { Bookmark } from "lucide-react";
import { cn } from "@/lib/utils";

export type MessageRow = {
  id: string;
  direction: "incoming" | "outgoing";
  ai_rewritten_content: string | null;
  original_content: string;
  category: string | null;
  sub_category: string | null;
  current_status: string;
  external_comm_id: string | null;
  created_at: string;
  flags?: Array<{ flag_type: string; description: string | null }>;
  intensity_flag?: boolean;
  delivery_status?: string;
  delivered_at?: string | null;
  is_emergency?: boolean;
  flagged_by_me?: boolean;
};

interface MessageBubbleProps {
  message: MessageRow;
  showOriginalByDefault?: boolean;
  onToggleFlag?: () => void;
}

export function MessageBubble({
  message,
  showOriginalByDefault = false,
  onToggleFlag,
}: MessageBubbleProps) {
  const [showOriginal, setShowOriginal] = useState(showOriginalByDefault);
  const displayContent =
    message.ai_rewritten_content ?? message.original_content;
  const isOutgoing = message.direction === "outgoing";

  return (
    <div
      className={cn(
        "group max-w-[82%] md:max-w-[70%] space-y-1",
        isOutgoing ? "ml-auto items-end text-right" : "mr-auto items-start text-left"
      )}
    >
      <div
        className={cn(
          "inline-block rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap text-[#3D3D3D]",
          isOutgoing
            ? "bg-[#EEF2E9] rounded-br-[4px] rounded-bl-[14px]"
            : "bg-[#F9F6F0] rounded-bl-[4px] rounded-br-[14px]"
        )}
      >
        {displayContent}
      </div>
      <div className="flex items-center justify-between gap-3 text-[11px] text-[#8A8A8A]">
        <div className="flex items-center gap-2">
          {message.external_comm_id ? (
            <span className="font-mono hidden sm:inline">
              Comm #{message.external_comm_id.slice(-8)}
            </span>
          ) : (
            <span />
          )}
        </div>
        <div className="flex items-center gap-2">
          {message.original_content !== (message.ai_rewritten_content ?? "") && (
            <button
              type="button"
              onClick={() => setShowOriginal(!showOriginal)}
              className="inline-flex items-center gap-1 text-[11px] text-[#5B7A52] hover:underline"
            >
              <span role="img" aria-label="View original">
                👁️
              </span>
              <span>{showOriginal ? "Hide original" : "View original"}</span>
            </button>
          )}
          {onToggleFlag && (
            <button
              type="button"
              onClick={onToggleFlag}
              className={cn(
                "inline-flex h-5 w-5 items-center justify-center rounded-full text-[#A19A8C] hover:text-[#5B7A52] hover:bg-[#ECE6D8] transition-colors opacity-0 group-hover:opacity-100",
                message.flagged_by_me && "opacity-100 text-[#5B7A52]"
              )}
              aria-label={message.flagged_by_me ? "Unflag (private)" : "Flag (private)"}
              title={message.flagged_by_me ? "Unflag (private)" : "Flag (private)"}
            >
              <Bookmark
                className={cn(
                  "h-3.5 w-3.5",
                  message.flagged_by_me ? "fill-current" : "stroke-current"
                )}
              />
            </button>
          )}
        </div>
      </div>
      {showOriginal && (
        <div
          className={cn(
            "mt-1 inline-block max-w-full rounded-2xl border border-[#E8E4DC] bg-[#FFF8F0] px-3 py-2 text-[11px] italic text-[#8A8A8A]"
          )}
        >
          <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-[#B0A899]">
            Original message
          </div>
          <div className="whitespace-pre-wrap">{message.original_content}</div>
        </div>
      )}
      <time className="block text-[10px] text-[#8A8A8A]">
        {new Date(message.created_at).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })}
      </time>
    </div>
  );
}
