"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Shield,
  Search,
  Plus,
  MessageCircle,
  Calendar as CalendarIcon,
  Receipt,
  Paperclip,
  ScrollText,
  Lock,
  X,
  Trash2,
  MoreVertical,
  Pin,
  Flag,
  Archive,
  ArchiveRestore,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageBubble, type MessageRow } from "./message-bubble";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { estimateIntensity } from "@/lib/sage/intensity";
import { showErrorToast, showSuccessToast } from "@/components/ui/toaster";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { AlertCircle } from "lucide-react";

type ChildSummary = { id: string; first_name: string };

const CONVERSATION_TOPICS = [
  { value: "medical", label: "Medical" },
  { value: "school", label: "School" },
  { value: "schedule", label: "Schedule" },
  { value: "expense", label: "Expenses" },
  { value: "general", label: "General" },
  { value: "emergency", label: "Emergency" },
] as const;

function getTopicLabel(topic: string | undefined | null): string {
  if (!topic) return "General";
  const t = topic.toLowerCase();
  const found = CONVERSATION_TOPICS.find((x) => x.value === t);
  if (found) return found.label;
  if (t === "expense" || t === "expenses") return "Expenses";
  return topic.charAt(0).toUpperCase() + topic.slice(1);
}

type ConversationSummary = {
  id: string;
  case_id: string;
  subject: string;
  child_id: string | null;
  created_at: string;
  updated_at: string;
  last_message_preview: string;
  last_message_created_at: string | null;
  unread_count: number;
  category?: string;
  status?: "open" | "archived";
  tone?: "calm" | "elevated";
  message_count?: number;
  has_flagged_by_me?: boolean;
  conversation_flagged_by_me?: boolean;
  pinned_by_me?: boolean;
  has_emergency?: boolean;
};

type SageMessage = {
  id: string;
  role: "user" | "sage";
  content: string;
  created_at: string;
};

interface MessagesSplitViewProps {
  caseId: string;
  children: ChildSummary[];
  coparentName: string | null;
  currentUserInitial: string;
  currentUserAvatarUrl: string | null;
}

export function MessagesSplitView({
  caseId,
  children,
  coparentName,
  currentUserInitial,
  currentUserAvatarUrl,
}: MessagesSplitViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [search, setSearch] = useState("");
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [newChildId, setNewChildId] = useState<string | "general">("general");
  const [newIsEmergency, setNewIsEmergency] = useState(false);
  const [newSubject, setNewSubject] = useState("");
  const [newTopic, setNewTopic] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [composeText, setComposeText] = useState("");
  const [sending, setSending] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);

  type PreviewMode = "idle" | "preview" | "noChange";
  const [previewMode, setPreviewMode] = useState<PreviewMode>("idle");
  const [previewOriginal, setPreviewOriginal] = useState("");
  const [previewSage, setPreviewSage] = useState("");
  const [previewChoice, setPreviewChoice] = useState<"original" | "sage" | "edit">(
    "sage"
  );
  const [previewEditable, setPreviewEditable] = useState("");
  const [dismissedSuggestions, setDismissedSuggestions] = useState<
    Record<string, { expense?: boolean; calendar?: boolean }>
  >({});
  const [filterTopic, setFilterTopic] = useState<string>("all");
  const [filterChild, setFilterChild] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<
    "open" | "archived" | "flagged" | "all"
  >("open");
  const [sageOpen, setSageOpen] = useState(false);
  const [sageInput, setSageInput] = useState("");
  const [sageMessages, setSageMessages] = useState<SageMessage[]>([]);
  const sageBottomRef = useRef<HTMLDivElement | null>(null);
  const [sageContextMessage, setSageContextMessage] = useState<string | null>(null);

  const [userSettings, setUserSettings] = useState<{
    proactive_sage_enabled: boolean;
    proactive_sage_incoming_enabled: boolean;
    proactive_sage_drafts_enabled: boolean;
    structured_pause_enabled: boolean;
    cool_off_enabled: boolean;
    delivery_window_enabled: boolean;
  } | null>(null);
  const [conversationSettings, setConversationSettings] = useState<{
    proactive_sage_enabled: boolean | null;
    structured_pause_enabled: boolean | null;
  } | null>(null);
  const [activePause, setActivePause] = useState<{
    id: string;
    mode: string;
    ends_at: string;
    blocks_sending: boolean;
  } | null>(null);
  const [coolOffActive, setCoolOffActive] = useState<{
    id: string;
    ends_at: string;
  } | null>(null);
  const [pauseCardDismissed, setPauseCardDismissed] = useState(false);
  const [showCoolOffModal, setShowCoolOffModal] = useState(false);
  const [coolOffHours, setCoolOffHours] = useState("2");
  const [startingCoolOff, setStartingCoolOff] = useState(false);

  const [showEventModal, setShowEventModal] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showDocumentModal, setShowDocumentModal] = useState(false);
  const [showCourtOrderModal, setShowCourtOrderModal] = useState(false);
  const [deleteConversationId, setDeleteConversationId] = useState<string | null>(null);
  const [confirmArchiveOpen, setConfirmArchiveOpen] = useState(false);
  const [discardDraftOpen, setDiscardDraftOpen] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  const [attachExpenses, setAttachExpenses] = useState<
    { id: string; description: string; amount: number; category: string; status: string; created_at: string }[]
  >([]);
  const [attachExpensesLoading, setAttachExpensesLoading] = useState(false);
  const [attachExpensesSearch, setAttachExpensesSearch] = useState("");
  const [attachSelectedExpenseId, setAttachSelectedExpenseId] = useState<string | null>(null);

  const [attachDocuments, setAttachDocuments] = useState<
    { id: string; file_name: string; category: string; created_at: string }[]
  >([]);
  const [attachDocumentsLoading, setAttachDocumentsLoading] = useState(false);
  const [attachDocumentsSearch, setAttachDocumentsSearch] = useState("");
  const [attachSelectedDocumentId, setAttachSelectedDocumentId] = useState<string | null>(null);

  const childMap = useMemo(
    () =>
      children.reduce(
        (acc, c) => {
          acc[c.id] = c.first_name;
          return acc;
        },
        {} as Record<string, string>
      ),
    [children]
  );

  async function loadConversations() {
    setLoadingConversations(true);
    try {
      const res = await fetch("/api/messages/conversations");
      const data = await res.json().catch(() => ({}));
      const list = (data.conversations ?? []) as ConversationSummary[];
      // eslint-disable-next-line no-console
      console.log("[Messages] loadConversations response", {
        ok: res.ok,
        status: res.status,
        count: list.length,
      });
      // Log each conversation so we can verify category and has_emergency
      list.forEach((c, i) => {
        // eslint-disable-next-line no-console
        console.log(`[Messages] conversation[${i}]`, {
          id: c.id,
          subject: c.subject,
          category: c.category,
          has_emergency: c.has_emergency,
        });
      });
      if (!res.ok) return;
      setConversations(list);
    } finally {
      setLoadingConversations(false);
    }
  }

  async function loadMessages(conversationId: string) {
    setLoadingMessages(true);
    try {
      const res = await fetch(`/api/messages/conversations/${conversationId}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      setMessages((data.messages ?? []) as MessageRow[]);
    } finally {
      setLoadingMessages(false);
    }
  }

  useEffect(() => {
    void loadConversations();
  }, []);

  useEffect(() => {
    if (searchParams.get("cooloff") === "1") {
      setShowCoolOffModal(true);
      const u = new URL(window.location.href);
      u.searchParams.delete("cooloff");
      router.replace(u.pathname + (u.search || ""), { scroll: false });
    }
  }, [searchParams, router]);

  // Select conversation from URL (e.g. dashboard "conversation awaiting response")
  useEffect(() => {
    const cid = searchParams.get("conversation_id");
    if (!cid) return;
    if (conversations.length === 0) return;
    const exists = conversations.some((c) => c.id === cid);
    if (exists) setSelectedId(cid);
    const u = new URL(window.location.href);
    u.searchParams.delete("conversation_id");
    router.replace(u.pathname + (u.search || ""), { scroll: false });
  }, [searchParams, router, conversations]);

  const [newInitialMessage, setNewInitialMessage] = useState<string | null>(null);

  // Pre-fill and open new conversation from URL (e.g. dashboard "Send reminder", Sage "Send" / "Document")
  useEffect(() => {
    const openNew = searchParams.get("new");
    const topic = searchParams.get("topic");
    const subject = searchParams.get("subject");
    const body = searchParams.get("body");
    if (!openNew && !topic && !subject && !body) return;
    if (topic) setNewTopic(topic);
    else if (openNew || subject || body) setNewTopic("general");
    if (subject) setNewSubject(decodeURIComponent(subject));
    if (body) setNewInitialMessage(decodeURIComponent(body));
    setNewModalOpen(true);
    const u = new URL(window.location.href);
    u.searchParams.delete("new");
    u.searchParams.delete("topic");
    u.searchParams.delete("subject");
    u.searchParams.delete("body");
    router.replace(u.pathname + (u.search || ""), { scroll: false });
  }, [searchParams, router]);

  useEffect(() => {
    fetch("/api/settings/user")
      .then((r) => r.json())
      .then((d) => {
        if (d.proactive_sage_enabled !== undefined) {
          setUserSettings({
            proactive_sage_enabled: d.proactive_sage_enabled ?? true,
            proactive_sage_incoming_enabled: d.proactive_sage_incoming_enabled ?? true,
            proactive_sage_drafts_enabled: d.proactive_sage_drafts_enabled ?? true,
            structured_pause_enabled: d.structured_pause_enabled ?? true,
            cool_off_enabled: d.cool_off_enabled ?? true,
            delivery_window_enabled: d.delivery_window_enabled ?? false,
          });
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/messages/cool-off")
      .then((r) => r.json())
      .then((d) => setCoolOffActive(d.active ?? null))
      .catch(() => {});
  }, []);

  const releaseCoolOff = useCallback(() => {
    fetch("/api/messages/cool-off/release", { method: "POST" })
      .then((r) => r.json())
      .then(async (d) => {
        const released = (d as { released?: number }).released ?? 0;
        if (released > 0 && selectedId) {
          await loadMessages(selectedId);
        }
        const res = await fetch("/api/messages/cool-off");
        const data = await res.json().catch(() => ({}));
        setCoolOffActive((data as { active?: { id: string; ends_at: string } | null }).active ?? null);
      })
      .catch(() => {});
  }, [selectedId]);

  const releaseDeliveryWindow = useCallback(() => {
    if (!userSettings?.delivery_window_enabled) return;
    fetch("/api/messages/delivery-window/release", { method: "POST" })
      .then((r) => r.json())
      .then(async (d) => {
        const { released, summary_notification } = d as {
          released?: number;
          summary_notification?: string | null;
        };
        if ((released ?? 0) > 0 && selectedId) {
          await loadMessages(selectedId);
        }
        if (summary_notification) {
          showSuccessToast(summary_notification);
        }
      })
      .catch(() => {});
  }, [selectedId, userSettings?.delivery_window_enabled]);

  useEffect(() => {
    releaseCoolOff();
    const t = setInterval(releaseCoolOff, 60 * 1000);
    return () => clearInterval(t);
  }, [releaseCoolOff]);

  useEffect(() => {
    if (!userSettings?.delivery_window_enabled) return;
    releaseDeliveryWindow();
    const t = setInterval(releaseDeliveryWindow, 60 * 1000);
    return () => clearInterval(t);
  }, [releaseDeliveryWindow, userSettings?.delivery_window_enabled]);

  // Close conversation card menu on click outside
  useEffect(() => {
    if (!menuOpenId) return;
    const handle = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.closest("[data-conversation-card]")?.getAttribute("data-conversation-card") !== menuOpenId &&
        !target.closest("[data-conversation-menu]")
      ) {
        setMenuOpenId(null);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [menuOpenId]);

  // Load attach-expense/documents lists when modals open
  useEffect(() => {
    if (!showExpenseModal) {
      setAttachExpensesSearch("");
      setAttachSelectedExpenseId(null);
      return;
    }
    setAttachExpensesLoading(true);
    fetch("/api/messages/attachments/expenses")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.expenses)) {
          setAttachExpenses(
            d.expenses.map((e: any) => ({
              id: e.id as string,
              description: (e.description as string) ?? "",
              amount: Number(e.amount ?? 0),
              category: (e.category as string) ?? "",
              status: (e.status as string) ?? "",
              created_at: e.created_at as string,
            }))
          );
        } else {
          setAttachExpenses([]);
        }
      })
      .catch(() => {
        setAttachExpenses([]);
      })
      .finally(() => setAttachExpensesLoading(false));
  }, [showExpenseModal]);

  useEffect(() => {
    if (!showDocumentModal) {
      setAttachDocumentsSearch("");
      setAttachSelectedDocumentId(null);
      return;
    }
    setAttachDocumentsLoading(true);
    fetch("/api/messages/attachments/documents")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.documents)) {
          setAttachDocuments(
            d.documents.map((doc: any) => ({
              id: doc.id as string,
              file_name: (doc.file_name as string) ?? "",
              category: (doc.category as string) ?? "",
              created_at: doc.created_at as string,
            }))
          );
        } else {
          setAttachDocuments([]);
        }
      })
      .catch(() => {
        setAttachDocuments([]);
      })
      .finally(() => setAttachDocumentsLoading(false));
  }, [showDocumentModal]);

  useEffect(() => {
    if (!selectedId) {
      setConversationSettings(null);
      setActivePause(null);
      setPauseCardDismissed(false);
      return;
    }
    fetch(`/api/settings/conversation?conversation_id=${encodeURIComponent(selectedId)}`)
      .then((r) => r.json())
      .then((d) =>
        setConversationSettings({
          proactive_sage_enabled: d.proactive_sage_enabled ?? null,
          structured_pause_enabled: d.structured_pause_enabled ?? null,
        })
      )
      .catch(() => {});
    fetch(`/api/messages/structured-pause?conversation_id=${encodeURIComponent(selectedId)}`)
      .then((r) => r.json())
      .then((d) => setActivePause(d.active ?? null))
      .catch(() => {});
  }, [selectedId]);

  const filteredConversations = useMemo(() => {
    let list = conversations;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((c) => {
        const childName = c.child_id ? childMap[c.child_id] ?? "" : "General";
        const text = [
          c.subject,
          childName,
          coparentName ?? "",
          c.last_message_preview ?? "",
        ]
          .join(" ")
          .toLowerCase();
        return text.includes(q);
      });
    }
    if (filterTopic !== "all") {
      list = list.filter((c) => {
        const t = (c.category ?? "general").toLowerCase();
        const norm = t === "expenses" ? "expense" : t;
        return norm === filterTopic;
      });
    }
    if (filterChild !== "all") {
      list = list.filter((c) => c.child_id === filterChild);
    }
    if (filterStatus === "open") {
      list = list.filter((c) => (c.status ?? "open") === "open");
    } else if (filterStatus === "archived") {
      list = list.filter((c) => c.status === "archived");
    } else if (filterStatus === "flagged") {
      list = list.filter(
        (c) => c.has_flagged_by_me || c.conversation_flagged_by_me
      );
    }
    return list;
  }, [conversations, search, filterTopic, filterChild, filterStatus, childMap, coparentName]);

  const activeConversation = conversations.find((c) => c.id === selectedId) ?? null;
  const activeChildName =
    activeConversation?.child_id && childMap[activeConversation.child_id]
      ? childMap[activeConversation.child_id]
      : activeConversation
        ? "General"
        : null;

  async function handleSelectConversation(id: string) {
    setSelectedId(id);
    await loadMessages(id);
  }

  async function handleCreateConversation(e: React.FormEvent) {
    e.preventDefault();
    if (!newSubject.trim() || !newTopic) return;
    setCreating(true);
    try {
      // When "This is an emergency communication" is checked, set topic/category to 'emergency'
      // so the conversation row is stored as emergency and list styling shows it (API does not store is_emergency on conversations table).
      const topicValue = newIsEmergency ? "emergency" : newTopic;
      const body = {
        subject: newSubject.trim(),
        child_id: newChildId === "general" ? null : newChildId,
        category: topicValue,
        topic: topicValue,
        is_emergency: newIsEmergency,
      };
      const res = await fetch("/api/messages/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showErrorToast(
          (data as { error?: string }).error ?? "Could not create conversation."
        );
        return;
      }
      const conv = (data as { conversation: ConversationSummary }).conversation;
      const initialMessage = newInitialMessage;
      setNewSubject("");
      setNewChildId("general");
      setNewTopic("");
      setNewIsEmergency(false);
      setNewModalOpen(false);
      setNewInitialMessage(null);
      await loadConversations();
      setSelectedId(conv.id);
      await loadMessages(conv.id);
      if (initialMessage?.trim()) setComposeText(initialMessage.trim());
      showSuccessToast("Conversation created");
    } finally {
      setCreating(false);
    }
  }

  async function handleSend() {
    if (!selectedId || !composeText.trim()) return;
    if (blockSend) {
      setComposeError(
        coolOffActive
          ? "Sending is paused while you take a break."
          : "This conversation is paused. It will reopen at the scheduled time."
      );
      return;
    }
    setSending(true);
    setComposeError(null);
    try {
      const original = composeText.trim();
      let draft = original;
      try {
        const draftRes = await fetch("/api/messages/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intent: original }),
        });
        const draftData = await draftRes.json().catch(() => ({}));
        if (draftRes.ok && typeof (draftData as any).draft === "string") {
          draft = (draftData as { draft: string }).draft;
        }
      } catch {
        // fall back to original text
      }
      setPreviewOriginal(original);
      setPreviewSage(draft);
      setPreviewEditable(draft);
      setPreviewChoice("sage");
      if (draft.trim() === original.trim()) {
        setPreviewMode("noChange");
      } else {
        setPreviewMode("preview");
      }
    } catch (e) {
      setComposeError(e instanceof Error ? e.message : "Failed to prepare message.");
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!sending && composeText.trim()) {
        void handleSend();
      }
    }
  }

  const displayCoparentName = "Co-Parent";

  const activeTone: "calm" | "elevated" = "calm";

  const now = new Date();
  const last30Start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 30
  );
  const recentMessages = messages.filter((m) => {
    const d = new Date(m.created_at);
    return d >= last30Start;
  });
  const rewrittenCount = recentMessages.filter((m) => {
    const any = m as any;
    if (typeof any.ai_rewritten === "boolean") return any.ai_rewritten;
    return (m.ai_rewritten_content ?? "") !== (m.original_content ?? "");
  }).length;

  const showIncomingNudge =
    (userSettings?.proactive_sage_enabled ?? true) &&
    (userSettings?.proactive_sage_incoming_enabled ?? true) &&
    (conversationSettings?.proactive_sage_enabled !== false);

  const showDraftNudge =
    (userSettings?.proactive_sage_enabled ?? true) &&
    (userSettings?.proactive_sage_drafts_enabled ?? true) &&
    (conversationSettings?.proactive_sage_enabled !== false);

  const draftIntensityResult = useMemo(
    () => estimateIntensity(composeText),
    [composeText]
  );
  const draftIntensityFlag = draftIntensityResult.flag;

  const tenMinAgo = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
  const sixtyMinAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const intensityInLast10 = messages.filter(
    (m) => (m as MessageRow & { intensity_flag?: boolean }).intensity_flag && m.created_at >= tenMinAgo
  ).length;
  const intensityInLast60 = messages.filter(
    (m) => (m as MessageRow & { intensity_flag?: boolean }).intensity_flag && m.created_at >= sixtyMinAgo
  ).length;
  const pauseSuggestion =
    (userSettings?.structured_pause_enabled ?? true) &&
    (conversationSettings?.structured_pause_enabled !== false) &&
    (intensityInLast10 >= 3 || intensityInLast60 >= 5);

  const blockSend = !!coolOffActive || (!!activePause && activePause.blocks_sending);

  useEffect(() => {
    if (sageOpen && activeConversation) {
      setSageMessages((prev) => {
        if (prev.length > 0) return prev;
        const nowIso = new Date().toISOString();
        return [
          {
            id: "sage-greeting",
            role: "sage",
            content: "How can I support you?",
            created_at: nowIso,
          },
        ];
      });
    } else if (!sageOpen) {
      setSageMessages([]);
    }
  }, [sageOpen, activeConversation?.id]);

  useEffect(() => {
    if (sageBottomRef.current) {
      sageBottomRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [sageMessages.length, sageOpen]);

  async function handleSageSend() {
    if (!activeConversation) return;
    const text = sageInput.trim();
    if (!text) return;

    const timestamp = new Date().toISOString();
    const optimistic: SageMessage = {
      id: `local-${Date.now()}`,
      role: "user",
      content: text,
      created_at: timestamp,
    };
    setSageMessages((prev) => [...prev, optimistic]);
    setSageInput("");

    try {
      const res = await fetch("/api/sage/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: activeConversation.id,
          content: text,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Keep optimistic message; log error for now
        // eslint-disable-next-line no-console
        console.error("Sage chat failed", data);
        return;
      }
      const sageMsg = (data as any).sage_message as
        | { id: string; role: "sage"; content: string; created_at: string }
        | undefined;
      if (sageMsg) {
        setSageMessages((prev) => [
          ...prev,
          {
            id: sageMsg.id,
            role: "sage",
            content: sageMsg.content,
            created_at: sageMsg.created_at,
          },
        ]);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Sage chat error", e);
    }
  }

  return (
    <div className="flex h-[calc(100vh-4.5rem)] bg-[#FDFBF7]">
      {/* LEFT PANEL — wider for reading room */}
      <div className="flex h-full w-[400px] min-w-[360px] flex-col shrink-0 border-r border-[#E8E4DC] bg-white">
        <div className="border-b border-[#E8E4DC] px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h1 className="font-heading text-lg font-semibold text-[#3D3D3D]">
                Messages
              </h1>
              <div className="mt-0.5 flex items-center gap-1 text-[11px] text-[#8A8A8A]">
                <Shield className="h-3.5 w-3.5 text-[#7C8B6E]" />
                <span>AI-supported, child-centered communication</span>
              </div>
            </div>
          </div>
          {/* Single row: search + topic + children + status + new button */}
          <div className="mt-3 flex items-center gap-2 min-w-0">
            <div className="relative flex-1 min-w-0">
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
              value={filterTopic}
              onChange={(e) => setFilterTopic(e.target.value)}
              className={cn(
                "h-8 w-[90px] shrink-0 rounded-full border px-2 py-1 text-[11px] text-[#3D3D3D] bg-[#FDFBF7] border-[#E8E4DC] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E]",
                filterTopic !== "all" && "bg-[#F2F5EF] border-[#7C8B6E]"
              )}
            >
              <option value="all">Topics</option>
              {CONVERSATION_TOPICS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select
              value={filterChild}
              onChange={(e) => setFilterChild(e.target.value)}
              className={cn(
                "h-8 w-[82px] shrink-0 rounded-full border px-2 py-1 text-[11px] text-[#3D3D3D] bg-[#FDFBF7] border-[#E8E4DC] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E]",
                filterChild !== "all" && "bg-[#F2F5EF] border-[#7C8B6E]"
              )}
            >
              <option value="all">Child</option>
              {children.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.first_name}
                </option>
              ))}
            </select>
            <select
              value={filterStatus}
              onChange={(e) =>
                setFilterStatus(
                  e.target.value as "open" | "archived" | "flagged" | "all"
                )
              }
              className={cn(
                "h-8 w-[78px] shrink-0 rounded-full border px-2 py-1 text-[11px] text-[#3D3D3D] bg-[#FDFBF7] border-[#E8E4DC] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E]",
                filterStatus !== "open" && "bg-[#F2F5EF] border-[#7C8B6E]"
              )}
              aria-label="Filter by status"
            >
              <option value="open">Open</option>
              <option value="archived">Archived</option>
              <option value="flagged">Flagged</option>
              <option value="all">All</option>
            </select>
            <button
              type="button"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#5B7A52] text-white shadow-sm hover:bg-[#476242]"
              onClick={() => setNewModalOpen(true)}
              aria-label="New conversation"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="px-2 py-2 space-y-1.5">
            {loadingConversations && conversations.length === 0 ? (
              <p className="px-2 py-4 text-xs text-[#8A8A8A]">Loading…</p>
            ) : filteredConversations.length === 0 ? (
              <p className="px-2 py-4 text-xs text-[#8A8A8A]">
                {conversations.length === 0
                  ? "No conversations yet. Start a new one with the + button."
                  : "No conversations match these filters."}
              </p>
            ) : (
              filteredConversations.map((c) => {
                const isActive = c.id === selectedId;
                const childName =
                  c.child_id && childMap[c.child_id]
                    ? childMap[c.child_id]
                    : "General";
                const dateLabel = c.last_message_created_at
                  ? new Date(c.last_message_created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })
                  : new Date(c.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    });
                const isDeletable = (c.message_count ?? 0) === 0;
                const isEmergencyConversation =
                  c.has_emergency === true ||
                  (c.category?.toLowerCase() === "emergency");
                return (
                  <div
                    key={c.id}
                    data-conversation-card={c.id}
                    onClick={() => void handleSelectConversation(c.id)}
                    onMouseLeave={() => {
                      if (menuOpenId === c.id) setMenuOpenId(null);
                    }}
                    className={cn(
                      "group relative flex w-full items-start rounded-xl px-2.5 py-2 text-left text-xs transition-colors",
                      isActive
                        ? "border-l-4 border-l-[#7C8B6E] bg-[#F2F5EF]"
                        : isEmergencyConversation
                        ? "border-l-2 border-l-[#C97B7B] bg-[#FDF2F2] border border-[#E8C4C4] hover:bg-[#FDF2F2]"
                        : "border-l-4 border-l-transparent bg-white hover:bg-[#FDFBF7]"
                    )}
                  >
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-[13px] font-semibold text-[#3D3D3D]">
                          <span className="truncate align-middle">{c.subject}</span>
                          {isEmergencyConversation && (
                            <span className="ml-1 inline-flex shrink-0 items-center gap-0.5 align-middle text-[#C97B7B]" aria-hidden>
                              <AlertCircle className="h-3 w-3" />
                            </span>
                          )}
                        </p>
                        <div className="flex items-center gap-1.5">
                          {c.pinned_by_me && (
                            <span className="text-[#5B7A52]" title="Pinned">
                              <Pin className="h-3.5 w-3.5" />
                            </span>
                          )}
                          {c.conversation_flagged_by_me && (
                            <span className="text-[#B45309]" title="Flagged (private)">
                              <Flag className="h-3.5 w-3.5 fill-current" />
                            </span>
                          )}
                          <span className="shrink-0 text-[10px] text-[#8A8A8A]">
                            {dateLabel}
                          </span>
                          {c.status === "archived" && (
                            <span className="inline-flex items-center rounded-full border border-[#E2C877] bg-[#FDF6E3] px-2 py-0.5 text-[9px] font-medium text-[#B8960F]">
                              Archived
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setMenuOpenId(menuOpenId === c.id ? null : c.id);
                            }}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-[#E8E4DC] text-[#B0A899] hover:text-[#6A7A6E]"
                            aria-label="Conversation options"
                            aria-expanded={menuOpenId === c.id}
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      {menuOpenId === c.id && (
                        <div
                          data-conversation-menu
                          className="absolute right-0 top-9 z-20 min-w-[180px] rounded-lg border border-[#E8E4DC] bg-white py-1 shadow-lg"
                        >
                          {/* Pin / Unpin always available */}
                          {c.pinned_by_me ? (
                            <button
                              type="button"
                              className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-[#3D3D3D] hover:bg-[#F2F5EF] text-left"
                              onClick={async (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                try {
                                  await fetch(`/api/messages/conversations/${c.id}/pin`, { method: "DELETE" });
                                  await loadConversations();
                                  setMenuOpenId(null);
                                } catch {
                                  showErrorToast("Could not unpin");
                                }
                              }}
                            >
                              <Pin className="h-3.5 w-3.5" /> Unpin conversation
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-[#3D3D3D] hover:bg-[#F2F5EF] text-left"
                              onClick={async (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                try {
                                  await fetch(`/api/messages/conversations/${c.id}/pin`, { method: "POST" });
                                  await loadConversations();
                                  setMenuOpenId(null);
                                } catch {
                                  showErrorToast("Could not pin");
                                }
                              }}
                            >
                              <Pin className="h-3.5 w-3.5" /> Pin conversation
                            </button>
                          )}

                          {/* Flag / Remove flag always available */}
                          {c.conversation_flagged_by_me ? (
                            <button
                              type="button"
                              className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-[#3D3D3D] hover:bg-[#F2F5EF] text-left"
                              onClick={async (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                try {
                                  await fetch(`/api/messages/conversations/${c.id}/flag`, { method: "DELETE" });
                                  await loadConversations();
                                  setMenuOpenId(null);
                                } catch {
                                  showErrorToast("Could not remove flag");
                                }
                              }}
                            >
                              <Flag className="h-3.5 w-3.5" /> Remove flag
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-[#3D3D3D] hover:bg-[#F2F5EF] text-left"
                              onClick={async (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                try {
                                  await fetch(`/api/messages/conversations/${c.id}/flag`, { method: "POST" });
                                  await loadConversations();
                                  setMenuOpenId(null);
                                } catch {
                                  showErrorToast("Could not flag");
                                }
                              }}
                            >
                              <Flag className="h-3.5 w-3.5" /> Flag conversation
                            </button>
                          )}

                          {/* Status-specific actions */}
                          {c.status === "open" && (
                            <button
                              type="button"
                              className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-[#3D3D3D] hover:bg-[#F2F5EF] text-left"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setSelectedId(c.id);
                                setConfirmArchiveOpen(true);
                                setMenuOpenId(null);
                              }}
                            >
                              <Archive className="h-3.5 w-3.5" /> Archive conversation
                            </button>
                          )}
                          {c.status === "archived" && (
                            <button
                              type="button"
                              className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-[#3D3D3D] hover:bg-[#F2F5EF] text-left"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setSelectedId(c.id);
                                setConfirmArchiveOpen(true);
                                setMenuOpenId(null);
                              }}
                            >
                              <ArchiveRestore className="h-3.5 w-3.5" /> Unarchive conversation
                            </button>
                          )}

                          {/* Delete for empty conversations only */}
                          {isDeletable && (
                            <button
                              type="button"
                              className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-[#C3442D] hover:bg-[#FDF2F0] text-left"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setDeleteConversationId(c.id);
                                setMenuOpenId(null);
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" /> Delete conversation
                            </button>
                          )}
                        </div>
                      )}
                      <p className="line-clamp-1 text-[11px] text-[#8A8A8A]">
                        {c.last_message_preview || "No messages yet."}
                      </p>
                      <div className="flex items-center justify-between gap-2 pt-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="inline-flex items-center gap-1 rounded-full bg-[#F2F5EF] px-2 py-0.5 text-[10px] text-[#5B7A52]">
                            <span className="h-1.5 w-1.5 rounded-full bg-[#7C8B6E]" />
                            {getTopicLabel(c.category)}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-[#F2F5EF] px-2 py-0.5 text-[10px] text-[#5B7A52]">
                            <span className="h-1.5 w-1.5 rounded-full bg-[#7C8B6E]" />
                            {childName}
                          </span>
                          <span className="text-[10px] text-[#8A8A8A]">
                            · Co-Parent
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                              c.status === "archived"
                                ? "bg-[#F5F5F5] text-[#8A8A8A]"
                                : "bg-[#F2F5EF] text-[#5B7A52]"
                            )}
                          >
                            {c.status === "archived" ? "Archived" : "Open"}
                          </span>
                          {c.unread_count > 0 && (
                            <span className="h-2 w-2 rounded-full bg-[#D0705A]" />
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      </div>

      {/* RIGHT PANEL */}
      <div className="flex min-w-0 flex-1 flex-col bg-[#FDFBF7]">
        {activeConversation ? (
          <>
            <div className="flex items-center justify-between gap-3 border-b border-[#E8E4DC] bg-white px-4 py-3">
              <div className="flex items-center min-w-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[#3D3D3D]">
                    {activeConversation.subject}
                  </p>
                  <p className="text-[11px] text-[#8A8A8A]">
                    {displayCoparentName}
                    {activeChildName ? ` · ${activeChildName}` : ""}
                  </p>
                </div>
              </div>
              {(userSettings?.cool_off_enabled ?? true) && !coolOffActive && (
                <button
                  type="button"
                  onClick={() => setShowCoolOffModal(true)}
                  className="shrink-0 rounded-full border border-[#E8E4DC] bg-[#FDFBF7] px-2.5 py-1 text-[11px] text-[#5B7A52] hover:bg-[#F2F5EF]"
                >
                  Take a cool-off break
                </button>
              )}
            </div>
            {coolOffActive && (
              <div className="border-b border-[#E8E4DC] bg-[#F2F5EF] px-4 py-2 text-[11px] text-[#3D3D3D]">
                You&apos;re taking a break. Sending is paused until{" "}
                {new Date(coolOffActive.ends_at).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
                . Incoming messages will appear when your break ends.
              </div>
            )}

            <div className="flex min-h-0 flex-1 flex-col">
              <div className="border-b border-[#E8E4DC] bg-transparent px-4 py-2">
                <div className="flex flex-col gap-2">
                  <div
                    className={cn(
                      "inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px]",
                      activeTone === "elevated"
                        ? "bg-[#FDF6E3] text-[#B8960F]"
                        : "bg-[#F2F5EF] text-[#5B7A52]"
                    )}
                  >
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full",
                        activeTone === "elevated" ? "bg-[#D4A843]" : "bg-[#7C8B6E]"
                      )}
                    />
                    <span className="font-medium">
                      {activeTone === "elevated" ? "Sage Monitoring" : "Sage Active"}
                    </span>
                    <span className="text-[10px]">
                      {activeTone === "elevated"
                        ? "Tone support recommended."
                        : "Messages are reviewed before sending."}
                    </span>
                  </div>
                  <details className="text-[11px] text-[#8A8A8A]">
                    <summary className="cursor-pointer list-none text-[11px] hover:text-[#5B7A52]">
                      Thread summary
                    </summary>
                    <div className="mt-1 rounded-xl border border-[#E8E4DC] bg-[#F2F5EF] px-3 py-2 space-y-0.5">
                      <p>
                        <span className="font-medium text-[#5B7A52]">
                          Messages (last 30 days):
                        </span>{" "}
                        {recentMessages.length}
                      </p>
                      <p>
                        <span className="font-medium text-[#5B7A52]">
                          Messages rewritten for tone:
                        </span>{" "}
                        {rewrittenCount}
                      </p>
                      <p>
                        <span className="font-medium text-[#5B7A52]">Open disputes:</span>{" "}
                        None
                      </p>
                      <p>
                        <span className="font-medium text-[#5B7A52]">Category:</span>{" "}
                        {getTopicLabel(activeConversation?.category)}
                      </p>
                    </div>
                  </details>
                  {activePause && activePause.blocks_sending && (
                    <div className="mt-2 rounded-xl border border-[#E8E4DC] bg-[#F2F5EF] px-3 py-2 text-[11px] text-[#3D3D3D]">
                      This conversation has been temporarily paused to allow cooling. It will reopen at{" "}
                      {new Date(activePause.ends_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                      .
                    </div>
                  )}
                  {pauseSuggestion &&
                    !activePause?.blocks_sending &&
                    !pauseCardDismissed && (
                      <div className="mt-2 rounded-xl border border-[#E8E4DC] bg-[#FDFBF7] px-3 py-2 text-[11px] text-[#3D3D3D] space-y-2">
                        <p className="font-medium text-[#5B7A52]">
                          Would you like to take a pause?
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 rounded-full text-[11px]"
                            onClick={async () => {
                              if (!selectedId) return;
                              const res = await fetch("/api/messages/structured-pause", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  conversation_id: selectedId,
                                  duration: "30min",
                                }),
                              });
                              if (res.ok) {
                                const d = await res.json();
                                setActivePause({
                                  id: d.id,
                                  mode: d.mode,
                                  ends_at: d.ends_at,
                                  blocks_sending: true,
                                });
                                setPauseCardDismissed(true);
                              }
                            }}
                          >
                            30 min
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 rounded-full text-[11px]"
                            onClick={async () => {
                              if (!selectedId) return;
                              const res = await fetch("/api/messages/structured-pause", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  conversation_id: selectedId,
                                  duration: "2hours",
                                }),
                              });
                              if (res.ok) {
                                const d = await res.json();
                                setActivePause({
                                  id: d.id,
                                  mode: d.mode,
                                  ends_at: d.ends_at,
                                  blocks_sending: true,
                                });
                                setPauseCardDismissed(true);
                              }
                            }}
                          >
                            2 hours
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 rounded-full text-[11px]"
                            onClick={async () => {
                              if (!selectedId) return;
                              const res = await fetch("/api/messages/structured-pause", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  conversation_id: selectedId,
                                  duration: "until_tomorrow",
                                }),
                              });
                              if (res.ok) {
                                const d = await res.json();
                                setActivePause({
                                  id: d.id,
                                  mode: d.mode,
                                  ends_at: d.ends_at,
                                  blocks_sending: true,
                                });
                                setPauseCardDismissed(true);
                              }
                            }}
                          >
                            Until tomorrow morning
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 rounded-full text-[11px] text-[#8A8A8A]"
                            onClick={() => setPauseCardDismissed(true)}
                          >
                            Continue
                          </Button>
                        </div>
                      </div>
                    )}
                </div>
              </div>
              <ScrollArea className="flex-1 px-4 py-4">
                {loadingMessages && messages.length === 0 ? (
                  <p className="py-6 text-center text-xs text-[#8A8A8A]">
                    Loading conversation…
                  </p>
                ) : messages.length === 0 ? (
                  <p className="py-6 text-center text-xs text-[#8A8A8A]">
                    No messages yet. Send the first message in this conversation.
                  </p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {(() => {
                      const lastIncoming = [...messages]
                        .filter((m) => m.direction === "incoming")
                        .slice(-1)[0];
                      let expenseMatch: RegExpMatchArray | null = null;
                      let dateLike = false;
                      if (lastIncoming) {
                        const text =
                          lastIncoming.ai_rewritten_content ??
                          lastIncoming.original_content ??
                          "";
                        expenseMatch = text.match(/\$[0-9][0-9,]*(\.[0-9]{2})?/);
                        const lower = text.toLowerCase();
                        const dayNameRegex =
                          /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/;
                        const monthRegex =
                          /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/;
                        const atTimeRegex = /\bat\s+\d{1,2}(:\d{2})?\s*(am|pm)?\b/;
                        const ordinalRegex = /\b\d{1,2}(st|nd|rd|th)\b/;
                        dateLike =
                          dayNameRegex.test(lower) ||
                          monthRegex.test(lower) ||
                          atTimeRegex.test(lower) ||
                          ordinalRegex.test(lower);
                      }
                      const showExpenseSuggestion =
                        !!lastIncoming && !!expenseMatch;
                      const showCalendarSuggestion = !!lastIncoming && dateLike;

                      return messages.map((m) => {
                        const isTarget = lastIncoming && m.id === lastIncoming.id;
                        const dismissed = dismissedSuggestions[m.id] || {};
                        const childId = activeConversation.child_id;
                        const expenseCategoryParam =
                          activeConversation.category === "medical"
                            ? "medical"
                            : activeConversation.category === "school"
                              ? "school"
                              : activeConversation.category === "expense" || activeConversation.category === "expenses"
                                ? "other"
                                : undefined;

                        const intensityFlag = (m as MessageRow & {
                          intensity_flag?: boolean;
                        }).intensity_flag;
                        return (
                          <div key={m.id} className="flex flex-col gap-1">
                            <MessageBubble message={m} />
                            {m.direction === "incoming" &&
                              intensityFlag &&
                              showIncomingNudge && (
                                <div className="mr-auto max-w-[82%] md:max-w-[70%] pt-0.5">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSageContextMessage(
                                        m.ai_rewritten_content ?? m.original_content ?? ""
                                      );
                                      setSageOpen(true);
                                    }}
                                    className="inline-flex items-center gap-1.5 rounded-full bg-[#F2F5EF] border border-[#E8E4DC] px-2.5 py-1 text-[11px] text-[#5B7A52] hover:bg-[#E8EDE3]"
                                  >
                                    <span role="img" aria-hidden>🕊</span>
                                    <span>Let&apos;s talk before you respond</span>
                                  </button>
                                </div>
                              )}
                            {isTarget &&
                              showExpenseSuggestion &&
                              !dismissed.expense && (
                                <div className="mr-auto max-w-[82%] md:max-w-[70%] rounded-lg bg-[#F2F5EF] px-3 py-2 text-[12px] text-[#3D3D3D]">
                                  <p className="mb-1">
                                    Would you like to create a shared expense entry?
                                  </p>
                                  <div className="flex flex-wrap gap-2">
                                    <Button
                                      type="button"
                                      size="sm"
                                      className="h-7 rounded-full bg-[#5B7A52] px-3 text-[11px] text-white hover:bg-[#476242]"
                                      onClick={() => {
                                        const raw = expenseMatch![0];
                                        const cleaned = raw
                                          .replace("$", "")
                                          .replace(/,/g, "");
                                        const search = new URLSearchParams();
                                        if (childId) search.set("child_id", childId);
                                        if (expenseCategoryParam)
                                          search.set("category", expenseCategoryParam);
                                        if (cleaned) search.set("amount", cleaned);
                                        router.push(`/expenses?${search.toString()}`);
                                      }}
                                    >
                                      Create expense
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 rounded-full px-3 text-[11px] text-[#8A8A8A] hover:text-[#5B7A52]"
                                      onClick={() =>
                                        setDismissedSuggestions((prev) => ({
                                          ...prev,
                                          [m.id]: {
                                            ...(prev[m.id] ?? {}),
                                            expense: true,
                                          },
                                        }))
                                      }
                                    >
                                      Dismiss
                                    </Button>
                                  </div>
                                </div>
                              )}
                            {isTarget &&
                              showCalendarSuggestion &&
                              !dismissed.calendar && (
                                <div className="mr-auto max-w-[82%] md:max-w-[70%] rounded-lg bg-[#F2F5EF] px-3 py-2 text-[12px] text-[#3D3D3D]">
                                  <p className="mb-1">
                                    Would you like to add this to your calendar?
                                  </p>
                                  <div className="flex flex-wrap gap-2">
                                    <Button
                                      type="button"
                                      size="sm"
                                      className="h-7 rounded-full bg-[#5B7A52] px-3 text-[11px] text-white hover:bg-[#476242]"
                                      onClick={() => {
                                        const search = new URLSearchParams();
                                        if (childId) search.set("child_id", childId);
                                        router.push(`/calendar?${search.toString()}`);
                                      }}
                                    >
                                      Add event
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 rounded-full px-3 text-[11px] text-[#8A8A8A] hover:text-[#5B7A52]"
                                      onClick={() =>
                                        setDismissedSuggestions((prev) => ({
                                          ...prev,
                                          [m.id]: {
                                            ...(prev[m.id] ?? {}),
                                            calendar: true,
                                          },
                                        }))
                                      }
                                    >
                                      Dismiss
                                    </Button>
                                  </div>
                                </div>
                              )}
                          </div>
                        );
                      });
                    })()}
                    <div className="mt-4 mb-1 flex justify-center">
                      <button
                        type="button"
                        className="text-[12px] text-[#8A8A8A] hover:text-[#5B7A52] underline-offset-2 hover:underline"
                        onClick={async () => {
                          if (!activeConversation) return;
                          setConfirmArchiveOpen(true);
                        }}
                      >
                        {activeConversation.status === "archived"
                          ? "Unarchive conversation"
                          : "Archive conversation"}
                      </button>
                    </div>
                  </div>
                )}
              </ScrollArea>

              <div className="border-t border-[#E8E4DC] bg-white px-4 py-3 space-y-2">
                {draftIntensityFlag && showDraftNudge && composeText.trim() && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setSageContextMessage(composeText.trim());
                        setSageOpen(true);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-full bg-[#F2F5EF] border border-[#E8E4DC] px-2.5 py-1 text-[11px] text-[#5B7A52] hover:bg-[#E8EDE3]"
                    >
                      <span role="img" aria-hidden>🕊</span>
                      <span>Let&apos;s talk before you hit send</span>
                    </button>
                  </div>
                )}
                {previewMode !== "idle" && (
                  <div className="mb-3 rounded-2xl border border-[#E8E4DC] bg-[#FDFBF7] px-3 py-2 text-[11px] text-[#3D3D3D]">
                    {previewMode === "preview" ? (
                      <>
                        <div className="mb-2 grid gap-3 md:grid-cols-2">
                          <div className="space-y-1">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8A8A8A]">
                              Your draft
                            </p>
                            <div className="rounded-xl border border-[#E8E4DC] bg-white px-2.5 py-2 min-h-[64px] whitespace-pre-wrap">
                              {previewOriginal}
                            </div>
                          </div>
                          <div className="space-y-1">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8A8A8A]">
                              Sage version
                            </p>
                            {previewChoice === "edit" ? (
                              <Textarea
                                value={previewEditable}
                                onChange={(e) => setPreviewEditable(e.target.value)}
                                rows={3}
                                className="min-h-[64px] resize-none rounded-xl border border-[#E8E4DC] bg-[#F9F6F0] text-[11px] text-[#3D3D3D]"
                              />
                            ) : (
                              <div className="rounded-xl border border-[#E8E4DC] bg-[#F9F6F0] px-2.5 py-2 min-h-[64px] whitespace-pre-wrap">
                                {previewSage}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="mb-2 space-y-1">
                          <label className="flex items-center gap-1 text-[11px]">
                            <input
                              type="radio"
                              className="h-3 w-3"
                              checked={previewChoice === "original"}
                              onChange={() => setPreviewChoice("original")}
                            />
                            <span>Keep my version</span>
                          </label>
                          <label className="flex items-center gap-1 text-[11px]">
                            <input
                              type="radio"
                              className="h-3 w-3"
                              checked={previewChoice === "sage"}
                              onChange={() => setPreviewChoice("sage")}
                            />
                            <span>Use Sage version</span>
                          </label>
                          <label className="flex items-center gap-1 text-[11px]">
                            <input
                              type="radio"
                              className="h-3 w-3"
                              checked={previewChoice === "edit"}
                              onChange={() => setPreviewChoice("edit")}
                            />
                            <span>Edit before sending</span>
                          </label>
                        </div>
                      </>
                    ) : (
                      <p className="text-[11px] text-[#8A8A8A]">
                        Sage reviewed your message — no changes needed. Send when ready?
                      </p>
                    )}
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        className="text-[11px] text-[#8A8A8A] hover:text-[#C7524A] hover:underline"
                        onClick={() => {
                          setDiscardDraftOpen(true);
                        }}
                        disabled={sending}
                      >
                        Discard
                      </button>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 rounded-full text-[11px]"
                          onClick={() => {
                            setPreviewMode("idle");
                            setComposeText(previewOriginal);
                            setSending(false);
                          }}
                          disabled={sending}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="h-7 rounded-full bg-[#5B7A52] text-[11px] text-white hover:bg-[#476242]"
                          disabled={sending}
                          onClick={async () => {
                            if (!selectedId) return;
                            setSending(true);
                            setComposeError(null);
                            try {
                              let finalContent = previewSage;
                              if (previewMode === "noChange") {
                                finalContent = previewOriginal;
                              } else if (previewChoice === "original") {
                                finalContent = previewOriginal;
                              } else if (previewChoice === "edit") {
                                finalContent =
                                  previewEditable.trim() || previewSage || previewOriginal;
                              }
                              const approveRes = await fetch("/api/messages/approve", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  case_id: caseId,
                                  conversation_id: selectedId,
                                  original_content: previewOriginal,
                                  ai_rewritten_content: finalContent,
                                }),
                              });
                              const approveData = await approveRes
                                .json()
                                .catch(() => ({}));
                              if (!approveRes.ok) {
                                setComposeError(
                                  (approveData as { message?: string }).message ??
                                    "Failed to send message."
                                );
                                setSending(false);
                                return;
                              }
                              setPreviewMode("idle");
                              setPreviewOriginal("");
                              setPreviewSage("");
                              setPreviewEditable("");
                              setComposeText("");
                              await loadMessages(selectedId);
                              await loadConversations();
                              router.refresh();
                            } catch (e) {
                              setComposeError(
                                e instanceof Error ? e.message : "Failed to send message."
                              );
                            } finally {
                              setSending(false);
                            }
                          }}
                        >
                          {sending ? "Sending…" : "Send"}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex items-end gap-2">
                  <button
                    type="button"
                    onClick={() => setSageOpen(true)}
                    title="Talk to Sage"
                    aria-label="Talk to Sage"
                    className="flex-shrink-0"
                    style={{
                      width: "44px",
                      height: "44px",
                      borderRadius: "50%",
                      backgroundColor: "#dce5d3",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: "none",
                      cursor: "pointer",
                      flexShrink: 0,
                      padding: 0,
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/dove-translucent.png"
                      alt="Sage"
                      style={{
                        width: "30px",
                        height: "30px",
                        objectFit: "contain",
                        display: "block",
                      }}
                    />
                  </button>
                  <Textarea
                    value={composeText}
                    onChange={(e) => setComposeText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type your message..."
                    rows={2}
                    className="min-h-[52px] flex-1 resize-none rounded-[10px] border border-[#E8E4DC] bg-[#F9F6F0] text-sm text-[#3D3D3D] placeholder:text-[#B0A899] focus-visible:ring-[#7C8B6E]"
                    disabled={sending}
                  />
                  <button
                    type="button"
                    onClick={() => void handleSend()}
                    disabled={sending || !composeText.trim() || blockSend}
                    className={cn(
                      "mb-0.5 flex h-[42px] w-[42px] items-center justify-center rounded-full text-white shadow-sm transition-colors",
                      composeText.trim()
                        ? "bg-[#5B7A52] hover:bg-[#476242]"
                        : "bg-[#E0E4DC] cursor-not-allowed"
                    )}
                    aria-label="Send message"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M22 2L11 13" />
                      <path d="M22 2L15 22L11 13L2 9L22 2Z" />
                    </svg>
                  </button>
                </div>
                {composeError && (
                  <p className="text-[11px] text-[#C7524A]">{composeError}</p>
                )}
                <div className="space-y-1">
                  <div className="flex items-center gap-1 text-[10px] text-[#8A8A8A]">
                    <Shield className="h-3 w-3 text-[#7C8B6E]" />
                    <span>Your message will be reviewed by AI before sending.</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="text-[#8A8A8A]">Attach:</span>
                    {(() => {
                      const cat = activeConversation.category ?? "general";
                      const childId = activeConversation.child_id;
                      const showCalendar =
                        cat === "schedule" || cat === "school" || cat === "general";
                      const showExpense =
                        cat === "medical" || cat === "expense" || cat === "expenses" || cat === "general";
                      const showDocument =
                        cat === "medical" ||
                        cat === "expense" ||
                        cat === "school" ||
                        cat === "general";
                      const showCourt = cat === "general";

                      const expenseCategoryParam =
                        cat === "medical"
                          ? "medical"
                          : cat === "school"
                            ? "school"
                            : cat === "expense"
                              ? "other"
                              : undefined;

                      return (
                        <>
                          {showCalendar && (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 text-[#7C8B6E] hover:text-[#5B7A52]"
                              onClick={() => {
                                setShowEventModal(true);
                              }}
                            >
                              <CalendarIcon className="h-3.5 w-3.5" />
                              <span>Event</span>
                            </button>
                          )}
                          {showExpense && (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 text-[#7C8B6E] hover:text-[#5B7A52]"
                              onClick={() => {
                                setShowExpenseModal(true);
                              }}
                            >
                              <Receipt className="h-3.5 w-3.5" />
                              <span>Expense</span>
                            </button>
                          )}
                          {showDocument && (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 text-[#7C8B6E] hover:text-[#5B7A52]"
                              onClick={() => {
                                setShowDocumentModal(true);
                              }}
                            >
                              <Paperclip className="h-3.5 w-3.5" />
                              <span>Document</span>
                            </button>
                          )}
                          {showCourt && (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 text-[#7C8B6E] hover:text-[#5B7A52]"
                              onClick={() => {
                                setShowCourtOrderModal(true);
                              }}
                            >
                              <ScrollText className="h-3.5 w-3.5" />
                              <span>Court Order</span>
                            </button>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#E8EDE3] text-[#5B7A52]">
              <MessageCircle className="h-7 w-7" />
            </div>
            <div className="text-center space-y-1">
              <p className="text-sm font-medium text-[#3D3D3D]">
                Select a conversation
              </p>
              <p className="text-xs text-[#8A8A8A] max-w-xs">
                Choose a conversation from the list, or start a new one with the + button.
              </p>
            </div>
          </div>
        )}
      </div>

      {newModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-3"
          onClick={(e) => {
            if (e.target === e.currentTarget && !creating) {
              setNewModalOpen(false);
            }
          }}
        >
          <div className="w-full max-w-md rounded-2xl border border-[#E8E4DC] bg-white p-4 shadow-card">
            <h2 className="font-heading text-base font-semibold text-[#3D3D3D]">
              New Conversation
            </h2>
            <p className="mt-1 text-[11px] text-[#8A8A8A]">
              Start a new AI-mediated conversation with your co-parent.
            </p>
            <form onSubmit={handleCreateConversation} className="mt-4 space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-[#3D3D3D]">
                  To
                </label>
                <select
                  value="coparent"
                  className="h-8 w-full rounded-md border border-[#E8E4DC] bg-[#FDFBF7] px-2 text-xs text-[#3D3D3D] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E]"
                  readOnly
                >
                  <option value="coparent">Co-Parent</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[#3D3D3D]">
                  Topic
                </label>
                <select
                  value={newTopic}
                  onChange={(e) => setNewTopic(e.target.value)}
                  className="h-8 w-full rounded-md border border-[#E8E4DC] bg-[#FDFBF7] px-2 text-xs text-[#3D3D3D] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E]"
                  required
                >
                  <option value="">Select a topic</option>
                  {CONVERSATION_TOPICS.map(({ value, label }) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[#3D3D3D]">
                  Child
                </label>
                <select
                  value={newChildId}
                  onChange={(e) =>
                    setNewChildId(e.target.value as string | "general")
                  }
                  className="h-8 w-full rounded-md border border-[#E8E4DC] bg-[#FDFBF7] px-2 text-xs text-[#3D3D3D] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E]"
                >
                  <option value="general">General</option>
                  {children.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.first_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[#3D3D3D]">
                  Subject
                </label>
                <input
                  type="text"
                  value={newSubject}
                  onChange={(e) => setNewSubject(e.target.value)}
                  placeholder="e.g., Doctor visit copay, Weekend swap..."
                  className="h-8 w-full rounded-md border border-[#E8E4DC] bg-[#FDFBF7] px-2 text-xs text-[#3D3D3D] placeholder:text-[#B0A899] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E]"
                  required
                />
              </div>
              <div className="space-y-1 pt-1">
                <label className="flex items-start gap-2 text-[11px] text-[#3D3D3D]">
                  <input
                    type="checkbox"
                    className="mt-[1px] h-3.5 w-3.5 rounded border border-[#D4A843] text-[#D4A843] accent-[#D4A843] focus:outline-none focus:ring-1 focus:ring-[#D4A843]/60"
                    checked={newIsEmergency}
                    onChange={(e) => setNewIsEmergency(e.target.checked)}
                  />
                  <span className="font-medium">
                    This is an emergency communication
                  </span>
                </label>
                {newIsEmergency && (
                  <p className="pl-5 text-[10px] text-[#D4A843]">
                    Emergency messages are delivered immediately, bypassing delivery windows and cool-off periods.
                  </p>
                )}
              </div>
              <div className="mt-2 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-full text-xs"
                  onClick={() => setNewModalOpen(false)}
                  disabled={creating}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  className="h-8 rounded-full bg-[#5B7A52] text-xs text-white hover:bg-[#476242]"
                  disabled={creating || !newSubject.trim() || !newTopic}
                >
                  {creating ? "Starting…" : "Start Conversation"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEventModal && activeConversation && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-3"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowEventModal(false);
          }}
        >
          <div className="w-full max-w-md rounded-2xl border border-[#E8E4DC] bg-white p-4 shadow-card">
            <h2 className="font-heading text-base font-semibold text-[#3D3D3D]">
              Add Calendar Event
            </h2>
            <p className="mt-1 text-[11px] text-[#8A8A8A]">
              Create a calendar event related to this conversation. You&apos;ll finish details on the Calendar page.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-full text-xs"
                onClick={() => setShowEventModal(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8 rounded-full bg-[#5B7A52] text-xs text-white hover:bg-[#476242]"
                onClick={() => {
                  const search = new URLSearchParams();
                  if (activeConversation.child_id) search.set("child_id", activeConversation.child_id);
                  router.push(`/calendar?${search.toString()}`);
                  setShowEventModal(false);
                }}
              >
                Open calendar
              </Button>
            </div>
          </div>
        </div>
      )}

      {showExpenseModal && activeConversation && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-3"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowExpenseModal(false);
          }}
        >
          <div className="w-full max-w-md rounded-2xl border border-[#E8E4DC] bg-white p-4 shadow-card">
            <h2 className="font-heading text-base font-semibold text-[#3D3D3D]">
              Link Expense
            </h2>
            <p className="mt-1 text-[11px] text-[#8A8A8A]">
              Select an existing expense related to this conversation. This link is private to this case.
            </p>
            <div className="mt-3 space-y-2">
              <input
                type="text"
                value={attachExpensesSearch}
                onChange={(e) => setAttachExpensesSearch(e.target.value)}
                placeholder="Search expenses..."
                className="w-full rounded-full border border-[#E8E4DC] bg-[#FDFBF7] px-3 py-1.5 text-[11px] text-[#3D3D3D] placeholder:text-[#B0A899] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E]"
              />
              <div className="mt-1 max-h-[300px] overflow-y-auto rounded-xl border border-[#F0E6D6] bg-[#FDFBF7]">
                {attachExpensesLoading ? (
                  <div className="flex items-center justify-center py-8 text-[11px] text-[#8A8A8A]">
                    Loading expenses…
                  </div>
                ) : attachExpenses.length === 0 ? (
                  <div className="py-6 text-center text-[11px] text-[#8A8A8A]">
                    No expenses yet.
                  </div>
                ) : (
                  <ul className="divide-y divide-[#EDE2D1]">
                    {attachExpenses
                      .filter((e) =>
                        attachExpensesSearch.trim()
                          ? e.description.toLowerCase().includes(attachExpensesSearch.toLowerCase())
                          : true
                      )
                      .map((e) => {
                        const selected = attachSelectedExpenseId === e.id;
                        const dateLabel = new Date(e.created_at).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        });
                        const amount = Number(e.amount ?? 0).toFixed(2);
                        return (
                          <li key={e.id}>
                            <button
                              type="button"
                              onClick={() =>
                                setAttachSelectedExpenseId(selected ? null : e.id)
                              }
                              className={cn(
                                "flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] transition-colors",
                                selected
                                  ? "border-l-2 border-l-[#7C8B6E] bg-[#F2F5EF]"
                                  : "border-l-2 border-l-transparent hover:bg-[#FBF3E4]"
                              )}
                            >
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[12px] font-medium text-[#3D3D3D]">
                                  {e.description}
                                </p>
                                <p className="mt-0.5 text-[10px] text-[#8A8A8A]">
                                  {e.category} · {dateLabel}
                                </p>
                              </div>
                              <div className="flex flex-col items-end gap-1">
                                <span className="text-[11px] font-semibold text-[#3D3D3D]">
                                  ${amount}
                                </span>
                                <span className="inline-flex items-center rounded-full bg-[#F4F0E6] px-2 py-0.5 text-[9px] text-[#6C6455]">
                                  {e.status}
                                </span>
                              </div>
                            </button>
                          </li>
                        );
                      })}
                  </ul>
                )}
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-full text-xs"
                onClick={() => setShowExpenseModal(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8 rounded-full bg-[#5B7A52] text-xs text-white hover:bg-[#476242]"
                disabled={!attachSelectedExpenseId}
                onClick={async () => {
                  if (!attachSelectedExpenseId) return;
                  try {
                    const res = await fetch(
                      `/api/messages/conversations/${activeConversation.id}/attachments`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          type: "expense",
                          attachment_id: attachSelectedExpenseId,
                        }),
                      }
                    );
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok) {
                      showErrorToast(
                        (data as { error?: string }).error ??
                          "Unable to link expense right now."
                      );
                      return;
                    }
                    showSuccessToast("Expense linked");
                    setShowExpenseModal(false);
                  } catch {
                    showErrorToast("Unable to link expense right now.");
                  }
                }}
              >
                Link
              </Button>
            </div>
          </div>
        </div>
      )}

      {showDocumentModal && activeConversation && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-3"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowDocumentModal(false);
          }}
        >
          <div className="w-full max-w-md rounded-2xl border border-[#E8E4DC] bg-white p-4 shadow-card">
            <h2 className="font-heading text-base font-semibold text-[#3D3D3D]">
              Attach Document
            </h2>
            <p className="mt-1 text-[11px] text-[#8A8A8A]">
              Select an existing document related to this conversation. This link is private to this case.
            </p>
            <div className="mt-3 space-y-2">
              <input
                type="text"
                value={attachDocumentsSearch}
                onChange={(e) => setAttachDocumentsSearch(e.target.value)}
                placeholder="Search documents..."
                className="w-full rounded-full border border-[#E8E4DC] bg-[#FDFBF7] px-3 py-1.5 text-[11px] text-[#3D3D3D] placeholder:text-[#B0A899] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E]"
              />
              <div className="mt-1 max-h-[300px] overflow-y-auto rounded-xl border border-[#F0E6D6] bg-[#FDFBF7]">
                {attachDocumentsLoading ? (
                  <div className="flex items-center justify-center py-8 text-[11px] text-[#8A8A8A]">
                    Loading documents…
                  </div>
                ) : attachDocuments.length === 0 ? (
                  <div className="py-6 text-center text-[11px] text-[#8A8A8A]">
                    No documents yet.
                  </div>
                ) : (
                  <ul className="divide-y divide-[#EDE2D1]">
                    {attachDocuments
                      .filter((d) =>
                        attachDocumentsSearch.trim()
                          ? d.file_name.toLowerCase().includes(
                              attachDocumentsSearch.toLowerCase()
                            )
                          : true
                      )
                      .map((d) => {
                        const selected = attachSelectedDocumentId === d.id;
                        const dateLabel = new Date(d.created_at).toLocaleDateString(
                          undefined,
                          {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          }
                        );
                        return (
                          <li key={d.id}>
                            <button
                              type="button"
                              onClick={() =>
                                setAttachSelectedDocumentId(selected ? null : d.id)
                              }
                              className={cn(
                                "flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] transition-colors",
                                selected
                                  ? "border-l-2 border-l-[#7C8B6E] bg-[#F2F5EF]"
                                  : "border-l-2 border-l-transparent hover:bg-[#FBF3E4]"
                              )}
                            >
                              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#E8EDE3] text-[#5B7A52]">
                                <Paperclip className="h-3.5 w-3.5" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[12px] font-medium text-[#3D3D3D]">
                                  {d.file_name}
                                </p>
                                <p className="mt-0.5 text-[10px] text-[#8A8A8A]">
                                  {d.category} · {dateLabel}
                                </p>
                              </div>
                            </button>
                          </li>
                        );
                      })}
                  </ul>
                )}
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-full text-xs"
                onClick={() => setShowDocumentModal(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8 rounded-full bg-[#5B7A52] text-xs text-white hover:bg-[#476242]"
                disabled={!attachSelectedDocumentId}
                onClick={async () => {
                  if (!attachSelectedDocumentId) return;
                  try {
                    const res = await fetch(
                      `/api/messages/conversations/${activeConversation.id}/attachments`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          type: "document",
                          document_id: attachSelectedDocumentId,
                        }),
                      }
                    );
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok) {
                      showErrorToast(
                        (data as { error?: string }).error ??
                          "Unable to attach document right now."
                      );
                      return;
                    }
                    showSuccessToast("Document attached");
                    setShowDocumentModal(false);
                  } catch {
                    showErrorToast("Unable to attach document right now.");
                  }
                }}
              >
                Attach
              </Button>
            </div>
          </div>
        </div>
      )}

      {showCourtOrderModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-3"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowCourtOrderModal(false);
          }}
        >
          <div className="w-full max-w-md rounded-2xl border border-[#E8E4DC] bg-white p-4 shadow-card">
            <h2 className="font-heading text-base font-semibold text-[#3D3D3D]">
              Reference Court Order
            </h2>
            <p className="mt-1 text-[11px] text-[#8A8A8A]">
              View or reference a court order from your profile. You&apos;ll manage court orders on the Profile page.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-full text-xs"
                onClick={() => setShowCourtOrderModal(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8 rounded-full bg-[#5B7A52] text-xs text-white hover:bg-[#476242]"
                onClick={() => {
                  router.push("/profile?section=court-orders");
                  setShowCourtOrderModal(false);
                }}
              >
                Open court orders
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Cool-off modal */}
      {showCoolOffModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-3"
          onClick={(e) => {
            if (e.target === e.currentTarget && !startingCoolOff) {
              setShowCoolOffModal(false);
            }
          }}
        >
          <div className="w-full max-w-md rounded-2xl border border-[#E8E4DC] bg-white p-4 shadow-card">
            <h2 className="font-heading text-base font-semibold text-[#3D3D3D]">
              Take a cool-off break
            </h2>
            <p className="mt-1 text-[11px] text-[#8A8A8A]">
              Sending will be paused. Incoming messages will appear when your break ends.
            </p>
            <div className="mt-4 space-y-2">
              <label className="text-xs font-medium text-[#3D3D3D]">
                Duration (hours, up to 48)
              </label>
              <input
                type="number"
                min={0.5}
                max={48}
                step={0.5}
                value={coolOffHours}
                onChange={(e) => setCoolOffHours(e.target.value)}
                className="h-8 w-full rounded-md border border-[#E8E4DC] bg-[#FDFBF7] px-2 text-xs text-[#3D3D3D]"
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-full text-xs"
                onClick={() => setShowCoolOffModal(false)}
                disabled={startingCoolOff}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8 rounded-full bg-[#5B7A52] text-xs text-white hover:bg-[#476242]"
                disabled={startingCoolOff}
                onClick={async () => {
                  const hours = Math.min(48, Math.max(0.5, Number(coolOffHours) || 2));
                  setStartingCoolOff(true);
                  try {
                    const res = await fetch("/api/messages/cool-off", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ hours }),
                    });
                    const d = await res.json().catch(() => ({}));
                    if (res.ok && d.ends_at) {
                      setCoolOffActive({ id: d.id, ends_at: d.ends_at });
                      setShowCoolOffModal(false);
                    } else {
                      showErrorToast(
                        (d as { error?: string }).error ?? "Could not start break."
                      );
                    }
                  } finally {
                    setStartingCoolOff(false);
                  }
                }}
              >
                Start break
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Sage coaching modal */}
      {sageOpen && activeConversation && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/10"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setSageOpen(false);
              setSageContextMessage(null);
            }
          }}
        >
          <div className="h-full w-full max-w-[480px] bg-white/95 shadow-card border-l border-[#E8E4DC] flex flex-col animate-[sageDrawer_200ms_ease-out_forwards]">
            {/* Header with privacy line (sticky) */}
              <div className="border-b border-[#E8E4DC] bg-white sticky top-0 z-10">
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
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/dove-translucent.png"
                      alt="Sage"
                      style={{
                        width: "34px",
                        height: "34px",
                        objectFit: "contain",
                        display: "block",
                      }}
                    />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#3D3D3D]">Sage</p>
                    <p className="flex items-center gap-1 text-[11px] text-[#8A8A8A]">
                      <Lock className="h-3 w-3 text-[#7C8B6E]" />
                      <span>Private coaching — Not visible to your co-parent.</span>
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSageOpen(false);
                    setSageContextMessage(null);
                  }}
                  aria-label="Close Sage"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[#8A8A8A] hover:bg-muted hover:text-[#3D3D3D]"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>
              <div className="px-4 py-2 text-[11px] text-[#5B7A52] bg-[#F2F5EF] border-t border-[#E8E4DC] space-y-0.5">
                <p>
                  Conversation: {activeConversation.subject}
                  {activeChildName ? ` · ${activeChildName}` : ""}
                </p>
                {sageContextMessage && (
                  <p className="text-[#8A8A8A] truncate" title={sageContextMessage}>
                    Child: {sageContextMessage.slice(0, 60)}
                    {sageContextMessage.length > 60 ? "…" : ""}
                  </p>
                )}
              </div>
            </div>

            {/* Sage chat area */}
            <ScrollArea className="flex-1 px-4 py-3 space-y-3">
              {sageMessages.map((m) => {
                const isSage = m.role === "sage";
                return (
                  <div
                    key={m.id}
                    className={cn(
                      "flex max-w-[80%] gap-2 items-start",
                      isSage ? "mr-auto" : "ml-auto flex-row-reverse"
                    )}
                  >
                    <div className="mt-0.5 h-7 w-7 flex items-center justify-center">
                      {isSage ? (
                        <div
                          style={{
                            width: "28px",
                            height: "28px",
                            borderRadius: "50%",
                            backgroundColor: "#dce5d3",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src="/dove-translucent.png"
                            alt="Sage"
                            style={{
                              width: "18px",
                              height: "18px",
                              objectFit: "contain",
                              display: "block",
                            }}
                          />
                        </div>
                      ) : currentUserAvatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={currentUserAvatarUrl}
                          alt={currentUserInitial}
                          className="h-6 w-6 rounded-full object-cover border border-border/60 bg-muted"
                        />
                      ) : (
                        <div className="h-6 w-6 rounded-full bg-[#E8EDE3] flex items-center justify-center">
                          <span className="text-[11px] font-semibold text-[#5B7A52]">
                            {currentUserInitial}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="space-y-1">
                      <div
                        className={cn(
                          "inline-block rounded-2xl px-3 py-2 text-sm text-[#3D3D3D] whitespace-pre-wrap",
                          isSage ? "bg-[#F2F5EF]" : "bg-[#F9F6F0]"
                        )}
                      >
                        {m.content}
                      </div>
                      <time className="block text-[10px] text-[#8A8A8A]">
                        {new Date(m.created_at).toLocaleTimeString(undefined, {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </time>
                    </div>
                  </div>
                );
              })}
              <div ref={sageBottomRef} />
            </ScrollArea>

            {/* Compose inside Sage modal */}
            <div className="border-t border-[#E8E4DC] bg-white px-4 py-3 space-y-2">
              <Textarea
                value={sageInput}
                onChange={(e) => setSageInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (sageInput.trim()) {
                      void handleSageSend();
                    }
                  }
                }}
                placeholder="Ask Sage anything..."
                rows={3}
                className="min-h-[60px] resize-none rounded-[10px] border border-[#E8E4DC] bg-[#F9F6F0] text-sm text-[#3D3D3D] placeholder:text-[#B0A899]"
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  className="h-8 rounded-full bg-[#5B7A52] text-xs text-white hover:bg-[#476242]"
                  disabled={!sageInput.trim()}
                  onClick={() => {
                    if (sageInput.trim()) {
                      void handleSageSend();
                    }
                  }}
                >
                  Send to Sage
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={deleteConversationId !== null}
        title="Delete conversation?"
        description="This cannot be undone."
        confirmLabel="Delete"
        confirmTone="danger"
        onCancel={() => setDeleteConversationId(null)}
        onConfirm={() => {
          const id = deleteConversationId;
          if (!id) return;
          void (async () => {
            try {
              const res = await fetch(`/api/messages/conversations/${id}`, {
                method: "DELETE",
              });
              if (!res.ok) {
                // eslint-disable-next-line no-console
                console.error("Failed to delete conversation");
                return;
              }
              if (selectedId === id) {
                setSelectedId(null);
                setMessages([]);
              }
              await loadConversations();
            } catch (err) {
              // eslint-disable-next-line no-console
              console.error(err);
            } finally {
              setDeleteConversationId(null);
            }
          })();
        }}
      />

      <ConfirmModal
        open={confirmArchiveOpen && !!activeConversation}
        title={
          activeConversation?.status === "archived"
            ? "Unarchive conversation?"
            : "Archive conversation?"
        }
        description={
          activeConversation?.status === "archived"
            ? "This conversation will return to your Open list."
            : "You can find this conversation later under Archived."
        }
        confirmLabel={activeConversation?.status === "archived" ? "Unarchive" : "Archive"}
        onCancel={() => setConfirmArchiveOpen(false)}
        onConfirm={async () => {
          if (!activeConversation) return;
          const isArchived = activeConversation.status === "archived";
          const nextStatus = isArchived ? "open" : "archived";
          const res = await fetch(
            `/api/messages/conversations/${activeConversation.id}/status`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: nextStatus }),
            }
          );
          if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            showErrorToast(
              (d as { error?: string }).error ?? "Could not update conversation."
            );
            return;
          }
          await loadConversations();
          if (nextStatus === "archived") {
            setSelectedId(null);
            setMessages([]);
          }
          setConfirmArchiveOpen(false);
        }}
      />

      <ConfirmModal
        open={discardDraftOpen}
        title="Discard message?"
        description="This cannot be undone."
        confirmLabel="Discard"
        confirmTone="danger"
        onCancel={() => setDiscardDraftOpen(false)}
        onConfirm={() => {
          setPreviewMode("idle");
          setPreviewOriginal("");
          setPreviewSage("");
          setPreviewEditable("");
          setComposeText("");
          setSending(false);
          setDiscardDraftOpen(false);
        }}
      />
    </div>
  );
}

