"use client";

import { useEffect, useMemo, useState } from "react";
import { Archive, ArchiveRestore, Flag, Search, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { cn } from "@/lib/utils";
import { ReviseProposalModal } from "@/components/sage/revise-proposal-modal";
import {
  AddEventForm,
  type AddEventFormInitialValues,
} from "@/components/calendar/add-event-form";

type SageProposal = {
  type: string;
  draft: string;
  revised_text?: string | null;
  depends_on: string | null;
  requires_approval?: boolean;
  approved?: boolean;
  approved_at?: string;
  chosen_date?: string;
  status?: string;
  waived_at?: string;
  unblocked?: boolean;
  executed?: boolean;
  executed_at?: string;
  result_event_id?: string;
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
  flagged?: boolean | null;
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

function isWaived(p: SageProposal): boolean {
  return p.status === "waived_by_user";
}

function isBlocked(p: SageProposal): boolean {
  return (
    p.depends_on != null &&
    String(p.depends_on).trim() !== "" &&
    p.unblocked !== true
  );
}

function isActionable(p: SageProposal): boolean {
  return (
    p.type !== "note_only" &&
    p.approved !== true &&
    !isWaived(p) &&
    !isBlocked(p)
  );
}

/** Calendar updates always need an explicit chosen_date before Agree — don't suppress via unrelated resolved_dates. */
function needsDateField(p: SageProposal): boolean {
  return p.type === "calendar_update" && !p.chosen_date;
}

/** Strip misleading "on YYYY-MM-DD" from drafts when the user must pick the date. */
function displayDraft(p: SageProposal, showDateField: boolean): string {
  const source =
    typeof p.revised_text === "string" && p.revised_text.trim()
      ? p.revised_text.trim()
      : (p.draft ?? "").trim();
  let text = source;
  if (showDateField && !p.chosen_date) {
    text = text.replace(/\s+on\s+\d{4}-\d{2}-\d{2}/gi, "").trim();
  }
  return text;
}

function canUndo(p: SageProposal): boolean {
  if (p.executed === true) return false;
  return p.approved === true || p.status === "waived_by_user";
}

function isRevisable(p: SageProposal): boolean {
  return (
    (p.type === "reply_coparent" || p.type === "ask_clarification") &&
    isActionable(p)
  );
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

function dateKey(itemId: string, index: number): string {
  return `${itemId}:${index}`;
}

/**
 * Extract the TARGET time from a schedule/pickup proposal draft (HH:MM 24h).
 * Prefers "to 5:30" / "from … to …"; avoids the "from" time. Returns undefined if unsure.
 */
function parseTargetTimeFromDraft(draft: string): string | undefined {
  const text = draft.trim();
  if (!text) return undefined;

  type Hit = { h: number; min: string; ampm: string };

  const to24 = (hit: Hit, assumeAfternoonPm: boolean): string | undefined => {
    let h = hit.h;
    if (Number.isNaN(h) || h < 0 || h > 23) return undefined;
    const ampm = hit.ampm;
    if (ampm.startsWith("p")) {
      if (h < 12) h += 12;
    } else if (ampm.startsWith("a")) {
      if (h === 12) h = 0;
    } else if (h >= 1 && h <= 7 && assumeAfternoonPm) {
      // Ambiguous 1–7 in pickup/afternoon context → PM
      h += 12;
    } else if (!ampm && h >= 1 && h <= 12) {
      // Ambiguous without meridian — don't guess
      return undefined;
    }
    if (h > 23) return undefined;
    return `${String(h).padStart(2, "0")}:${hit.min}`;
  };

  const pickupish =
    /pickup|pick-up|drop.?off|schedule|exchange|custody|afternoon/i.test(text);

  // "from 4:00 … to 5:30 PM" — take the "to" time only
  const fromTo = text.match(
    /\bfrom\s+\d{1,2}:\d{2}\s*(?:a\.?m\.?|p\.?m\.?)?\s+.*?to\s+(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)?\b/i
  );
  if (fromTo) {
    return to24(
      {
        h: parseInt(fromTo[1], 10),
        min: fromTo[2],
        ampm: (fromTo[3] ?? "").toLowerCase().replace(/\./g, ""),
      },
      pickupish
    );
  }

  // "to 5:30" / "to 5:30 PM"
  const toOnly = text.match(
    /\bto\s+(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)?\b/i
  );
  if (toOnly) {
    return to24(
      {
        h: parseInt(toOnly[1], 10),
        min: toOnly[2],
        ampm: (toOnly[3] ?? "").toLowerCase().replace(/\./g, ""),
      },
      pickupish
    );
  }

  // Explicit times with AM/PM — prefer the last one (often the target)
  const withMeridian = [
    ...text.matchAll(/\b(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)\b/gi),
  ];
  if (withMeridian.length > 0) {
    const last = withMeridian[withMeridian.length - 1];
    return to24(
      {
        h: parseInt(last[1], 10),
        min: last[2],
        ampm: (last[3] ?? "").toLowerCase().replace(/\./g, ""),
      },
      false
    );
  }

  // Single bare time only if pickup context allows afternoon PM heuristic
  const bare = [...text.matchAll(/\b(\d{1,2}):(\d{2})\b/g)];
  if (bare.length === 1 && pickupish) {
    return to24(
      { h: parseInt(bare[0][1], 10), min: bare[0][2], ampm: "" },
      true
    );
  }

  return undefined;
}

function buildCalendarTitle(item: SageItem): string {
  const names = childNamesFromItem(item);
  const name = names[0]?.trim();
  const base = "Pickup change";
  if (!name) return base;
  return `${base} – ${name}`.slice(0, 40);
}

function buildCalendarInitialValues(
  item: SageItem,
  proposal: SageProposal,
  chosenDate?: string
): AddEventFormInitialValues {
  const childId =
    Array.isArray(item.child_ids) && item.child_ids[0]
      ? item.child_ids[0]
      : undefined;
  const draftSource =
    (typeof proposal.revised_text === "string" && proposal.revised_text.trim()
      ? proposal.revised_text
      : proposal.draft) ?? "";
  const summary = (item.summary ?? "").trim();
  const date =
    (chosenDate ?? proposal.chosen_date ?? "").trim() || undefined;
  const startTime = parseTargetTimeFromDraft(
    [draftSource, summary].filter(Boolean).join(" ")
  );
  return {
    childId,
    date,
    ...(startTime ? { startTime } : {}),
    title: buildCalendarTitle(item),
    eventType: "custody_exchange",
    description: summary || undefined,
  };
}

type CalendarAgreeTarget = {
  item: SageItem;
  proposalIndex: number;
  initialValues: AddEventFormInitialValues;
  queue: number[];
};

export function SageInbox({
  caseId,
  children: childrenList,
}: {
  caseId: string;
  children: { id: string; first_name: string }[];
}) {
  const [items, setItems] = useState<SageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<
    "open" | "flagged" | "archived" | "all"
  >("open");
  const [search, setSearch] = useState("");
  const [itemSelectMode, setItemSelectMode] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [confirmArchiveItem, setConfirmArchiveItem] = useState<SageItem | null>(null);
  const [confirmBulkArchive, setConfirmBulkArchive] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [multiSelect, setMultiSelect] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Record<string, number[]>>({});
  const [dates, setDates] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [calendarAgree, setCalendarAgree] = useState<CalendarAgreeTarget | null>(
    null
  );
  const [reviseTarget, setReviseTarget] = useState<{
    itemId: string;
    proposalIndex: number;
    proposalType: "reply_coparent" | "ask_clarification";
    originalDraft: string;
    initialText: string;
  } | null>(null);

  function exitItemSelectMode() {
    setItemSelectMode(false);
    setSelectedItemIds([]);
    setConfirmBulkArchive(false);
  }

  function toggleItemSelected(id: string) {
    setSelectedItemIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function fetchInbox(
    status: "open" | "flagged" | "archived" | "all" = statusFilter
  ) {
    setLoading(true);
    try {
      const res = await fetch(`/api/sage-inbox?status=${encodeURIComponent(status)}`);
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
    fetchInbox(statusFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch when status filter changes
  }, [statusFilter]);

  const visibleItems = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      const children = childNamesFromItem(item).join(" ");
      const text = [item.summary ?? "", item.domain ?? "", children]
        .join(" ")
        .toLowerCase();
      return text.includes(q);
    });
  }, [items, search]);

  async function toggleFlag(item: SageItem) {
    const nextFlagged = !item.flagged;
    const prevFlagged = item.flagged === true;
    setItems((prev) => {
      const updated = prev.map((i) =>
        i.id === item.id ? { ...i, flagged: nextFlagged } : i
      );
      if (statusFilter === "flagged" && !nextFlagged) {
        return updated.filter((i) => i.id !== item.id);
      }
      return updated;
    });
    const res = await fetch("/api/sage-inbox", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, flagged: nextFlagged }),
    });
    if (!res.ok) {
      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id ? { ...i, flagged: prevFlagged } : i
        )
      );
      if (statusFilter === "flagged") await fetchInbox();
    }
  }

  async function bulkFlagSelected() {
    if (selectedItemIds.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    try {
      for (const id of selectedItemIds) {
        await fetch("/api/sage-inbox", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, flagged: true }),
        });
      }
      setSelectedItemIds([]);
      await fetchInbox();
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkArchiveSelected() {
    if (selectedItemIds.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    try {
      for (const id of selectedItemIds) {
        await fetch("/api/sage-inbox", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, status: "archived" }),
        });
      }
      setConfirmBulkArchive(false);
      exitItemSelectMode();
      await fetchInbox();
    } finally {
      setBulkBusy(false);
    }
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

  function buildDatesPayload(
    item: SageItem,
    indexes: number[]
  ): Record<number, string> | undefined {
    const proposals = item.plan?.proposals ?? [];
    const out: Record<number, string> = {};
    for (const idx of indexes) {
      const p = proposals[idx];
      if (!p || !needsDateField(p)) continue;
      const val = dates[dateKey(item.id, idx)]?.trim();
      if (val) out[idx] = val;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }

  function missingRequiredDates(item: SageItem, indexes: number[]): boolean {
    const proposals = item.plan?.proposals ?? [];
    return indexes.some((idx) => {
      const p = proposals[idx];
      if (!p || !needsDateField(p)) return false;
      return !(dates[dateKey(item.id, idx)] ?? "").trim();
    });
  }

  async function postProposalAction(
    item: SageItem,
    action: "agree" | "dismiss" | "undo",
    proposal_indexes: number[],
    busyId: string
  ) {
    if (proposal_indexes.length === 0) return;
    if (action === "agree" && missingRequiredDates(item, proposal_indexes)) return;

    setBusyKey(busyId);
    try {
      const datesPayload = action === "agree" ? buildDatesPayload(item, proposal_indexes) : undefined;
      const res = await fetch("/api/sage-inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: item.id,
          action,
          proposal_indexes,
          ...(datesPayload ? { dates: datesPayload } : {}),
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
      console.error("[SageInbox] proposal action failed:", e);
    } finally {
      setBusyKey(null);
    }
  }

  function openCalendarAgree(
    item: SageItem,
    proposalIndex: number,
    queue: number[] = []
  ) {
    const proposals = item.plan?.proposals ?? [];
    const p = proposals[proposalIndex];
    if (!p || p.type !== "calendar_update") return;
    const chosen =
      (dates[dateKey(item.id, proposalIndex)] ?? "").trim() ||
      p.chosen_date ||
      "";
    setCalendarAgree({
      item,
      proposalIndex,
      initialValues: buildCalendarInitialValues(item, p, chosen || undefined),
      queue,
    });
  }

  /** Agree: calendar_update opens AddEventForm; other types record approval only. */
  async function handleAgree(
    item: SageItem,
    proposal_indexes: number[],
    busyId: string
  ) {
    if (proposal_indexes.length === 0) return;
    if (missingRequiredDates(item, proposal_indexes)) return;

    const proposals = item.plan?.proposals ?? [];
    const calendarIdxs = proposal_indexes.filter(
      (i) => proposals[i]?.type === "calendar_update"
    );
    const otherIdxs = proposal_indexes.filter(
      (i) => proposals[i]?.type !== "calendar_update"
    );

    if (otherIdxs.length > 0) {
      await postProposalAction(item, "agree", otherIdxs, busyId);
    } else {
      setSelected((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    }

    if (calendarIdxs.length > 0) {
      const [first, ...rest] = calendarIdxs;
      openCalendarAgree(item, first, rest);
    }
  }

  async function handleCalendarEventCreated(eventId: string) {
    if (!calendarAgree) return;
    const { item, proposalIndex, queue } = calendarAgree;
    const res = await fetch("/api/sage-inbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: item.id,
        action: "execute",
        proposal_index: proposalIndex,
        event_id: eventId,
      }),
    });
    if (!res.ok) return;

    if (queue.length > 0) {
      const [nextIdx, ...rest] = queue;
      openCalendarAgree(item, nextIdx, rest);
      void fetchInbox();
      return;
    }

    setCalendarAgree(null);
    await fetchInbox();
  }

  const sections = groupItems(visibleItems);
  const totalCount = visibleItems.length;
  const emptyMessage =
    statusFilter === "archived"
      ? "No archived items."
      : statusFilter === "flagged"
        ? "No flagged items."
        : search.trim()
          ? "No items match your search."
          : "Sage hasn't flagged anything yet.";

  return (
    <Card className="shadow-card border-border rounded-card">
      <CardContent className="px-4 pt-4 pb-4 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-md min-w-0 sm:w-64 md:w-72">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#B0A899]" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="h-8 w-full min-w-0 rounded-full border border-[#E8E4DC] bg-[#FDFBF7] pl-7 pr-2 text-xs text-[#3D3D3D] placeholder:text-[#B0A899] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E]"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(
                e.target.value as "open" | "flagged" | "archived" | "all"
              )
            }
            className={cn(
              "h-8 w-[90px] shrink-0 rounded-full border px-2 py-1 text-[11px] text-[#3D3D3D] bg-[#FDFBF7] border-[#E8E4DC] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E]",
              statusFilter !== "open" && "bg-[#F2F5EF] border-[#7C8B6E]"
            )}
            aria-label="Filter by status"
          >
            <option value="open">Open</option>
            <option value="flagged">Flagged</option>
            <option value="archived">Archived</option>
            <option value="all">All</option>
          </select>
          <button
            type="button"
            onClick={() => {
              if (itemSelectMode) {
                exitItemSelectMode();
              } else {
                setItemSelectMode(true);
                setSelectedItemIds([]);
              }
            }}
            className={cn(
              "h-8 shrink-0 rounded-full border px-3 text-[11px] text-[#3D3D3D] bg-[#FDFBF7] border-[#E8E4DC] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E]",
              itemSelectMode && "bg-[#F2F5EF] border-[#7C8B6E]"
            )}
          >
            {itemSelectMode ? "Cancel" : "Select"}
          </button>
        </div>
        {itemSelectMode && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#E8E4DC] bg-[#FDFBF7] px-3 py-2">
            <span className="text-[11px] text-[#6A7A6E]">
              {selectedItemIds.length} selected
            </span>
            <Button
              type="button"
              size="sm"
              className="h-7 rounded-full px-3 text-[11px] bg-[#7B9E87] text-white hover:bg-[#6A8A78] disabled:opacity-50"
              disabled={selectedItemIds.length === 0 || bulkBusy}
              onClick={() => setConfirmBulkArchive(true)}
            >
              Archive selected
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 rounded-full px-3 text-[11px] disabled:opacity-50"
              disabled={selectedItemIds.length === 0 || bulkBusy}
              onClick={() => void bulkFlagSelected()}
            >
              Flag selected
            </Button>
            <button
              type="button"
              className="text-[11px] text-[#6A7A6E] hover:underline disabled:opacity-50"
              disabled={bulkBusy}
              onClick={exitItemSelectMode}
            >
              Cancel
            </button>
          </div>
        )}

        <div className="space-y-5">
        {loading ? (
          <p className="text-sm text-foreground-secondary">Loading…</p>
        ) : totalCount === 0 ? (
          <p className="text-sm text-foreground-secondary">{emptyMessage}</p>
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
                  const isArchived = item.status === "archived";
                  const isFlagged = item.flagged === true;
                  const summary = (item.summary ?? "").trim() || "(no summary)";
                  const proposals = Array.isArray(item.plan?.proposals)
                    ? item.plan!.proposals!
                    : [];
                  const actionableCount = proposals.filter(isActionable).length;
                  const isMulti =
                    multiSelect[item.id] === true && actionableCount > 1;
                  const checked = selected[item.id] ?? [];
                  const itemBusy = busyKey?.startsWith(`${item.id}:`) ?? false;
                  const itemChecked = selectedItemIds.includes(item.id);

                  return (
                    <li
                      key={item.id}
                      className="relative rounded-lg border border-[#E8E4DC] bg-white px-3 py-2"
                    >
                      <div className="flex items-start gap-2 min-w-0">
                        {itemSelectMode && (
                          <input
                            type="checkbox"
                            className="mt-1.5 h-4 w-4 shrink-0 rounded border-[#C5D0C0] accent-[#7B9E87]"
                            checked={itemChecked}
                            disabled={bulkBusy}
                            onChange={() => toggleItemSelected(item.id)}
                            aria-label="Select item"
                          />
                        )}
                        <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#F2F5EF] text-[#5B7A52] text-[11px]">
                          {icon}
                        </span>
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm text-foreground line-clamp-2 min-w-0">
                              {summary}
                            </p>
                            <div className="flex shrink-0 items-center gap-0.5">
                              {isArchived && (
                                <span className="mr-1 inline-flex items-center rounded-full border border-[#E2C877] bg-[#FDF6E3] px-2 py-0.5 text-[9px] font-medium text-[#B8960F]">
                                  Archived
                                </span>
                              )}
                              {!itemSelectMode && (
                                <>
                                  <button
                                    type="button"
                                    title={
                                      isFlagged
                                        ? "Remove flag"
                                        : "Flag for reference"
                                    }
                                    aria-label={
                                      isFlagged
                                        ? "Remove flag"
                                        : "Flag for reference"
                                    }
                                    aria-pressed={isFlagged}
                                    onClick={() => void toggleFlag(item)}
                                    className={cn(
                                      "inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors",
                                      isFlagged
                                        ? "text-[#B45309] hover:bg-[#FDF2F0]"
                                        : "text-[#B0A899] hover:bg-[#E8E4DC] hover:text-[#6A7A6E]"
                                    )}
                                  >
                                    <Flag
                                      className={cn(
                                        "h-3.5 w-3.5",
                                        isFlagged && "fill-current"
                                      )}
                                    />
                                  </button>
                                  <button
                                    type="button"
                                    title={isArchived ? "Unarchive" : "Archive"}
                                    aria-label={
                                      isArchived ? "Unarchive" : "Archive"
                                    }
                                    onClick={() => setConfirmArchiveItem(item)}
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#B0A899] transition-colors hover:bg-[#E8E4DC] hover:text-[#6A7A6E]"
                                  >
                                    {isArchived ? (
                                      <ArchiveRestore className="h-3.5 w-3.5" />
                                    ) : (
                                      <Archive className="h-3.5 w-3.5" />
                                    )}
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
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

                      {proposals.length > 0 && (
                        <div
                          className={cn(
                            "mt-3 space-y-2 border-t border-[#E8E4DC] pt-2",
                            itemSelectMode ? "ml-0" : "ml-9"
                          )}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-[11px] font-medium text-[#5B7A52]">
                              Sage suggests
                            </p>
                            {!itemSelectMode && actionableCount > 1 && (
                              <button
                                type="button"
                                className="text-[11px] text-[#5B7A52] hover:underline"
                                onClick={() =>
                                  setMultiSelect((prev) => ({
                                    ...prev,
                                    [item.id]: !isMulti,
                                  }))
                                }
                              >
                                {isMulti ? "Single actions" : "Select multiple"}
                              </button>
                            )}
                          </div>

                          <ul className="space-y-2">
                            {proposals.map((p, idx) => {
                              const blocked = isBlocked(p);
                              const approved = p.approved === true;
                              const waived = isWaived(p);
                              const executed = p.executed === true;
                              const noteOnly = p.type === "note_only";
                              const actionable = isActionable(p);
                              const showDate = actionable && needsDateField(p);
                              const dKey = dateKey(item.id, idx);
                              const isChecked = checked.includes(idx);
                              const rowBusy =
                                busyKey === `${item.id}:${idx}` || itemBusy;

                              return (
                                <li
                                  key={`${item.id}-p-${idx}`}
                                  className={cn(
                                    "flex items-start gap-2 rounded-md px-2 py-1.5",
                                    blocked && "bg-[#F7F5F0] opacity-80"
                                  )}
                                >
                                  {/* Left controls — hidden in item bulk-select mode */}
                                  {itemSelectMode ? null : noteOnly ||
                                    blocked ? (
                                    <span
                                      className="mt-0.5 w-12 shrink-0"
                                      aria-hidden
                                    />
                                  ) : canUndo(p) ? (
                                    <button
                                      type="button"
                                      className="mt-0.5 shrink-0 text-[10px] text-[#5B7A52] hover:underline disabled:opacity-40"
                                      disabled={rowBusy}
                                      onClick={() =>
                                        postProposalAction(
                                          item,
                                          "undo",
                                          [idx],
                                          `${item.id}:${idx}`
                                        )
                                      }
                                    >
                                      Undo
                                    </button>
                                  ) : isMulti ? (
                                    <input
                                      type="checkbox"
                                      className="mt-1 h-4 w-4 shrink-0 rounded border-[#C5D0C0] accent-[#7B9E87]"
                                      checked={isChecked}
                                      disabled={rowBusy}
                                      onChange={() =>
                                        toggleProposal(item.id, idx)
                                      }
                                      aria-label={`Select: ${proposalTypeLabel(p.type)}`}
                                    />
                                  ) : (
                                    <div className="flex shrink-0 items-start gap-1">
                                      <button
                                        type="button"
                                        title="Agree"
                                        disabled={
                                          rowBusy ||
                                          (showDate &&
                                            !(dates[dKey] ?? "").trim())
                                        }
                                        className={cn(
                                          "inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-medium",
                                          "bg-[#7B9E87] text-white hover:bg-[#6A8A78]",
                                          "disabled:opacity-40 disabled:cursor-not-allowed"
                                        )}
                                        onClick={() =>
                                          handleAgree(
                                            item,
                                            [idx],
                                            `${item.id}:${idx}`
                                          )
                                        }
                                      >
                                        ✓
                                      </button>
                                      {isRevisable(p) && (
                                        <button
                                          type="button"
                                          title="Revise"
                                          disabled={rowBusy}
                                          className={cn(
                                            "inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px]",
                                            "border border-[#D5D0C6] bg-white text-foreground-secondary hover:bg-[#F2F5EF]",
                                            "disabled:opacity-40 disabled:cursor-not-allowed"
                                          )}
                                          onClick={() =>
                                            setReviseTarget({
                                              itemId: item.id,
                                              proposalIndex: idx,
                                              proposalType: p.type as
                                                | "reply_coparent"
                                                | "ask_clarification",
                                              originalDraft: p.draft,
                                              initialText:
                                                typeof p.revised_text ===
                                                  "string" &&
                                                p.revised_text.trim()
                                                  ? p.revised_text.trim()
                                                  : p.draft,
                                            })
                                          }
                                        >
                                          ✏️
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        title="Dismiss"
                                        disabled={rowBusy}
                                        className={cn(
                                          "inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px]",
                                          "border border-[#D5D0C6] bg-white text-foreground-secondary hover:bg-[#F2F5EF]",
                                          "disabled:opacity-40 disabled:cursor-not-allowed"
                                        )}
                                        onClick={() =>
                                          postProposalAction(
                                            item,
                                            "dismiss",
                                            [idx],
                                            `${item.id}:${idx}`
                                          )
                                        }
                                      >
                                        ✗
                                      </button>
                                    </div>
                                  )}

                                  <div className="min-w-0 flex-1 space-y-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="inline-flex items-center rounded-full bg-[#EEF2E9] px-2 py-0.5 text-[10px] font-medium text-[#5B7A52]">
                                        {proposalTypeLabel(p.type)}
                                      </span>
                                      {executed ? (
                                        <span className="text-[10px] font-medium text-[#5B7A52]">
                                          ✓ done · added to calendar
                                        </span>
                                      ) : approved ? (
                                        <span className="text-[10px] font-medium text-[#5B7A52]">
                                          ✓ approved
                                        </span>
                                      ) : null}
                                      {typeof p.revised_text === "string" &&
                                        p.revised_text.trim() &&
                                        !approved &&
                                        !waived && (
                                          <span className="text-[10px] text-[#5B7A52]">
                                            revised
                                          </span>
                                        )}
                                      {waived && (
                                        <span className="text-[10px] text-foreground-secondary">
                                          dismissed
                                        </span>
                                      )}
                                      {blocked && !approved && !waived && (
                                        <span className="text-[10px] text-foreground-secondary">
                                          waiting on: {p.depends_on}
                                        </span>
                                      )}
                                    </div>
                                    <p
                                      className={cn(
                                        "text-[12px] leading-snug text-foreground",
                                        (blocked || waived) &&
                                          "text-foreground-secondary"
                                      )}
                                    >
                                      {displayDraft(p, showDate)}
                                    </p>
                                    {!itemSelectMode && showDate && (
                                      <input
                                        type="date"
                                        className="mt-1 h-7 rounded-md border border-[#E8E4DC] bg-white px-2 text-[11px] text-foreground"
                                        value={dates[dKey] ?? ""}
                                        onChange={(e) =>
                                          setDates((prev) => ({
                                            ...prev,
                                            [dKey]: e.target.value,
                                          }))
                                        }
                                        aria-label="Choose date for calendar update"
                                      />
                                    )}
                                    {p.chosen_date && (
                                      <span className="text-[10px] text-foreground-secondary">
                                        date: {p.chosen_date}
                                      </span>
                                    )}
                                  </div>
                                </li>
                              );
                            })}
                          </ul>

                          {!itemSelectMode &&
                            isMulti &&
                            actionableCount > 1 && (
                              <div className="flex flex-wrap items-center gap-2 pt-1">
                                <Button
                                  type="button"
                                  size="sm"
                                  className="h-7 rounded-full px-3 text-[11px] bg-[#7B9E87] text-white hover:bg-[#6A8A78] disabled:opacity-50"
                                  disabled={
                                    checked.length === 0 ||
                                    itemBusy ||
                                    missingRequiredDates(item, checked)
                                  }
                                  onClick={() =>
                                    handleAgree(
                                      item,
                                      checked,
                                      `${item.id}:multi`
                                    )
                                  }
                                >
                                  Agree
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-7 rounded-full px-3 text-[11px] disabled:opacity-50"
                                  disabled={checked.length === 0 || itemBusy}
                                  onClick={() =>
                                    postProposalAction(
                                      item,
                                      "dismiss",
                                      checked,
                                      `${item.id}:multi`
                                    )
                                  }
                                >
                                  Dismiss
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
        </div>
      </CardContent>

      <ReviseProposalModal
        open={reviseTarget !== null}
        proposalType={reviseTarget?.proposalType ?? "reply_coparent"}
        originalDraft={reviseTarget?.originalDraft ?? ""}
        initialText={reviseTarget?.initialText ?? ""}
        itemId={reviseTarget?.itemId ?? ""}
        proposalIndex={reviseTarget?.proposalIndex ?? 0}
        onClose={() => setReviseTarget(null)}
        onSaved={() => {
          setReviseTarget(null);
          void fetchInbox();
        }}
      />

      {calendarAgree && caseId && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-3 py-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sage-add-calendar-title"
          onClick={() => setCalendarAgree(null)}
        >
          <div
            className="relative my-4 w-full max-w-md rounded-2xl border border-[#E8E4DC] bg-[#FDFBF7] p-4 shadow-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2
                id="sage-add-calendar-title"
                className="font-heading text-base font-semibold text-[#3D3D3D]"
              >
                Add to calendar
              </h2>
              <button
                type="button"
                className="rounded-md p-1.5 text-[#8A8A8A] hover:bg-[#E8E4DC] hover:text-[#3D3D3D]"
                aria-label="Close"
                onClick={() => setCalendarAgree(null)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mb-3 text-[11px] text-[#8A8A8A]">
              Review the event details, then click Add Event to put it on your
              calendar.
            </p>
            <AddEventForm
              caseId={caseId}
              children={childrenList}
              initialYear={new Date().getFullYear()}
              initialMonth={new Date().getMonth() + 1}
              initialValues={calendarAgree.initialValues}
              hideHeader
              onSuccess={(eventId) => void handleCalendarEventCreated(eventId)}
            />
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!confirmArchiveItem}
        title={
          confirmArchiveItem?.status === "archived"
            ? "Unarchive item?"
            : "Archive item?"
        }
        description={
          confirmArchiveItem?.status === "archived"
            ? "This item will return to your inbox."
            : "You can find this later under Archived."
        }
        confirmLabel={
          confirmArchiveItem?.status === "archived" ? "Unarchive" : "Archive"
        }
        onCancel={() => setConfirmArchiveItem(null)}
        onConfirm={async () => {
          if (!confirmArchiveItem) return;
          const isArchived = confirmArchiveItem.status === "archived";
          const nextStatus = isArchived ? "pending" : "archived";
          const res = await fetch("/api/sage-inbox", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: confirmArchiveItem.id, status: nextStatus }),
          });
          if (!res.ok) {
            setConfirmArchiveItem(null);
            return;
          }
          setConfirmArchiveItem(null);
          await fetchInbox();
        }}
      />

      <ConfirmModal
        open={confirmBulkArchive && selectedItemIds.length > 0}
        title={`Archive ${selectedItemIds.length} item${selectedItemIds.length === 1 ? "" : "s"}?`}
        description="You can find these later under Archived."
        confirmLabel="Archive"
        onCancel={() => setConfirmBulkArchive(false)}
        onConfirm={() => void bulkArchiveSelected()}
      />
    </Card>
  );
}
