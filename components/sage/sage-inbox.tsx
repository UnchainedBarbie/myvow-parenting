"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SageItem = {
  id: string;
  item_type: string | null;
  domain: string | null;
  summary: string | null;
  evidence_excerpt: string | null;
  urgency: string | null;
  action_required: boolean | null;
  child_ids: string[] | null;
  tool_input: unknown;
  status: string | null;
  created_at: string;
};

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

function domainIcon(domain: string | null, itemType: string | null): string {
  const d = (domain ?? "").toLowerCase();
  const t = (itemType ?? "").toLowerCase();
  if (d === "expense" || t === "expense") return "$";
  if (d === "calendar" || t === "schedule_change" || t === "calendar_update") return "📅";
  if (d === "school" || t === "school_update") return "S";
  if (d === "medical" || t === "medical_update") return "+";
  if (d === "legal" || t === "document_summary") return "D";
  if (t === "needs_review") return "?";
  return "•";
}

function childNamesFromItem(item: SageItem): string[] {
  const names: string[] = [];
  const input = item.tool_input;
  if (input && typeof input === "object" && input !== null) {
    const children = (input as { children?: unknown }).children;
    if (Array.isArray(children)) {
      for (const c of children) {
        if (c && typeof c === "object" && typeof (c as { name?: unknown }).name === "string") {
          const name = ((c as { name: string }).name ?? "").trim();
          if (name) names.push(name);
        }
      }
    }
  }
  return names;
}

type Section = {
  key: string;
  title: string;
  items: SageItem[];
};

function groupItems(items: SageItem[]): Section[] {
  const needsResponse: SageItem[] = [];
  const awareness: SageItem[] = [];
  const needsReview: SageItem[] = [];
  // Reserved for Planner-driven updates — empty until that layer exists.
  const updatedBySage: SageItem[] = [];

  for (const item of items) {
    const type = (item.item_type ?? "").toLowerCase();
    if (type === "needs_review") {
      needsReview.push(item);
      continue;
    }
    if (item.action_required === true) {
      needsResponse.push(item);
      continue;
    }
    if (item.action_required === false) {
      awareness.push(item);
      continue;
    }
    awareness.push(item);
  }

  return [
    { key: "needs_response", title: "Needs Response", items: needsResponse },
    { key: "awareness", title: "For Your Awareness", items: awareness },
    { key: "needs_review", title: "Needs Review", items: needsReview },
    { key: "updated", title: "Updated by Sage", items: updatedBySage },
  ].filter((s) => s.items.length > 0);
}

export function SageInbox() {
  const [items, setItems] = useState<SageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissingId, setDismissingId] = useState<string | null>(null);

  async function fetchInbox() {
    setLoading(true);
    try {
      const res = await fetch("/api/sage-inbox");
      if (!res.ok) return;
      const data = (await res.json()) as SageItem[];
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("[SageInbox] fetch failed:", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchInbox();
  }, []);

  async function handleDismiss(item: SageItem) {
    setDismissingId(item.id);
    const res = await fetch("/api/sage-inbox", {
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

  const sections = groupItems(items);
  const totalCount = items.length;

  return (
    <Card className="shadow-card border-border rounded-card">
      <CardHeader className="pb-2 px-4 pt-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CardTitle className="font-heading text-lg text-foreground">Sage Inbox</CardTitle>
          {totalCount > 0 && (
            <span className="inline-flex items-center justify-center rounded-full bg-[#F2F5EF] px-2 py-0.5 text-[11px] font-medium text-[#5B7A52]">
              {totalCount}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-5">
        {loading ? (
          <p className="text-sm text-foreground-secondary">Loading…</p>
        ) : totalCount === 0 ? (
          <p className="text-sm text-foreground-secondary">Sage hasn&apos;t flagged anything yet.</p>
        ) : (
          sections.map((section) => (
            <div key={section.key} className="space-y-2">
              <div className="flex items-center gap-2">
                <h2 className="font-heading text-sm font-semibold text-foreground">
                  {section.title}
                </h2>
                <span className="inline-flex items-center justify-center rounded-full bg-[#F2F5EF] px-2 py-0.5 text-[11px] font-medium text-[#5B7A52]">
                  {section.items.length}
                </span>
              </div>
              <ul className="space-y-2">
                {section.items.map((item) => {
                  const icon = domainIcon(item.domain, item.item_type);
                  const domain = (item.domain ?? "").trim();
                  const urgency = (item.urgency ?? "").toLowerCase();
                  const showUrgency = urgency === "high" || urgency === "emergency";
                  const children = childNamesFromItem(item);
                  const isDismissing = dismissingId === item.id;
                  const summary = (item.summary ?? "").trim() || "(no summary)";

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
                          <p className="text-sm text-foreground line-clamp-2">{summary}</p>
                          <div className="flex flex-wrap items-center gap-2">
                            {domain && (
                              <span className="inline-flex items-center rounded-full bg-[#EEF2E9] px-2 py-0.5 text-[10px] font-medium text-[#5B7A52]">
                                {domain}
                              </span>
                            )}
                            {showUrgency && (
                              <span className="inline-flex items-center rounded-full bg-[#FBF3E0] px-2 py-0.5 text-[10px] font-medium text-[#B8860B]">
                                {urgency === "emergency" ? "emergency" : "high"}
                              </span>
                            )}
                            {children.length > 0 && (
                              <span className="text-[11px] text-foreground-secondary">
                                {children.join(", ")}
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
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
