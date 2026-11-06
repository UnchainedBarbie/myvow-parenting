"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { OpenItemReview } from "@/components/dashboard/open-item-review";
import { Button } from "@/components/ui/button";
import { showErrorToast } from "@/components/ui/toaster";
import { sageChatHref } from "@/lib/sage-sessions-client";
import {
  openItemsPreviewLimit,
  SAGE_PROPOSALS_CHANGED_EVENT,
  type OpenItemType,
  type OpenItemView,
} from "@/lib/open-items";
import { cn } from "@/lib/utils";

type Child = { id: string; first_name: string };

const TYPE_LABEL: Record<OpenItemType, string> = {
  expense: "Expense",
  calendar_event: "Calendar event",
  document: "Document",
  message: "Message",
};

type OpenItemsState = {
  items: OpenItemView[];
  loading: boolean;
  error: string | null;
  caseId: string | null;
  children: Child[];
  reviewKey: string | null;
  busyKey: string | null;
  selected: string[];
  load: (opts?: { silent?: boolean }) => Promise<void>;
  retrySave: (entry: OpenItemView) => Promise<void>;
  toggleSelected: (key: string) => void;
  dismissEntries: (entries: OpenItemView[]) => Promise<void>;
  openEntry: (entry: OpenItemView) => void;
};

const OpenItemsContext = createContext<OpenItemsState | null>(null);

export function OpenItemsProvider({ children }: { children: ReactNode }) {
  const state = useOpenItemsState();
  return <OpenItemsContext.Provider value={state}>{children}</OpenItemsContext.Provider>;
}

export function useOpenItems(): OpenItemsState {
  const state = useContext(OpenItemsContext);
  if (!state) throw new Error("Open items are unavailable.");
  return state;
}

function useOpenItemsState(): OpenItemsState {
  const router = useRouter();
  const [items, setItems] = useState<OpenItemView[]>([]);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [children, setChildren] = useState<Child[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewKey, setReviewKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const res = await fetch("/api/open-items", { cache: "no-store" });
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
      setCaseId(data.caseId ?? null);
      setChildren(Array.isArray(data.children) ? data.children : []);
      const nextItems = Array.isArray(data.items) ? data.items : [];
      setItems(nextItems);
      setSelected((current) => current.filter((key) => nextItems.some((row) => row.key === key)));
      setReviewKey((current) =>
        current && nextItems.some((row) => row.key === current) ? current : null
      );
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
      if (document.visibilityState === "hidden") return;
      if (reviewKey) return;
      void load({ silent: true });
    }
    function onChanged() {
      void load({ silent: true });
    }
    window.addEventListener("focus", onFocus);
    window.addEventListener(SAGE_PROPOSALS_CHANGED_EVENT, onChanged);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(SAGE_PROPOSALS_CHANGED_EVENT, onChanged);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [load, reviewKey]);

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

  function toggleSelected(key: string) {
    setSelected((current) =>
      current.includes(key) ? current.filter((value) => value !== key) : [...current, key]
    );
  }

  async function dismissEntries(entries: OpenItemView[]) {
    if (entries.length === 0) return;
    setBusyKey(entries.length === 1 ? entries[0].key : "bulk");
    try {
      const res = await fetch("/api/open-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          action: "dismiss",
          items: entries.map((entry) => ({
            id: entry.sageItemId,
            proposalIndex: entry.proposalIndex,
          })),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        dismissed?: { id: string; proposalIndex: number | null }[];
        errors?: { id: string; proposalIndex: number | null; error: string }[];
      };
      if (!res.ok) {
        showErrorToast(data.error || "Couldn't dismiss that item.");
        return;
      }
      const failed = new Set(
        (data.errors ?? []).map((entry) => `${entry.id}:${entry.proposalIndex ?? "item"}`)
      );
      const dropped = new Set(
        entries
          .filter((entry) => !failed.has(`${entry.sageItemId}:${entry.proposalIndex ?? "item"}`))
          .map((entry) => entry.key)
      );
      if ((data.errors ?? []).length > 0) {
        showErrorToast(data.errors?.[0]?.error || "Couldn't dismiss every selected item.");
      }
      setItems((current) => current.filter((entry) => !dropped.has(entry.key)));
      setSelected((current) => current.filter((key) => !dropped.has(key)));
      setReviewKey((current) => (current && dropped.has(current) ? null : current));
      await load({ silent: true });
    } catch {
      showErrorToast("Couldn't dismiss that item.");
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

  return {
    items,
    loading,
    error,
    caseId,
    children,
    reviewKey,
    busyKey,
    selected,
    load,
    retrySave,
    toggleSelected,
    dismissEntries,
    openEntry,
  };
}

export function OpenItemModuleList({ type }: { type: OpenItemType }) {
  const router = useRouter();
  const {
    items,
    loading,
    error,
    caseId,
    children,
    reviewKey,
    busyKey,
    selected,
    load,
    toggleSelected,
    dismissEntries,
    openEntry,
  } = useOpenItems();
  const [expanded, setExpanded] = useState(false);
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const moduleItems = items.filter((entry) => entry.type === type);
  const visible = expanded ? moduleItems : moduleItems.slice(0, openItemsPreviewLimit());
  const hiddenCount = Math.max(0, moduleItems.length - visible.length);
  const selectedEntries = moduleItems.filter((entry) => selected.includes(entry.key));

  if (loading || error || moduleItems.length === 0) return null;

  async function openConversation(entry: OpenItemView) {
    if (entry.chatHref) {
      router.push(entry.chatHref);
      return;
    }
    const conversationId = entry.conversationId?.trim();
    if (!conversationId || openingKey) return;
    setOpeningKey(entry.key);
    try {
      const res = await fetch("/api/sage/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        session?: { id?: string };
      };
      const sessionId = data.session?.id?.trim();
      if (!res.ok || !sessionId) {
        showErrorToast(data.message || "Could not open that conversation.");
        return;
      }
      router.push(sageChatHref(sessionId));
    } catch {
      showErrorToast("Could not open that conversation.");
    } finally {
      setOpeningKey(null);
    }
  }

  return (
    <div className="space-y-2">
      {selectedEntries.length > 0 && (
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 rounded-full px-3 text-[11px]"
            disabled={busyKey === "bulk"}
            onClick={() => setConfirmDismiss(true)}
          >
            Dismiss selected
          </Button>
        </div>
      )}
      {confirmDismiss && selectedEntries.length > 0 && (
        <div
          role="dialog"
          aria-labelledby={`dismiss-selected-${type}`}
          className="space-y-2 rounded-lg border border-[#E8E4DC] bg-[#F7F5F0] px-3 py-2"
        >
          <p id={`dismiss-selected-${type}`} className="text-sm text-foreground">
            Dismiss {selectedEntries.length} open{" "}
            {selectedEntries.length === 1 ? "item" : "items"}? This means no further action is
            needed. Nothing is sent, approved, or deleted.
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              className="h-7 rounded-full bg-[#7B9E87] px-3 text-[11px] text-white hover:bg-[#6A8A78]"
              disabled={busyKey === "bulk"}
              onClick={() => void dismissEntries(selectedEntries).then(() => setConfirmDismiss(false))}
            >
              {busyKey === "bulk" ? "Dismissing…" : `Dismiss ${selectedEntries.length}`}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 rounded-full px-3 text-[11px]"
              disabled={busyKey === "bulk"}
              onClick={() => setConfirmDismiss(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
      <ul className="space-y-2">
              {visible.map((entry) => {
                const reviewing = reviewKey === entry.key;
                const rowBusy = busyKey === entry.key || busyKey === "bulk";
                return (
                  <li
                    key={entry.key}
                    className="rounded-lg border border-[#E8E4DC] bg-white px-3 py-2"
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 shrink-0 rounded border-[#C5D0C0] accent-[#7B9E87]"
                        checked={selected.includes(entry.key)}
                        disabled={rowBusy}
                        onChange={() => toggleSelected(entry.key)}
                        aria-label={`Select ${entry.title}`}
                      />
                      <div className="min-w-0 flex-1 space-y-1">
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
                      <div className="flex shrink-0 flex-col items-stretch gap-1">
                        <Button
                          type="button"
                          size="sm"
                          className={cn(
                            "h-7 rounded-full px-3 text-[11px]",
                            "bg-[#7B9E87] text-white hover:bg-[#6A8A78]"
                          )}
                          disabled={rowBusy}
                          onClick={() => openEntry(entry)}
                        >
                          {busyKey === entry.key ? "Saving…" : entry.actionLabel}
                        </Button>
                        {entry.chatHref || entry.conversationId ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 rounded-full px-3 text-[11px]"
                            disabled={openingKey === entry.key}
                            onClick={() => void openConversation(entry)}
                          >
                            {openingKey === entry.key ? "Opening…" : "Open conversation"}
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 rounded-full px-3 text-[11px]"
                          disabled={rowBusy}
                          title="No further action needed"
                          onClick={() => void dismissEntries([entry])}
                        >
                          {busyKey === entry.key ? "Dismissing…" : "Dismiss"}
                        </Button>
                      </div>
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
      {moduleItems.length > openItemsPreviewLimit() && (
        <button
          type="button"
          className="text-[11px] text-[#5B7A52] hover:underline"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Show fewer" : `Show all (${hiddenCount + visible.length})`}
        </button>
      )}
    </div>
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
