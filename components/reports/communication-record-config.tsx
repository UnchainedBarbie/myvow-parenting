"use client";

import { useEffect, useMemo, useState } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { RECORD_CATEGORIES } from "@/lib/record/record-categories";

type DatePreset = "all" | "30" | "90" | "180" | "custom";

type ConversationOption = { id: string; subject: string };

const DATE_PRESETS: { id: DatePreset; label: string }[] = [
  { id: "all", label: "All time" },
  { id: "30", label: "Last 30 days" },
  { id: "90", label: "Last 90 days" },
  { id: "180", label: "Last 180 days" },
  { id: "custom", label: "Custom range" },
];

const fieldClass =
  "h-9 w-full rounded-md border border-[#E8E4DC] bg-white px-2 text-sm text-[#3D3D3D] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5B7A52]";

export function CommunicationRecordConfig({ caseId }: { caseId: string }) {
  const [preset, setPreset] = useState<DatePreset>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [category, setCategory] = useState("all");
  const [conversationId, setConversationId] = useState("all");
  const [direction, setDirection] = useState("all");
  const [search, setSearch] = useState("");
  const [attachmentsOnly, setAttachmentsOnly] = useState(false);
  const [conversations, setConversations] = useState<ConversationOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/messages/conversations")
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as {
          conversations?: { id?: string; subject?: string | null }[];
        };
      })
      .then((data) => {
        if (cancelled || !data) return;
        const options = (data.conversations ?? [])
          .map((conversation) => ({
            id: conversation.id ?? "",
            subject: conversation.subject?.trim() || "Untitled conversation",
          }))
          .filter((conversation) => conversation.id)
          .sort((a, b) => a.subject.localeCompare(b.subject) || a.id.localeCompare(b.id));
        setConversations(options);
      })
      .catch(() => {
        if (!cancelled) setConversations([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const customReady = preset !== "custom" || (from !== "" && to !== "");

  const href = useMemo(() => {
    const params = new URLSearchParams();
    if (preset !== "all") params.set("range", preset);
    if (preset === "custom") {
      if (from) params.set("from", from);
      if (to) params.set("to", to);
    }
    if (category !== "all") params.set("category", category);
    if (conversationId !== "all") params.set("conversation", conversationId);
    if (direction !== "all") params.set("direction", direction);
    const query = search.trim();
    if (query) params.set("q", query);
    if (attachmentsOnly) params.set("attachments", "1");
    const qs = params.toString();
    return `/cases/${caseId}/record${qs ? `?${qs}` : ""}`;
  }, [attachmentsOnly, caseId, category, conversationId, direction, from, preset, search, to]);

  return (
    <div className="mt-5 space-y-4">
      <p className="text-sm leading-relaxed text-foreground-secondary">
        This opens the communication record for the case. It lists messages exchanged between the
        parents and does not include Sage analysis. You can review it and print or save it from
        that page.
      </p>

      <div className="space-y-2">
        <Label className="text-xs font-medium text-[#3D3D3D]">Date range</Label>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Date range">
          {DATE_PRESETS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={preset === option.id}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs transition-colors",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5B7A52]",
                preset === option.id
                  ? "border-[#7C8B6E] bg-[#F2F5EF] text-[#5B7A52]"
                  : "border-[#E8E4DC] bg-white text-foreground hover:bg-[#F7F3EA]"
              )}
              onClick={() => setPreset(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        {preset === "custom" ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="record-from" className="text-[11px] text-foreground-secondary">
                From
              </Label>
              <input
                id="record-from"
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                className={fieldClass}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="record-to" className="text-[11px] text-foreground-secondary">
                To
              </Label>
              <input
                id="record-to"
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                className={fieldClass}
              />
            </div>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="record-category" className="text-xs font-medium text-[#3D3D3D]">
            Category
          </Label>
          <select
            id="record-category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className={fieldClass}
          >
            <option value="all">All Categories</option>
            {RECORD_CATEGORIES.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="record-conversation" className="text-xs font-medium text-[#3D3D3D]">
            Subject / Conversation
          </Label>
          <select
            id="record-conversation"
            value={conversationId}
            onChange={(event) => setConversationId(event.target.value)}
            className={fieldClass}
          >
            <option value="all">All Conversations</option>
            {conversations.map((conversation) => (
              <option key={conversation.id} value={conversation.id}>
                {conversation.subject}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="record-direction" className="text-xs font-medium text-[#3D3D3D]">
            Direction
          </Label>
          <select
            id="record-direction"
            value={direction}
            onChange={(event) => setDirection(event.target.value)}
            className={fieldClass}
          >
            <option value="all">All Messages</option>
            <option value="sent">Sent by Me</option>
            <option value="received">Received from Co-Parent</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="record-search" className="text-xs font-medium text-[#3D3D3D]">
            Search Messages
          </Label>
          <input
            id="record-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Keyword"
            className={fieldClass}
          />
        </div>
      </div>

      <label htmlFor="record-attachments" className="flex items-start gap-2 text-sm text-foreground">
        <input
          id="record-attachments"
          type="checkbox"
          checked={attachmentsOnly}
          onChange={(event) => setAttachmentsOnly(event.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 rounded border-[#E8E4DC] text-[#5B7A52] focus:ring-[#5B7A52]"
        />
        Only messages with attachments
      </label>

      {customReady ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-9 items-center justify-center rounded-full bg-[#5B7A52] px-5 text-sm text-white hover:bg-[#476242] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5B7A52]"
        >
          View Record
        </a>
      ) : (
        <button
          type="button"
          disabled
          className="inline-flex h-9 items-center justify-center rounded-full bg-[#5B7A52] px-5 text-sm text-white opacity-50"
        >
          View Record
        </button>
      )}
    </div>
  );
}
