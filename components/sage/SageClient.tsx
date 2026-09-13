"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { showErrorToast } from "@/components/ui/toaster";
import { MessageSquare, PenLine, FileText } from "lucide-react";
import { ProposalCardList } from "@/components/sage/proposal-card-list";
import { ReviseProposalModal } from "@/components/sage/revise-proposal-modal";
import {
  buildCalendarInitialValues,
  buildExpenseInitialValues,
  dateKey,
  isCalendarUpdateProposal,
  isFormExecuteProposal,
  isLogExpenseProposal,
  needsDateField,
} from "@/components/sage/proposal-helpers";
import { SageAgreeFormModal } from "@/components/sage/sage-agree-form-modal";
import type { SageItem, SagePlan, SageProposal } from "@/components/sage/proposal-types";
import {
  AddEventForm,
  type AddEventFormInitialValues,
} from "@/components/calendar/add-event-form";
import {
  ExpenseForm,
  type ExpenseFormInitialValues,
} from "@/components/expenses/expense-form";

export type SageMessage = {
  id: string;
  user_id: string;
  role: "user" | "sage";
  content: string;
  created_at: string;
  sage_item_id?: string | null;
  sage_item?: SageItem | null;
};

const SAGE_PILL_CLASS =
  "rounded-full border border-[#7C8B6E] bg-transparent px-2.5 py-1 text-[11px] text-[#5B7A52] hover:bg-[#F2F5EF] transition-colors";

const SAGE_ACTION_PILL =
  "inline-flex items-center gap-1.5 rounded-full border border-[#7C8B6E] bg-transparent px-2.5 py-1.5 text-[11px] text-[#5B7A52] hover:bg-[#F2F5EF] transition-colors";

type Child = { id: string; first_name: string };

type CalendarAgreeTarget = {
  item: SageItem;
  proposalIndex: number;
  initialValues: AddEventFormInitialValues;
  queue: number[];
  caseId: string;
};

type ExpenseAgreeTarget = {
  item: SageItem;
  proposalIndex: number;
  initialValues: ExpenseFormInitialValues;
  queue: number[];
  caseId: string;
};

interface SageClientProps {
  sessionId: string | null;
  sessionTitle?: string | null;
  onSessionTitleGenerated?: () => void;
  onOpenDraftAssistant?: () => void;
  initialDraft?: string | null;
  onConsumeInitialDraft?: () => void;
}

export function SageClient({
  sessionId,
  sessionTitle,
  onSessionTitleGenerated,
  onOpenDraftAssistant,
  initialDraft,
  onConsumeInitialDraft,
}: SageClientProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<SageMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [writePrivatelyPlaceholder, setWritePrivatelyPlaceholder] = useState(false);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [childrenList, setChildrenList] = useState<Child[]>([]);
  const [dates, setDates] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [multiSelect, setMultiSelect] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Record<string, number[]>>({});
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
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (initialDraft != null && initialDraft.trim()) {
      setDraft(initialDraft.trim());
      onConsumeInitialDraft?.();
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [initialDraft, onConsumeInitialDraft]);

  const loadMessages = useCallback(async (sid: string | null) => {
    if (sid === null) {
      setMessages([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/sage/messages?session_id=${encodeURIComponent(sid)}`
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const payload = data as {
          messages?: SageMessage[];
          case_id?: string | null;
          children?: Child[];
        };
        setMessages(payload.messages ?? []);
        setCaseId(payload.case_id ?? null);
        setChildrenList(Array.isArray(payload.children) ? payload.children : []);
      } else {
        setMessages([]);
      }
    } catch {
      showErrorToast("Could not load Sage history.");
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMessages(sessionId);
  }, [sessionId, loadMessages]);

  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages.length]);

  function patchItemPlan(itemId: string, plan: SagePlan) {
    setMessages((prev) =>
      prev.map((m) =>
        m.sage_item?.id === itemId
          ? { ...m, sage_item: { ...m.sage_item, plan } }
          : m
      )
    );
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
      const datesPayload =
        action === "agree" ? buildDatesPayload(item, proposal_indexes) : undefined;
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
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        plan?: SagePlan;
      };
      if (!res.ok) return;
      setSelected((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      if (data.plan) patchItemPlan(item.id, data.plan);
    } catch (e) {
      console.error("[SageClient] proposal action failed:", e);
    } finally {
      setBusyKey(null);
    }
  }

  function openCalendarAgree(
    item: SageItem,
    proposalIndex: number,
    queue: number[] = [],
    formCaseId: string
  ) {
    const proposals = item.plan?.proposals ?? [];
    const p = proposals[proposalIndex];
    if (!p || !isCalendarUpdateProposal(p.type)) return;
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
      caseId: formCaseId,
    });
  }

  function openExpenseAgree(
    item: SageItem,
    proposalIndex: number,
    queue: number[] = [],
    formCaseId: string
  ) {
    const proposals = item.plan?.proposals ?? [];
    const p = proposals[proposalIndex];
    if (!p || !isLogExpenseProposal(p.type)) return;
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
      caseId: formCaseId,
    });
  }

  function openFormAgree(
    item: SageItem,
    proposalIndex: number,
    queue: number[] = [],
    formCaseId: string
  ) {
    const p = item.plan?.proposals?.[proposalIndex];
    if (isCalendarUpdateProposal(p?.type)) {
      openCalendarAgree(item, proposalIndex, queue, formCaseId);
    } else if (isLogExpenseProposal(p?.type)) {
      openExpenseAgree(item, proposalIndex, queue, formCaseId);
    }
  }

  async function handleAgree(
    item: SageItem,
    proposal_indexes: number[],
    busyId: string
  ) {
    if (proposal_indexes.length === 0) return;
    if (missingRequiredDates(item, proposal_indexes)) return;

    const proposals = item.plan?.proposals ?? [];
    const formIdxs = proposal_indexes.filter((i) =>
      isFormExecuteProposal(proposals[i]?.type)
    );
    const otherIdxs = proposal_indexes.filter(
      (i) => !isFormExecuteProposal(proposals[i]?.type)
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

    if (formIdxs.length > 0) {
      let formCaseId = caseId;
      if (!formCaseId) {
        const res = await fetch(
          `/api/sage/messages?session_id=${encodeURIComponent(sessionId ?? "")}`
        );
        const data = (await res.json().catch(() => ({}))) as {
          case_id?: string | null;
          children?: Child[];
        };
        if (data.case_id) {
          formCaseId = data.case_id;
          setCaseId(data.case_id);
        }
        if (Array.isArray(data.children)) setChildrenList(data.children);
      }
      if (!formCaseId) {
        showErrorToast("Couldn't open the form — no case found.");
        return;
      }
      const [first, ...rest] = formIdxs;
      openFormAgree(item, first, rest, formCaseId);
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
    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      plan?: SagePlan;
    };
    if (!res.ok) return;
    const updatedItem = data.plan ? { ...item, plan: data.plan } : item;
    if (data.plan) patchItemPlan(item.id, data.plan);

    if (queue.length > 0) {
      const [nextIdx, ...rest] = queue;
      openFormAgree(updatedItem, nextIdx, rest, calendarAgree.caseId);
      return;
    }

    setCalendarAgree(null);
  }

  async function handleExpenseCreated(expenseId: string) {
    if (!expenseAgree) return;
    const { item, proposalIndex, queue, caseId: formCaseId } = expenseAgree;
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
    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      plan?: SagePlan;
    };
    if (!res.ok) {
      showErrorToast("Expense was saved, but Sage couldn't mark the proposal done.");
      setExpenseAgree(null);
      return;
    }
    const updatedItem = data.plan ? { ...item, plan: data.plan } : item;
    if (data.plan) patchItemPlan(item.id, data.plan);

    if (queue.length > 0) {
      const [nextIdx, ...rest] = queue;
      openFormAgree(updatedItem, nextIdx, rest, formCaseId);
      return;
    }

    setExpenseAgree(null);
  }

  async function handleSend() {
    const content = draft.trim();
    if (!content || sending) return;
    if (sessionId === null) return;
    const wasFirstMessage = messages.length === 0;
    setSending(true);
    try {
      const optimisticUser: SageMessage = {
        id: `local-${Date.now()}`,
        user_id: "me",
        role: "user",
        content,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimisticUser]);
      setDraft("");

      const res = await fetch("/api/sage/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, session_id: sessionId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showErrorToast(
          (data as { message?: string }).message ?? "Sage is unavailable right now."
        );
        return;
      }
      const payload = data as {
        user_message?: SageMessage;
        sage_message?: SageMessage;
        sage_item?: SageItem | null;
        case_id?: string | null;
      };
      if (payload.case_id) setCaseId(payload.case_id);
      const userMsg = payload.user_message;
      const sageMsg = payload.sage_message
        ? {
            ...payload.sage_message,
            sage_item:
              payload.sage_message.sage_item ?? payload.sage_item ?? null,
          }
        : undefined;
      setMessages((prev) => {
        const base = prev.filter((m) => !m.id.startsWith("local-"));
        return [...base, ...(userMsg ? [userMsg] : []), ...(sageMsg ? [sageMsg] : [])];
      });

      if (wasFirstMessage) {
        fetch("/api/sage/title-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            firstMessage: content,
            sessionId,
          }),
        })
          .then((r) => r.json())
          .then(() => {
            onSessionTitleGenerated?.();
          })
          .catch(() => {});
      }
    } catch {
      showErrorToast("Something went wrong. Try again.");
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  const showActionButtons =
    !loading &&
    messages.length > 0 &&
    lastMessage?.role === "sage" &&
    !writePrivatelyPlaceholder;

  return (
    <div className="rounded-2xl border border-border bg-background-secondary/40 p-3 md:p-4 flex flex-col gap-3 w-full h-full min-h-[60vh]">
      <div className="rounded-card border border-border bg-background shadow-card flex-1 min-h-[220px] overflow-hidden">
        <ScrollArea className="h-full px-3 py-3">
          <div className="space-y-3 text-sm">
            {loading ? (
              <p className="text-foreground-secondary text-xs">Loading your reflections…</p>
            ) : messages.length === 0 ? (
              <p className="text-foreground-secondary text-xs">
                This is your private space with Sage. Share a thought, a draft, or a question to begin.
              </p>
            ) : (
              <>
                {messages.map((msg) => {
                  const isUser = msg.role === "user";
                  const item = msg.sage_item ?? null;
                  const proposals = item?.plan?.proposals ?? [];
                  const isMulti = item ? multiSelect[item.id] === true : false;
                  const itemBusy = item
                    ? busyKey?.startsWith(`${item.id}:`) ?? false
                    : false;
                  return (
                    <div key={msg.id} className="space-y-2">
                      <div
                        className={cn(
                          "flex",
                          isUser ? "justify-end" : "justify-start"
                        )}
                      >
                        <div
                          className={cn(
                            "max-w-[75%] rounded-2xl px-3 py-2 text-[13px] leading-snug",
                            isUser
                              ? "bg-[#5B7A52] text-white rounded-br-sm"
                              : "bg-[#FDFBF7] text-foreground rounded-bl-sm border border-[#E8E4DC]"
                          )}
                        >
                          <p className="whitespace-pre-wrap">{msg.content}</p>
                        </div>
                      </div>
                      {!isUser && item && proposals.length > 0 && (
                        <div className="max-w-[90%] rounded-xl border border-[#E8E4DC] bg-white px-2 py-2">
                          <ProposalCardList
                            itemId={item.id}
                            item={item}
                            proposals={proposals}
                            indent={false}
                            multiSelect={isMulti}
                            onToggleMultiSelect={() =>
                              setMultiSelect((prev) => ({
                                ...prev,
                                [item.id]: !isMulti,
                              }))
                            }
                            selectedIndexes={selected[item.id] ?? []}
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
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>
      </div>

      <div className="space-y-2">
        <Textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            writePrivatelyPlaceholder
              ? "Write what's on your mind. This stays here."
              : "Write a thought, paste a message, or ask Sage for help."
          }
          className="min-h-[72px] max-h-[140px] resize-y rounded-card border-border bg-background text-sm"
        />
        <div className="flex items-center justify-end">
          <Button
            type="button"
            size="sm"
            className="rounded-full h-8 px-4 bg-[#5B7A52] text-xs text-white hover:bg-[#476242]"
            disabled={sending || !draft.trim()}
            onClick={() => void handleSend()}
          >
            {sending ? "Thinking…" : "Send"}
          </Button>
        </div>
      </div>

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
          void loadMessages(sessionId);
        }}
      />

      {calendarAgree && (
        <SageAgreeFormModal
          title="Add to calendar"
          titleId="sage-chat-add-calendar-title"
          hint="Review the event details, then click Add Event to put it on your calendar."
          onClose={() => setCalendarAgree(null)}
        >
          <AddEventForm
            caseId={calendarAgree.caseId}
            children={childrenList}
            initialYear={new Date().getFullYear()}
            initialMonth={new Date().getMonth() + 1}
            initialValues={calendarAgree.initialValues}
            hideHeader
            onSuccess={(eventId) => void handleCalendarEventCreated(eventId)}
          />
        </SageAgreeFormModal>
      )}

      {expenseAgree && (
        <SageAgreeFormModal
          title="Add expense"
          titleId="sage-chat-add-expense-title"
          hint="Review the expense details, then click Submit expense to add it to your ledger."
          onClose={() => setExpenseAgree(null)}
        >
          <ExpenseForm
            key={`${expenseAgree.item.id}:${expenseAgree.proposalIndex}`}
            caseId={expenseAgree.caseId}
            children={childrenList}
            initialValues={expenseAgree.initialValues}
            hideHeader
            onSuccess={(expenseId) => void handleExpenseCreated(expenseId)}
          />
        </SageAgreeFormModal>
      )}
    </div>
  );
}
