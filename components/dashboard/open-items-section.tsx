"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { OpenItemReview } from "@/components/dashboard/open-item-review";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { showErrorToast } from "@/components/ui/toaster";
import { openItemsPreviewLimit, type OpenItemType, type OpenItemView } from "@/lib/open-items";
import { cn } from "@/lib/utils";

type Child = { id: string; first_name: string };

const TYPE_LABEL: Record<OpenItemType, string> = {
  expense: "Expense",
  calendar_event: "Calendar event",
  document: "Document",
  message: "Message",
};

export function OpenItemsSection() {
  const router = useRouter();
  const [items, setItems] = useState<OpenItemView[]>([]);
  const [count, setCount] = useState(0);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [children, setChildren] = useState<Child[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [reviewKey, setReviewKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const res = await fetch("/api/open-items");
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        count?: number;
        caseId?: string | null;
        children?: Child[];
        items?: OpenItemView[];
      };
      if (!res.ok) {
        setError(data.error || "Couldn't load open items.");
        return;
      }
      setError(null);
      setCount(typeof data.count === "number" ? data.count : (data.items ?? []).length);
      setCaseId(data.caseId ?? null);
      setChildren(Array.isArray(data.children) ? data.children : []);
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch {
      setError("Couldn't load open items.");
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    function onFocus() {
      if (reviewKey) return;
      void load({ silent: true });
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load, reviewKey]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (window.location.hash !== "#open-items" && params.get("open") !== "items") return;
    document.getElementById("open-items")?.scrollIntoView({ block: "start" });
  }, [loading]);

  const visible = expanded ? items : items.slice(0, openItemsPreviewLimit());
  const hiddenCount = Math.max(0, items.length - visible.length);

  async function retrySave(entry: OpenItemView) {
    if (entry.proposalIndex == null || !entry.retry) return;
    setBusyKey(entry.key);
    try {
      const res = await fetch("/api/sage-inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: entry.sageItemId,
          action: "execute",
          proposal_index: entry.proposalIndex,
          ...(entry.retry.eventId ? { event_id: entry.retry.eventId } : {}),
          ...(entry.retry.expenseId ? { expense_id: entry.retry.expenseId } : {}),
          ...(entry.retry.documentId ? { document_id: entry.retry.documentId } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok && !String(data.error ?? "").toLowerCase().includes("already executed")) {
        showErrorToast(data.error || "Couldn't retry that save.");
        return;
      }
      setReviewKey(null);
      await load();
    } catch {
      showErrorToast("Couldn't retry that save.");
    } finally {
      setBusyKey(null);
    }
  }

  function openEntry(entry: OpenItemView) {
    if (entry.retry && entry.proposalIndex != null) {
      void retrySave(entry);
      return;
    }
    if (entry.href) {
      router.push(entry.href);
      return;
    }
    setReviewKey((current) => (current === entry.key ? null : entry.key));
  }

  return (
    <Card id="open-items" className="mb-4 scroll-mt-4 shadow-card border-border rounded-card">
      <CardHeader className="flex flex-row items-center justify-between gap-2 px-4 pb-2 pt-4">
        <div className="flex items-center gap-2">
          <CardTitle className="font-heading text-lg text-foreground">Open items</CardTitle>
          {!loading && !error && (
            <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-[#F2F5EF] px-2 py-0.5 text-[11px] font-medium text-[#5B7A52]">
              {count}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2 px-4 pb-4">
        {loading ? (
          <p className="text-sm text-foreground-secondary">Loading open items…</p>
        ) : error ? (
          <div className="space-y-2">
            <p className="text-sm text-[#7A3434]" role="alert">
              {error}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 rounded-full px-3 text-[11px]"
              onClick={() => void load()}
            >
              Try again
            </Button>
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-foreground-secondary">You&apos;re all caught up.</p>
        ) : (
          <>
            <ul className="space-y-2">
              {visible.map((entry) => {
                const reviewing = reviewKey === entry.key;
                return (
                  <li
                    key={entry.key}
                    className="rounded-lg border border-[#E8E4DC] bg-white px-3 py-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <p className="text-sm font-medium text-foreground">{entry.title}</p>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center rounded-full bg-[#EEF2E9] px-2 py-0.5 text-[10px] font-medium text-[#5B7A52]">
                            {TYPE_LABEL[entry.type]}
                          </span>
                          <span className="text-[11px] text-foreground-secondary">
                            {formatCreated(entry.createdAt)}
                          </span>
                        </div>
                        <p className="text-[12px] leading-snug text-foreground-secondary">
                          {entry.explanation}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        className={cn(
                          "h-7 shrink-0 rounded-full px-3 text-[11px]",
                          "bg-[#7B9E87] text-white hover:bg-[#6A8A78]"
                        )}
                        disabled={busyKey === entry.key}
                        onClick={() => openEntry(entry)}
                      >
                        {busyKey === entry.key ? "Saving…" : entry.actionLabel}
                      </Button>
                    </div>
                    {reviewing && (
                      <OpenItemReview
                        entry={entry}
                        caseId={caseId}
                        children={children}
                        onChanged={() => void load({ silent: true })}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
            {items.length > openItemsPreviewLimit() && (
              <button
                type="button"
                className="text-[11px] text-[#5B7A52] hover:underline"
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded ? "Show fewer" : `Show all (${hiddenCount + visible.length})`}
              </button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function formatCreated(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const diffSec = Math.round((now.getTime() - date.getTime()) / 1000);
  if (diffSec < 60) return "Just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
