"use client";

import { useState } from "react";
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
};

interface MessageBubbleProps {
  message: MessageRow;
  showOriginalByDefault?: boolean;
}

export function MessageBubble({
  message,
  showOriginalByDefault = false,
}: MessageBubbleProps) {
  const [showOriginal, setShowOriginal] = useState(showOriginalByDefault);
  const displayContent = showOriginal
    ? message.original_content
    : (message.ai_rewritten_content ?? message.original_content);
  const isOutgoing = message.direction === "outgoing";

  return (
    <div
      className={cn(
        "rounded-card shadow-card p-4 max-w-[85%]",
        isOutgoing ? "ml-auto bg-primary-light" : "mr-auto bg-background-secondary"
      )}
    >
      {message.category && (
        <span className="inline-block rounded-full bg-muted px-2 py-0.5 text-xs text-foreground-secondary mb-2">
          {message.category}
          {message.sub_category ? ` · ${message.sub_category}` : ""}
        </span>
      )}
      <p className="text-sm text-foreground whitespace-pre-wrap">{displayContent}</p>
      {message.flags && message.flags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {message.flags.map((f) => (
            <span
              key={f.flag_type}
              className="rounded px-2 py-0.5 text-xs text-alert/90 bg-alert/10 border border-alert/20"
            >
              {f.description || f.flag_type}
            </span>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-foreground-secondary">
        <span>
          {message.external_comm_id && (
            <span className="font-mono">Comm #{message.external_comm_id.slice(-8)}</span>
          )}
        </span>
        {message.original_content !== (message.ai_rewritten_content ?? "") && (
          <button
            type="button"
            onClick={() => setShowOriginal(!showOriginal)}
            className="text-info hover:underline"
          >
            {showOriginal ? "View mediated" : "View original"}
          </button>
        )}
      </div>
      <time className="block text-xs text-foreground-secondary mt-1">
        {new Date(message.created_at).toLocaleString()}
      </time>
    </div>
  );
}
