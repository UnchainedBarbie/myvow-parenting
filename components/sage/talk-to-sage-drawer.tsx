"use client";

import { useEffect, useRef, useState } from "react";
import { Lock, Send, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProposalCardList } from "@/components/sage/proposal-card-list";
import {
  buildCalendarInitialValues,
  buildExpenseInitialValues,
  dateKey,
  isCalendarUpdateProposal,
  isLogExpenseProposal,
  needsDateField,
} from "@/components/sage/proposal-helpers";
import { SageAgreeFormModal } from "@/components/sage/sage-agree-form-modal";
import type { SageItem, SageProposal } from "@/components/sage/proposal-types";
import {
  AddEventForm,
  type AddEventFormInitialValues,
} from "@/components/calendar/add-event-form";
import {
  ExpenseForm,
  type ExpenseFormInitialValues,
} from "@/components/expenses/expense-form";

type Child = { id: string; first_name: string };

type ChatTurn = {
  id: string;
  role: "user" | "sage";
  text: string;
  /** Local ephemeral item holding proposals for this turn (drawer-only). */
  item?: SageItem;
};

type CalendarTarget = {
  item: SageItem;
  proposalIndex: number;
  initialValues: AddEventFormInitialValues;
};

type ExpenseTarget = {
  item: SageItem;
  proposalIndex: number;
  initialValues: ExpenseFormInitialValues;
};

type ChatApiResponse = {
  reply?: string;
  actions?: SageProposal[];
  meta?: {
    item_type?: string;
    domain?: string;
    summary?: string;
    child_ids?: string[];
    unresolved_children?: string[];
    resolved_dates?: unknown;
    amounts?: unknown;
    dates?: unknown;
  };
  error?: string;
};

function buildLocalItem(
  turnId: string,
  actions: SageProposal[],
  meta: ChatApiResponse["meta"],
  childrenList: Child[]
): SageItem {
  const childIds = Array.isArray(meta?.child_ids) ? meta!.child_ids! : [];
  const childNames = childIds
    .map((id) => childrenList.find((c) => c.id === id)?.first_name)
    .filter((n): n is string => !!n)
    .map((name) => ({ name, confidence: 1 }));

  return {
    id: turnId,
    item_type: meta?.item_type ?? null,
    domain: meta?.domain ?? null,
    summary: meta?.summary ?? null,
    evidence_excerpt: null,
    urgency: null,
    action_required: true,
    child_ids: childIds,
    tool_input: {
      children: childNames,
      resolved_dates: meta?.resolved_dates ?? [],
      amounts: meta?.amounts ?? [],
      dates: meta?.dates ?? [],
    },
    plan: { status: "ready", proposals: actions },
    status: "pending",
    created_at: new Date().toISOString(),
  };
}

export function TalkToSageDrawer({
  open,
  onClose,
  caseId,
  children: childrenList,
}: {
  open: boolean;
  onClose: () => void;
  caseId: string;
  children: Child[];
}) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dates, setDates] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [calendarTarget, setCalendarTarget] = useState<CalendarTarget | null>(
    null
  );
  const [expenseTarget, setExpenseTarget] = useState<ExpenseTarget | null>(
    null
  );
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [open, turns, sending]);

  function updateItemProposals(
    itemId: string,
    updater: (proposals: SageProposal[]) => SageProposal[]
  ) {
    setTurns((prev) =>
      prev.map((t) => {
        if (!t.item || t.item.id !== itemId) return t;
        const proposals = Array.isArray(t.item.plan?.proposals)
          ? t.item.plan!.proposals!
          : [];
        return {
          ...t,
          item: {
            ...t.item,
            plan: { ...(t.item.plan ?? {}), proposals: updater(proposals) },
          },
        };
      })
    );
  }

  async function handleSend() {
    const message = draft.trim();
    if (!message || sending || !caseId) return;
    setError(null);
    setSending(true);
    const userTurnId = `u-${Date.now()}`;
    setTurns((prev) => [
      ...prev,
      { id: userTurnId, role: "user", text: message },
    ]);
    setDraft("");

    try {
      const res = await fetch("/api/sage/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = (await res.json().catch(() => ({}))) as ChatApiResponse;
      if (!res.ok) {
        throw new Error(data.error || "Sage could not respond");
      }
      const sageTurnId = `s-${Date.now()}`;
      const actions = Array.isArray(data.actions) ? data.actions : [];
      const item =
        actions.length > 0
          ? buildLocalItem(sageTurnId, actions, data.meta, childrenList)
          : undefined;
      setTurns((prev) => [
        ...prev,
        {
          id: sageTurnId,
          role: "sage",
          text: (data.reply ?? "I can help with that.").trim(),
          item,
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSending(false);
    }
  }

  function handleAgree(item: SageItem, indexes: number[]) {
    if (indexes.length === 0) return;
    const proposals = item.plan?.proposals ?? [];
    const idx = indexes[0];
    const p = proposals[idx];
    if (!p) return;

    if (isCalendarUpdateProposal(p.type)) {
      const dKey = dateKey(item.id, idx);
      const chosen = (dates[dKey] ?? "").trim() || p.chosen_date || "";
      if (needsDateField(p, item) && !chosen) return;
      setExpenseTarget(null);
      setCalendarTarget({
        item,
        proposalIndex: idx,
        initialValues: buildCalendarInitialValues(
          item,
          p,
          chosen || undefined
        ),
      });
      return;
    }

    if (isLogExpenseProposal(p.type)) {
      const dKey = dateKey(item.id, idx);
      const chosen = (dates[dKey] ?? "").trim() || p.chosen_date || "";
      setCalendarTarget(null);
      setExpenseTarget({
        item,
        proposalIndex: idx,
        initialValues: buildExpenseInitialValues(
          item,
          p,
          chosen || undefined
        ),
      });
      return;
    }

    // Non-calendar: record-only locally (same as inbox — outbound not wired)
    setBusyKey(`${item.id}:${idx}`);
    updateItemProposals(item.id, (list) =>
      list.map((prop, i) =>
        indexes.includes(i)
          ? {
              ...prop,
              approved: true,
              approved_at: new Date().toISOString(),
              ...(dates[dateKey(item.id, i)]
                ? { chosen_date: dates[dateKey(item.id, i)] }
                : {}),
            }
          : prop
      )
    );
    setBusyKey(null);
  }

  function handleDismiss(item: SageItem, indexes: number[]) {
    updateItemProposals(item.id, (list) =>
      list.map((prop, i) =>
        indexes.includes(i)
          ? {
              ...prop,
              status: "waived_by_user",
              waived_at: new Date().toISOString(),
            }
          : prop
      )
    );
  }

  function handleUndo(item: SageItem, index: number) {
    updateItemProposals(item.id, (list) =>
      list.map((prop, i) => {
        if (i !== index) return prop;
        if (prop.executed) return prop;
        const next = { ...prop };
        delete next.approved;
        delete next.approved_at;
        delete next.chosen_date;
        delete next.status;
        delete next.waived_at;
        return next;
      })
    );
  }

  async function handleCalendarCreated(eventId: string) {
    if (!calendarTarget) return;
    const { item, proposalIndex } = calendarTarget;
    // v1: mark done in drawer only — history/inbox sage_item write deferred
    updateItemProposals(item.id, (list) =>
      list.map((prop, i) =>
        i === proposalIndex
          ? {
              ...prop,
              approved: true,
              approved_at: prop.approved_at ?? new Date().toISOString(),
              executed: true,
              executed_at: new Date().toISOString(),
              result_event_id: eventId,
            }
          : prop
      )
    );
    setCalendarTarget(null);
  }

  async function handleExpenseCreated(expenseId: string) {
    if (!expenseTarget) return;
    const { item, proposalIndex } = expenseTarget;
    updateItemProposals(item.id, (list) =>
      list.map((prop, i) =>
        i === proposalIndex
          ? {
              ...prop,
              approved: true,
              approved_at: prop.approved_at ?? new Date().toISOString(),
              executed: true,
              executed_at: new Date().toISOString(),
              result_expense_id: expenseId,
            }
          : prop
      )
    );
    setExpenseTarget(null);
  }

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex justify-end bg-black/10"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          className="flex h-full w-full max-w-[480px] flex-col border-l border-[#E8E4DC] bg-[#FDFBF7] shadow-card animate-[sageDrawer_200ms_ease-out_forwards]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="talk-to-sage-title"
        >
          <div className="sticky top-0 z-10 border-b border-[#E8E4DC] bg-[#FDFBF7]">
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              <div className="flex items-center gap-2">
                <div
                  style={{
                    width: "52px",
                    height: "52px",
                    borderRadius: "50%",
                    backgroundColor: "#dce5d3",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <div style={{ isolation: "isolate" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/dove-translucent.png"
                      alt=""
                      style={{
                        width: "34px",
                        height: "34px",
                        objectFit: "contain",
                        display: "block",
                        mixBlendMode: "multiply",
                      }}
                    />
                  </div>
                </div>
                <div>
                  <p
                    id="talk-to-sage-title"
                    className="text-sm font-semibold text-[#3D3D3D]"
                  >
                    Talk to Sage
                  </p>
                  <p className="flex items-center gap-1 text-[11px] text-[#8A8A8A]">
                    <Lock className="h-3 w-3 text-[#7C8B6E]" />
                    <span>Private — not visible to your co-parent.</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[#8A8A8A] hover:bg-muted hover:text-[#3D3D3D]"
              >
                <X className="h-6 w-6" />
              </button>
            </div>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {turns.length === 0 && (
              <p className="text-[12px] text-[#8A8A8A]">
                Tell Sage what you need — for example, add a dentist appointment
                or move a pickup time. Sage will propose actions you can approve.
              </p>
            )}
            {turns.map((t) => {
              const isSage = t.role === "sage";
              return (
                <div key={t.id} className="space-y-2">
                  <div
                    className={cn(
                      "flex max-w-[90%] gap-2 items-start",
                      isSage ? "mr-auto" : "ml-auto flex-row-reverse"
                    )}
                  >
                    <div
                      className={cn(
                        "rounded-2xl px-3 py-2 text-[13px] leading-snug",
                        isSage
                          ? "bg-white border border-[#E8E4DC] text-[#3D3D3D]"
                          : "bg-[#E8F0E4] text-[#3D3D3D]"
                      )}
                    >
                      {t.text}
                    </div>
                  </div>
                  {t.item && (t.item.plan?.proposals?.length ?? 0) > 0 && (
                    <div className="rounded-xl border border-[#E8E4DC] bg-white px-2 py-2">
                      <ProposalCardList
                        itemId={t.item.id}
                        item={t.item}
                        proposals={t.item.plan!.proposals!}
                        indent={false}
                        dates={dates}
                        onDateChange={(key, value) =>
                          setDates((prev) => ({ ...prev, [key]: value }))
                        }
                        busyKey={busyKey}
                        onAgree={(indexes) => handleAgree(t.item!, indexes)}
                        onDismiss={(indexes) =>
                          handleDismiss(t.item!, indexes)
                        }
                        onUndo={(index) => handleUndo(t.item!, index)}
                        missingRequiredDates={(indexes) =>
                          indexes.some((idx) => {
                            const p = t.item!.plan!.proposals![idx];
                            if (!p || !needsDateField(p, t.item)) return false;
                            return !(
                              dates[dateKey(t.item!.id, idx)] ?? ""
                            ).trim();
                          })
                        }
                      />
                    </div>
                  )}
                </div>
              );
            })}
            {sending && (
              <p className="text-[11px] text-[#8A8A8A]">Sage is thinking…</p>
            )}
            {error && (
              <p className="text-[11px] text-[#C3442D]" role="alert">
                {error}
              </p>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="border-t border-[#E8E4DC] bg-[#FDFBF7] px-3 py-3">
            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                rows={2}
                placeholder="Tell Sage what to do…"
                disabled={sending || !caseId}
                className="min-h-[40px] flex-1 resize-none rounded-xl border border-[#E8E4DC] bg-white px-3 py-2 text-[13px] text-[#3D3D3D] placeholder:text-[#B0A899] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E] disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={sending || !draft.trim() || !caseId}
                aria-label="Send"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#5B7A52] text-white hover:bg-[#476242] disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {calendarTarget && caseId && (
        <SageAgreeFormModal
          title="Add to calendar"
          titleId="talk-sage-add-calendar-title"
          hint="Review the event details, then click Add Event to put it on your calendar."
          onClose={() => setCalendarTarget(null)}
        >
          <AddEventForm
            caseId={caseId}
            children={childrenList}
            initialYear={new Date().getFullYear()}
            initialMonth={new Date().getMonth() + 1}
            initialValues={calendarTarget.initialValues}
            hideHeader
            onSuccess={(eventId) => void handleCalendarCreated(eventId)}
          />
        </SageAgreeFormModal>
      )}

      {expenseTarget && caseId && (
        <SageAgreeFormModal
          title="Add expense"
          titleId="talk-sage-add-expense-title"
          hint="Review the expense details, then click Submit expense to add it to your ledger."
          onClose={() => setExpenseTarget(null)}
        >
          <ExpenseForm
            key={`${expenseTarget.item.id}:${expenseTarget.proposalIndex}`}
            caseId={caseId}
            children={childrenList}
            initialValues={expenseTarget.initialValues}
            hideHeader
            onSuccess={(expenseId) => void handleExpenseCreated(expenseId)}
          />
        </SageAgreeFormModal>
      )}
    </>
  );
}
