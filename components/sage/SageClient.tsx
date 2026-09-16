"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { showErrorToast } from "@/components/ui/toaster";
import { Paperclip, Camera, X, FileText } from "lucide-react";
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
  createSageSession,
  notifySageSessionsChanged,
  sageChatHref,
} from "@/lib/sage-sessions-client";
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

const CHAT_ACCEPT = "image/*,.pdf,application/pdf";
const CHAT_ACCEPT_LABEL = "PDF, JPG, PNG";
const CHAT_MAX_BYTES = 25 * 1024 * 1024;
const CHAT_ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
];

type Child = { id: string; first_name: string };

type ChatAttachedDoc = {
  document_id: string;
  file_name: string;
  url: string;
};

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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const uploadPromiseRef = useRef<Promise<ChatAttachedDoc | null> | null>(null);
  const attachGenRef = useRef(0);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [attachedDoc, setAttachedDoc] = useState<ChatAttachedDoc | null>(null);
  const [attachUploading, setAttachUploading] = useState(false);
  const [composerDrag, setComposerDrag] = useState(false);

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
    const t = window.setTimeout(() => textareaRef.current?.focus(), 80);
    return () => window.clearTimeout(t);
  }, [sessionId]);

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

  async function reenterForcedAttachment(
    item: SageItem,
    proposalIndex: number,
    proposal: SageProposal
  ) {
    const sid = sessionId;
    if (!sid) {
      showErrorToast("Couldn't continue with that file.");
      return;
    }
    const caption = (proposal.draft ?? "").trim() || "Log this file";
    setSending(true);
    try {
      const res = await fetch("/api/sage/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: caption,
          session_id: sid,
          sage_item_id: item.id,
          proposal_index: proposalIndex,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showErrorToast(
          (data as { message?: string }).message ??
            "Sage is unavailable right now."
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
      setMessages((prev) => [
        ...prev,
        ...(userMsg ? [userMsg] : []),
        ...(sageMsg ? [sageMsg] : []),
      ]);
    } catch {
      showErrorToast("Something went wrong. Try again.");
    } finally {
      setSending(false);
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
    const chosenIndex = proposal_indexes[0];
    const chosen = proposals[chosenIndex];
    const forceType = (chosen as SageProposal & { force_type?: unknown } | undefined)
      ?.force_type;
    if (
      chosen &&
      (forceType === "expense" ||
        forceType === "event" ||
        forceType === "document")
    ) {
      await postProposalAction(item, "agree", proposal_indexes, busyId);
      await reenterForcedAttachment(item, chosenIndex, chosen);
      return;
    }

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

  async function ensureCaseId(): Promise<string | null> {
    if (caseId) return caseId;
    try {
      const qs = sessionId
        ? `?session_id=${encodeURIComponent(sessionId)}`
        : "";
      const res = await fetch(`/api/sage/messages${qs}`);
      const data = (await res.json().catch(() => ({}))) as {
        case_id?: string | null;
        children?: Child[];
      };
      if (data.case_id) {
        setCaseId(data.case_id);
        if (Array.isArray(data.children)) setChildrenList(data.children);
        return data.case_id;
      }
    } catch {
      // fall through
    }
    return null;
  }

  async function uploadChatDocument(
    file: File,
    cid: string
  ): Promise<ChatAttachedDoc> {
    const formData = new FormData();
    formData.set("file", file);
    formData.set("case_id", cid);
    formData.set("category", "expenses");
    formData.set("visibility", "parents_only");
    const base =
      file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() ||
      "Receipt";
    formData.set("title", base.slice(0, 120));
    formData.set("description", "Receipt attached in Sage chat.");
    const res = await fetch("/api/documents/upload", {
      method: "POST",
      body: formData,
    });
    const data = (await res.json().catch(() => ({}))) as {
      document_id?: string;
      message?: string;
    };
    if (!res.ok || !data.document_id) {
      throw new Error(data.message || "Couldn't upload the file.");
    }
    return {
      document_id: data.document_id,
      file_name: file.name,
      url: `/api/documents/${data.document_id}/download`,
    };
  }

  function isAllowedChatFile(file: File): boolean {
    if (file.size > CHAT_MAX_BYTES) return false;
    return (
      CHAT_ALLOWED_TYPES.includes(file.type) || file.type.startsWith("image/")
    );
  }

  async function handleComposerFile(file: File | null) {
    const gen = ++attachGenRef.current;
    if (!file) {
      setPendingFile(null);
      setAttachedDoc(null);
      uploadPromiseRef.current = null;
      setAttachUploading(false);
      return;
    }
    if (!isAllowedChatFile(file)) {
      showErrorToast(`Accepted: ${CHAT_ACCEPT_LABEL} (up to 25MB).`);
      return;
    }
    setPendingFile(file);
    setAttachedDoc(null);
    setAttachUploading(true);
    const p = (async () => {
      const cid = await ensureCaseId();
      if (!cid) {
        throw new Error("Couldn't upload — no case found.");
      }
      return uploadChatDocument(file, cid);
    })();
    uploadPromiseRef.current = p;
    try {
      const doc = await p;
      if (gen !== attachGenRef.current) return;
      setAttachedDoc(doc);
    } catch (e) {
      if (gen !== attachGenRef.current) return;
      showErrorToast(
        e instanceof Error ? e.message : "Couldn't upload the file."
      );
      setPendingFile(null);
      setAttachedDoc(null);
      uploadPromiseRef.current = null;
    } finally {
      if (gen === attachGenRef.current) setAttachUploading(false);
    }
  }

  async function handleSend() {
    const content = draft.trim();
    if (sending) return;

    let attachment = attachedDoc;
    if (!attachment && uploadPromiseRef.current) {
      try {
        attachment = await uploadPromiseRef.current;
      } catch {
        return;
      }
    }
    if (!content && !attachment) return;

    const wasFirstMessage = messages.length === 0;
    const fileLabel = attachment?.file_name ?? pendingFile?.name ?? "file";
    const optimisticContent = attachment
      ? content
        ? `${content}\n\nAttached: ${fileLabel}`
        : `Attached: ${fileLabel}`
      : content;
    setSending(true);
    try {
      let sid = sessionId;
      if (sid === null) {
        const created = await createSageSession("private");
        sid = created.id;
      }
      const optimisticUser: SageMessage = {
        id: `local-${Date.now()}`,
        user_id: "me",
        role: "user",
        content: optimisticContent,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimisticUser]);
      setDraft("");
      setPendingFile(null);
      setAttachedDoc(null);
      uploadPromiseRef.current = null;

      const res = await fetch("/api/sage/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(content ? { content } : {}),
          session_id: sid,
          ...(attachment
            ? {
                attachment: {
                  document_id: attachment.document_id,
                  file_name: attachment.file_name,
                },
              }
            : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showErrorToast(
          (data as { message?: string }).message ?? "Sage is unavailable right now."
        );
        if (sessionId === null && sid) {
          router.replace(sageChatHref(sid));
        }
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
            firstMessage: content || `Receipt: ${fileLabel}`,
            sessionId: sid,
          }),
        })
          .then((r) => r.json())
          .then(() => {
            onSessionTitleGenerated?.();
            notifySageSessionsChanged();
          })
          .catch(() => {});
      }

      if (sessionId === null && sid) {
        router.replace(sageChatHref(sid));
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
          <div className="space-y-3 text-base">
            {loading ? (
              <p className="text-foreground-secondary text-sm">Loading your reflections…</p>
            ) : messages.length === 0 ? (
              <p className="text-foreground-secondary text-sm">
                Start typing below. This is your private space with Sage.
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
                            "max-w-[75%] rounded-2xl px-3.5 py-2.5 text-base leading-relaxed",
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

      <div
        className={cn(
          "space-y-2 rounded-card transition-colors",
          composerDrag ? "bg-primary/5" : ""
        )}
        onDragEnter={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setComposerDrag(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setComposerDrag(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setComposerDrag(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setComposerDrag(false);
          const file = e.dataTransfer.files?.[0] ?? null;
          if (file) void handleComposerFile(file);
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={CHAT_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            e.target.value = "";
            if (file) void handleComposerFile(file);
          }}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            e.target.value = "";
            if (file) void handleComposerFile(file);
          }}
        />
        {pendingFile && (
          <div className="flex items-center gap-2 rounded-card border border-border bg-background px-2 py-1.5">
            <FileText className="h-4 w-4 text-foreground-secondary shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-foreground truncate" title={pendingFile.name}>
                {pendingFile.name}
              </p>
              <p className="text-[11px] text-foreground-secondary">
                {attachUploading
                  ? "Uploading…"
                  : attachedDoc
                    ? "Attached"
                    : CHAT_ACCEPT_LABEL}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleComposerFile(null)}
              className="p-1 rounded hover:bg-muted text-foreground-secondary"
              aria-label="Remove attached file"
              disabled={sending}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <Textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            writePrivatelyPlaceholder
              ? "Write what's on your mind. This stays here."
              : pendingFile
                ? "Add a note, or send the file…"
                : "Start typing or attach a receipt…"
          }
          className="min-h-[72px] max-h-[140px] resize-y rounded-card border-border bg-background text-base"
        />
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className={SAGE_ACTION_PILL}
              onClick={() => fileInputRef.current?.click()}
              disabled={sending || attachUploading}
              aria-label="Attach file"
            >
              <Paperclip className="h-3.5 w-3.5" aria-hidden />
              Attach
            </button>
            <button
              type="button"
              className={SAGE_ACTION_PILL}
              onClick={() => cameraInputRef.current?.click()}
              disabled={sending || attachUploading}
              aria-label="Take photo"
            >
              <Camera className="h-3.5 w-3.5" aria-hidden />
              Take photo
            </button>
          </div>
          <Button
            type="button"
            size="sm"
            className="rounded-full h-8 px-4 bg-[#5B7A52] text-xs text-white hover:bg-[#476242]"
            disabled={
              sending ||
              (!draft.trim() && !attachedDoc && !pendingFile)
            }
            onClick={() => void handleSend()}
          >
            {sending ? "Thinking…" : attachUploading ? "Uploading…" : "Send"}
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
