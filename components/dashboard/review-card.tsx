"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type InboxItemType = "expense" | "document" | "calendar_event" | "message" | "other";

type InboxItem = {
  id: string;
  subject: string | null;
  summary: string | null;
  item_type: string | null;
  suggested_category: string | null;
  ai_category: string | null;
  ai_type: string | null;
  created_at: string;
};

function truncateText(value: string | null | undefined, max = 60): string {
  const text = (value ?? "").trim();
  if (!text) return "(no subject)";
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

function formatRelativeTime(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min${diffMin === 1 ? "" : "s"} ago`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  const diffWeeks = Math.round(diffDays / 7);
  return `${diffWeeks} week${diffWeeks === 1 ? "" : "s"} ago`;
}

function normalizeInboxType(item: { item_type?: string | null; ai_type?: string | null }): InboxItemType {
  const raw = (item.item_type ?? "").toString().toLowerCase();
  if (raw === "expense") return "expense";
  if (raw === "document") return "document";
  if (raw === "message") return "message";
  if (raw === "calendar_event" || raw === "event" || raw === "calendar") return "calendar_event";
  const ai = (item.ai_type ?? "").toString().toLowerCase();
  if (ai === "expense") return "expense";
  if (ai === "document") return "document";
  if (ai === "event") return "calendar_event";
  return "other";
}

function inboxTypeIcon(type: InboxItemType): string {
  if (type === "expense") return "$";
  if (type === "calendar_event") return "📅";
  if (type === "document") return "D";
  if (type === "message") return "M";
  return "•";
}

function getAcceptDestination(type: InboxItemType): string | null {
  if (type === "expense") return "/expenses";
  if (type === "document") return "/documents";
  if (type === "calendar_event") return "/calendar";
  if (type === "message") return "/messages";
  return null;
}

export function ReviewCard() {
  const router = useRouter();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissingId, setDismissingId] = useState<string | null>(null);

  async function fetchInbox() {
    setLoading(true);
    try {
      const res = await fetch("/api/inbox");
      if (!res.ok) return;
      const data = (await res.json()) as InboxItem[];
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("[ReviewCard] fetch failed:", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchInbox();
  }, []);

  async function handleAccept(item: InboxItem) {
    const type = normalizeInboxType(item);
    const res = await fetch("/api/inbox", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, status: "accepted" }),
    });
    if (!res.ok) return;
    const destination = getAcceptDestination(type);
    if (destination) {
      router.push(destination);
    } else {
      fetchInbox();
    }
  }

  async function handleDismiss(item: InboxItem) {
    setDismissingId(item.id);
    const res = await fetch("/api/inbox", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, status: "dismissed" }),
    });
    if (!res.ok) {
      setDismissingId(null);
      return;
    }
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    setDismissingId(null);
  }

  const count = items.length;
  const displayItems = items.slice(0, 5);

  return (
    <Card className="shadow-card border-border rounded-card">
      <CardHeader className="pb-2 px-4 pt-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CardTitle className="font-heading text-lg text-foreground">
            Review
          </CardTitle>
          {count > 0 && (
            <span className="inline-flex items-center justify-center rounded-full bg-[#F2F5EF] px-2 py-0.5 text-[11px] font-medium text-[#5B7A52]">
              {count}
            </span>
          )}
        </div>
        {count > 5 && (
          <Link
            href="/uploads/review"
            className="text-[11px] text-[#5B7A52] hover:underline whitespace-nowrap"
          >
            View all ({count})
          </Link>
        )}
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        {loading ? (
          <p className="text-sm text-foreground-secondary">Loading…</p>
        ) : count === 0 ? (
          <p className="text-sm text-foreground-secondary">All caught up.</p>
        ) : (
          <ul className="space-y-2">
            {displayItems.map((item) => {
              const type = normalizeInboxType(item);
              const icon = inboxTypeIcon(type);
              const category = (item.suggested_category || item.ai_category || "").trim();
              const primary =
                (item.subject ?? "") || (item.summary ?? "") || "(no subject)";
              const isDismissing = dismissingId === item.id;
              return (
                <li
                  key={item.id}
                  className={cn(
                    "flex items-start justify-between gap-3 rounded-lg border border-[#E8E4DC] bg-white px-3 py-2 transition-opacity duration-300",
                    isDismissing && "opacity-0"
                  )}
                >
                  <div className="flex items-start gap-2 min-w-0">
                    <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#F2F5EF] text-[#5B7A52] text-[11px]">
                      {icon}
                    </span>
                    <div className="min-w-0 space-y-1">
                      <p className="truncate text-sm text-foreground">
                        {truncateText(primary, 60)}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        {category && (
                          <span className="inline-flex items-center rounded-full bg-[#EEF2E9] px-2 py-0.5 text-[10px] font-medium text-[#5B7A52]">
                            {category}
                          </span>
                        )}
                        <span className="text-[11px] text-foreground-secondary">
                          {formatRelativeTime(item.created_at)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-stretch gap-1 sm:flex-row sm:items-center">
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 rounded-full px-3 text-[11px] bg-[#7B9E87] text-white hover:bg-[#6A8A78]"
                      onClick={() => handleAccept(item)}
                    >
                      Accept ✓
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 rounded-full px-3 text-[11px]"
                      onClick={() => handleDismiss(item)}
                      disabled={isDismissing}
                    >
                      Dismiss ✗
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
