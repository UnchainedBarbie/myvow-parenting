"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Flag,
  MessageCircle,
  Search,
  X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { cn } from "@/lib/utils";
import { ReviseProposalModal } from "@/components/sage/revise-proposal-modal";
import { ProposalCardList } from "@/components/sage/proposal-card-list";
import { TalkToSageDrawer } from "@/components/sage/talk-to-sage-drawer";
import {
  buildCalendarInitialValues,
  buildExpenseInitialValues,
  childNamesFromItem,
  dateKey,
  isActionable,
  needsDateField,
} from "@/components/sage/proposal-helpers";
import type { SageItem, SageProposal } from "@/components/sage/proposal-types";
import {
  AddEventForm,
  type AddEventFormInitialValues,
} from "@/components/calendar/add-event-form";
import {
  ExpenseForm,
  type ExpenseFormInitialValues,
} from "@/components/expenses/expense-form";

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

type CalendarAgreeTarget = {
  item: SageItem;
  proposalIndex: number;
  initialValues: AddEventFormInitialValues;
  queue: number[];
};

type ExpenseAgreeTarget = {
  item: SageItem;
  proposalIndex: number;
  initialValues: ExpenseFormInitialValues;
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
  const [expenseAgree, setExpenseAgree] = useState<ExpenseAgreeTarget | null>(
    null
  );
  const [reviseTarget, setReviseTarget] = useState<{
    itemId: string;
    proposalIndex: number;
    proposalType: "reply_coparent" | "ask_clarification";
    originalDraft: string;
    initialText: string;
  } | null>(null);
  const [talkOpen, setTalkOpen] = useState(false);

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
      if (!p || !needsDateField(p, item)) continue;
      const val = dates[dateKey(item.id, idx)]?.trim();
      if (val) out[idx] = val;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }

  function missingRequiredDates(item: SageItem, indexes: number[]): boolean {
    const proposals = item.plan?.proposals ?? [];
    return indexes.some((idx) => {
      const p = proposals[idx];
      if (!p || !needsDateField(p, item)) return false;
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
    setExpenseAgree(null);
    setCalendarAgree({
      item,
      proposalIndex,
      initialValues: buildCalendarInitialValues(item, p, chosen || undefined),
      queue,
    });
  }

  function openExpenseAgree(
    item: SageItem,
    proposalIndex: number,
    queue: number[] = []
  ) {
    const proposals = item.plan?.proposals ?? [];
    const p = proposals[proposalIndex];
    if (!p || p.type !== "log_expense") return;
    const chosen =
      (dates[dateKey(item.id, proposalIndex)] ?? "").trim() ||
      p.chosen_date ||
      "";
    setCalendarAgree(null);
    setExpenseAgree({
      item,
      proposalIndex,
      initialValues: buildExpenseInitialValues(item, p, chosen || undefined),
      queue,
    });
  }

  function openFormAgree(
    item: SageItem,
    proposalIndex: number,
    queue: number[] = []
  ) {
    const p = item.plan?.proposals?.[proposalIndex];
    if (p?.type === "calendar_update") {
      openCalendarAgree(item, proposalIndex, queue);
    } else if (p?.type === "log_expense") {
      openExpenseAgree(item, proposalIndex, queue);
    }
  }

  /** Agree: calendar_update / log_expense open forms; other types record approval only. */
  async function handleAgree(
    item: SageItem,
    proposal_indexes: number[],
    busyId: string
  ) {
    if (proposal_indexes.length === 0) return;
    if (missingRequiredDates(item, proposal_indexes)) return;

    const proposals = item.plan?.proposals ?? [];
    const formIdxs = proposal_indexes.filter((i) => {
      const t = proposals[i]?.type;
      return t === "calendar_update" || t === "log_expense";
    });
    const otherIdxs = proposal_indexes.filter((i) => {
      const t = proposals[i]?.type;
      return t !== "calendar_update" && t !== "log_expense";
    });

    if (otherIdxs.length > 0) {
      await postProposalAction(item, "agree", otherIdxs, busyId);
    } else {
      setSelected((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    }

    if (formIdxs.length > 0) {
      const [first, ...rest] = formIdxs;
      openFormAgree(item, first, rest);
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
      openFormAgree(item, nextIdx, rest);
      void fetchInbox();
      return;
    }

    setCalendarAgree(null);
    await fetchInbox();
  }

  async function handleExpenseCreated(expenseId: string) {
    if (!expenseAgree) return;
    const { item, proposalIndex, queue } = expenseAgree;
    const res = await fetch("/api/sage-inbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: item.id,
        action: "execute",
        proposal_index: proposalIndex,
        expense_id: expenseId,
      }),
    });
    if (!res.ok) return;

    if (queue.length > 0) {
      const [nextIdx, ...rest] = queue;
      openFormAgree(item, nextIdx, rest);
      void fetchInbox();
      return;
    }

    setExpenseAgree(null);
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
    <>
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

                      <ProposalCardList
                        itemId={item.id}
                        item={item}
                        proposals={proposals}
                        hideActions={itemSelectMode}
                        indent={!itemSelectMode}
                        multiSelect={isMulti}
                        onToggleMultiSelect={() =>
                          setMultiSelect((prev) => ({
                            ...prev,
                            [item.id]: !isMulti,
                          }))
                        }
                        selectedIndexes={checked}
                        onToggleSelected={(idx) =>
                          toggleProposal(item.id, idx)
                        }
                        dates={dates}
                        onDateChange={(key, value) =>
                          setDates((prev) => ({ ...prev, [key]: value }))
                        }
                        busyKey={busyKey}
                        itemBusy={itemBusy}
                        onAgree={(indexes) => {
                          const busyId =
                            indexes.length === 1
                              ? `${item.id}:${indexes[0]}`
                              : `${item.id}:multi`;
                          void handleAgree(item, indexes, busyId);
                        }}
                        onDismiss={(indexes) => {
                          const busyId =
                            indexes.length === 1
                              ? `${item.id}:${indexes[0]}`
                              : `${item.id}:multi`;
                          void postProposalAction(
                            item,
                            "dismiss",
                            indexes,
                            busyId
                          );
                        }}
                        onUndo={(idx) =>
                          void postProposalAction(
                            item,
                            "undo",
                            [idx],
                            `${item.id}:${idx}`
                          )
                        }
                        onRevise={(idx, p: SageProposal) =>
                          setReviseTarget({
                            itemId: item.id,
                            proposalIndex: idx,
                            proposalType: p.type as
                              | "reply_coparent"
                              | "ask_clarification",
                            originalDraft: p.draft,
                            initialText:
                              typeof p.revised_text === "string" &&
                              p.revised_text.trim()
                                ? p.revised_text.trim()
                                : p.draft,
                          })
                        }
                        missingRequiredDates={(indexes) =>
                          missingRequiredDates(item, indexes)
                        }
                        className="mt-3 border-t border-[#E8E4DC] pt-2"
                      />
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

      {expenseAgree && caseId && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-3 py-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sage-add-expense-title"
          onClick={() => setExpenseAgree(null)}
        >
          <div
            className="relative my-4 w-full max-w-md rounded-2xl border border-[#E8E4DC] bg-[#FDFBF7] p-4 shadow-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2
                id="sage-add-expense-title"
                className="font-heading text-base font-semibold text-[#3D3D3D]"
              >
                Add expense
              </h2>
              <button
                type="button"
                className="rounded-md p-1.5 text-[#8A8A8A] hover:bg-[#E8E4DC] hover:text-[#3D3D3D]"
                aria-label="Close"
                onClick={() => setExpenseAgree(null)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mb-3 text-[11px] text-[#8A8A8A]">
              Review the expense details, then click Submit expense to add it to
              your ledger.
            </p>
            <ExpenseForm
              caseId={caseId}
              children={childrenList}
              initialValues={expenseAgree.initialValues}
              hideHeader
              onSuccess={(expenseId) => void handleExpenseCreated(expenseId)}
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
    <button
      type="button"
      onClick={() => setTalkOpen(true)}
      className="fixed bottom-6 right-6 z-40 inline-flex h-12 items-center gap-2 rounded-full bg-[#5B7A52] px-4 text-sm font-medium text-white shadow-lg hover:bg-[#476242]"
    >
      <MessageCircle className="h-4 w-4" />
      Talk to Sage
    </button>
    <TalkToSageDrawer
      open={talkOpen}
      onClose={() => setTalkOpen(false)}
      caseId={caseId}
      children={childrenList}
    />
    </>
  );
}
