"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SageProposal = {
  type: string;
  draft: string;
  depends_on: string | null;
  requires_approval?: boolean;
  approved?: boolean;
  approved_at?: string;
};

type SagePlan = {
  status?: string;
  proposals?: SageProposal[];
  reasoning?: string;
};

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
  plan: SagePlan | null;
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

function proposalTypeLabel(type: string): string {
  switch (type) {
    case "ask_clarification":
      return "Ask Co-Parent";
    case "reply_coparent":
      return "Reply to Co-Parent";
    case "calendar_update":
      return "Update calendar";
    case "log_expense":
      return "Log expense";
    case "note_only":
      return "Note";
    default:
      return type;
  }
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

function isBlocked(p: SageProposal): boolean {
  return p.depends_on != null && String(p.depends_on).trim() !== "";
}

function isSelectable(p: SageProposal): boolean {
  return p.type !== "note_only" && !isBlocked(p) && p.approved !== true;
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
  const [selected, setSelected] = useState<Record<string, number[]>>({});
  const [submittingId, setSubmittingId] = useState<string | null>(null);

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
    setSelected((prev) => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
    setDismissingId(null);
  }

  function toggleProposal(itemId: string, index: number) {
    setSelected((prev) => {
      const current = prev[itemId] ?? [];
      const next = current.includes(index)
        ? current.filter((i) => i !== index)
        : [...current, index].sort((a, b) => a - b);
      return { ...prev, [itemId]: next };
    });
  }

  async function handleSubmit(item: SageItem) {
    const indexes = selected[item.id] ?? [];
    if (indexes.length === 0) return;
    setSubmittingId(item.id);
    try {
      const res = await fetch("/api/sage-inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: item.id,
          approved_proposal_indexes: indexes,
        }),
      });
      if (!res.ok) return;
      setSelected((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      await fetchInbox();
    } catch (e) {
      console.error("[SageInbox] submit failed:", e);
    } finally {
      setSubmittingId(null);
    }
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
                  const proposals = Array.isArray(item.plan?.proposals)
                    ? item.plan!.proposals!
                    : [];
                  const checked = selected[item.id] ?? [];
                  const canSubmit = checked.length > 0 && submittingId !== item.id;

                  return (
                    <li
                      key={item.id}
                      className={cn(
                        "rounded-lg border border-[#E8E4DC] bg-white px-3 py-2 transition-opacity duration-300",
                        isDismissing && "opacity-0"
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
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
                      </div>

                      {proposals.length > 0 && (
                        <div className="mt-3 ml-9 space-y-2 border-t border-[#E8E4DC] pt-2">
                          <p className="text-[11px] font-medium text-[#5B7A52]">Sage suggests</p>
                          <ul className="space-y-2">
                            {proposals.map((p, idx) => {
                              const blocked = isBlocked(p);
                              const approved = p.approved === true;
                              const noteOnly = p.type === "note_only";
                              const selectable = isSelectable(p);
                              const isChecked = checked.includes(idx);

                              return (
                                <li
                                  key={`${item.id}-p-${idx}`}
                                  className={cn(
                                    "flex items-start gap-2 rounded-md px-2 py-1.5",
                                    blocked && "bg-[#F7F5F0] opacity-80"
                                  )}
                                >
                                  {noteOnly ? (
                                    <span className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                                  ) : approved ? (
                                    <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center text-[10px] text-[#5B7A52]">
                                      ✓
                                    </span>
                                  ) : (
                                    <input
                                      type="checkbox"
                                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-[#C5D0C0] accent-[#7B9E87] disabled:cursor-not-allowed disabled:opacity-40"
                                      checked={isChecked}
                                      disabled={!selectable || submittingId === item.id}
                                      onChange={() => toggleProposal(item.id, idx)}
                                      aria-label={`Approve: ${proposalTypeLabel(p.type)}`}
                                    />
                                  )}
                                  <div className="min-w-0 flex-1 space-y-0.5">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="inline-flex items-center rounded-full bg-[#EEF2E9] px-2 py-0.5 text-[10px] font-medium text-[#5B7A52]">
                                        {proposalTypeLabel(p.type)}
                                      </span>
                                      {approved && (
                                        <span className="text-[10px] font-medium text-[#5B7A52]">
                                          ✓ approved
                                        </span>
                                      )}
                                      {blocked && !approved && (
                                        <span className="text-[10px] text-foreground-secondary">
                                          waiting on: {p.depends_on}
                                        </span>
                                      )}
                                    </div>
                                    <p
                                      className={cn(
                                        "text-[12px] leading-snug text-foreground",
                                        blocked && "text-foreground-secondary"
                                      )}
                                    >
                                      {p.draft}
                                    </p>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                          {proposals.some(isSelectable) && (
                            <div className="pt-1">
                              <Button
                                type="button"
                                size="sm"
                                className="h-7 rounded-full px-3 text-[11px] bg-[#7B9E87] text-white hover:bg-[#6A8A78] disabled:opacity-50"
                                disabled={!canSubmit}
                                onClick={() => handleSubmit(item)}
                              >
                                {submittingId === item.id ? "Submitting…" : "Submit"}
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
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
