"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Send, PenLine, Trash2, Flag, Archive, Search, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SageClient } from "./SageClient";
import { showErrorToast } from "@/components/ui/toaster";

type SessionRow = {
  id: string;
  user_id: string;
  title: string | null;
  category: string | null;
  created_at: string;
  updated_at: string;
  flagged?: boolean;
  archived?: boolean;
  documented?: boolean;
  documented_at?: string | null;
};

type ListFilter = "all" | "flagged" | "documented" | "archived";

const CATEGORY_SHORTCUTS = [
  { emoji: "🌬️", label: "I need to vent", category: "venting" },
  { emoji: "✍️", label: "Help me draft a message", category: "drafting" },
  { emoji: "📋", label: "Document an interaction", category: "documenting" },
  { emoji: "💬", label: "Just talk it through", category: "general" },
] as const;

function formatSessionDate(iso: string): string {
  const d = new Date(iso);
  const mon = d.toLocaleString("en-US", { month: "short" });
  const day = d.getDate();
  return `${mon} ${day}`;
}

function truncateTitle(title: string | null, max = 40): string {
  if (!title || !title.trim()) return "New session";
  return title.length <= max ? title : title.slice(0, max).trim() + "…";
}

export function SageSplitView() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creatingSession, setCreatingSession] = useState(false);
  const [showDraftAssistant, setShowDraftAssistant] = useState(false);
  const [draftAssistantInput, setDraftAssistantInput] = useState("");
  const [draftAssistantRewritten, setDraftAssistantRewritten] = useState<string | null>(null);
  const [draftAssistantLoading, setDraftAssistantLoading] = useState(false);
  const [initialDraftForSage, setInitialDraftForSage] = useState<string | null>(null);

  const [listFilter, setListFilter] = useState<ListFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const res = await fetch(
        `/api/sage/sessions?filter=${encodeURIComponent(listFilter)}`
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const list = (data as { sessions?: SessionRow[] }).sessions ?? [];
        setSessions(list);
      }
    } catch {
      showErrorToast("Could not load sessions.");
    } finally {
      setLoadingSessions(false);
    }
  }, [listFilter]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  async function handleNewSession(category?: string) {
    if (creatingSession) return;
    setCreatingSession(true);
    try {
      const res = await fetch("/api/sage/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(category ? { category } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showErrorToast(
          (data as { message?: string }).message ?? "Could not create session."
        );
        return;
      }
      const session = (data as { session?: SessionRow }).session;
      if (session) {
        setSessions((prev) => [session, ...prev]);
        setSelectedId(session.id);
      }
    } finally {
      setCreatingSession(false);
    }
  }

  const filteredSessions = searchQuery.trim()
    ? sessions.filter((s) =>
        truncateTitle(s.title)
          .toLowerCase()
          .includes(searchQuery.trim().toLowerCase())
      )
    : sessions;

  const selectedSession = sessions.find((s) => s.id === selectedId) ?? null;

  async function handleFlag(sessionId: string, currentFlagged: boolean) {
    try {
      const res = await fetch(`/api/sage/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flagged: !currentFlagged }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showErrorToast((data as { message?: string }).message ?? "Could not update session.");
        return;
      }
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId ? { ...s, flagged: !currentFlagged } : s
        )
      );
    } catch {
      showErrorToast("Something went wrong.");
    }
  }

  async function handleArchive(sessionId: string) {
    try {
      const res = await fetch(`/api/sage/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showErrorToast((data as { message?: string }).message ?? "Could not archive session.");
        return;
      }
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (selectedId === sessionId) setSelectedId(null);
    } catch {
      showErrorToast("Something went wrong.");
    }
  }

  async function handleDelete(sessionId: string) {
    try {
      const res = await fetch(`/api/sage/sessions/${sessionId}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showErrorToast((data as { message?: string }).message ?? "Could not delete session.");
        return;
      }
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (selectedId === sessionId) setSelectedId(null);
      setDeleteConfirmId(null);
    } catch {
      showErrorToast("Something went wrong.");
    }
  }

  async function handleRewriteMessage() {
    const text = draftAssistantInput.trim();
    if (!text) return;
    setDraftAssistantLoading(true);
    setDraftAssistantRewritten(null);
    try {
      const res = await fetch("/api/sage/rewrite-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showErrorToast((data as { message?: string }).message ?? "Could not rewrite message.");
        return;
      }
      setDraftAssistantRewritten((data as { rewritten?: string }).rewritten ?? text);
    } catch {
      showErrorToast("Something went wrong. Try again.");
    } finally {
      setDraftAssistantLoading(false);
    }
  }

  function openNewConversationWithBody(body: string) {
    router.push(
      `/messages?new=1&subject=${encodeURIComponent("From Sage")}&body=${encodeURIComponent(body)}`
    );
    setShowDraftAssistant(false);
    setDraftAssistantRewritten(null);
    setDraftAssistantInput("");
  }

  return (
    <div className="flex h-[calc(100vh-4.5rem)] bg-[#FDFBF7]">
      {/* LEFT PANEL — 280–300px */}
      <div className="flex h-full w-[300px] shrink-0 flex-col border-r border-[#E8E4DC] bg-white">
        <div className="border-b border-[#E8E4DC] px-3 py-3">
          <h2 className="font-heading text-sm font-semibold text-[#3D3D3D]">
            Sage
          </h2>
          <p className="mt-0.5 text-[11px] text-[#8A8A8A]">
            Your private space to think before you act.
          </p>
        </div>

        {/* Category shortcuts */}
        <div className="border-b border-[#E8E4DC] px-3 py-3 space-y-2">
          {CATEGORY_SHORTCUTS.map(({ emoji, label, category }) => (
            <button
              key={category}
              type="button"
              onClick={() => void handleNewSession(category)}
              disabled={creatingSession}
              className={cn(
                "w-full rounded-full border px-3 py-2 text-left text-xs transition-colors",
                "border-[#E8E4DC] bg-[#F2F5EF] text-[#3D3D3D]",
                "hover:bg-[#E8EDE3] hover:border-[#7C8B6E]",
                "disabled:opacity-60"
              )}
            >
              <span className="mr-2">{emoji}</span>
              {label}
            </button>
          ))}
        </div>

        {/* Recent sessions */}
        <div className="flex flex-1 flex-col min-h-0">
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[#E8E4DC]">
            <span className="text-[11px] font-medium text-[#8A8A8A]">
              Recent sessions
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 rounded-full text-[#5B7A52] hover:bg-[#F2F5EF]"
              onClick={() => void handleNewSession()}
              disabled={creatingSession}
              aria-label="New session"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Search */}
          <div className="px-3 py-2 border-b border-[#E8E4DC]">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#8A8A8A]" />
              <input
                type="search"
                placeholder="Search sessions"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={cn(
                  "w-full rounded-full border border-[#E8E4DC] bg-[#FDFBF7] pl-8 pr-3 py-1.5 text-xs text-[#3D3D3D] placeholder:text-[#8A8A8A]",
                  "focus:outline-none focus:ring-1 focus:ring-[#7C8B6E] focus:border-[#7C8B6E]"
                )}
                aria-label="Search session titles"
              />
            </div>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-1.5 px-3 py-2 border-b border-[#E8E4DC]">
            {(["all", "flagged", "documented", "archived"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setListFilter(f)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors capitalize",
                  listFilter === f
                    ? "bg-[#5B7A52] text-white border border-[#5B7A52]"
                    : "border border-[#E8E4DC] bg-[#F2F5EF] text-[#6B6B6B] hover:bg-[#E8EDE3] hover:border-[#7C8B6E]"
                )}
              >
                {f}
              </button>
            ))}
          </div>

          <ScrollArea className="flex-1">
            <div className="px-2 py-2 space-y-0.5">
              {loadingSessions ? (
                <p className="px-2 py-2 text-[11px] text-[#8A8A8A]">
                  Loading…
                </p>
              ) : filteredSessions.length === 0 ? (
                <p className="px-2 py-2 text-[11px] text-[#8A8A8A]">
                  {sessions.length === 0
                    ? listFilter === "archived"
                      ? "No archived sessions."
                      : listFilter === "flagged"
                        ? "No flagged sessions."
                        : listFilter === "documented"
                          ? "No documented interactions yet."
                          : "No sessions yet. Start with a shortcut above or New session."
                    : "No sessions match your search."}
                </p>
              ) : (
                filteredSessions.map((s) => (
                  <div
                    key={s.id}
                    className={cn(
                      "group relative w-full rounded-lg border transition-colors",
                      selectedId === s.id
                        ? "bg-[#F2F5EF] border-[#E8EDE3]"
                        : "border-transparent hover:bg-[#F9FAF8]"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedId(s.id)}
                      className="w-full rounded-lg px-2.5 py-2 text-left"
                    >
                      <p className="text-xs font-medium text-[#3D3D3D] truncate flex items-center gap-1.5">
                        {s.flagged && (
                          <span className="shrink-0 text-[#5B7A52]" title="Flagged">
                            <Flag className="h-3 w-3 fill-current" />
                          </span>
                        )}
                        {s.documented && (
                          <span className="shrink-0 text-[#5B7A52]" title="Documented interaction">
                            <FileText className="h-3 w-3" />
                          </span>
                        )}
                        <span className="min-w-0 truncate">{truncateTitle(s.title)}</span>
                      </p>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-[10px] text-[#8A8A8A]">
                          {formatSessionDate(s.updated_at)}
                        </span>
                        {s.category ? (
                          <span className="inline-flex items-center rounded-full bg-[#E8E4DC] px-1.5 py-0.5 text-[9px] text-[#6B6B6B]">
                            {s.category}
                          </span>
                        ) : null}
                      </div>
                    </button>
                    {/* Row actions on hover */}
                    <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleFlag(s.id, !!s.flagged);
                        }}
                        className={cn(
                          "rounded p-1 transition-colors",
                          s.flagged
                            ? "text-[#5B7A52] bg-[#F2F5EF] hover:bg-[#E8EDE3]"
                            : "text-[#8A8A8A] hover:bg-[#F2F5EF] hover:text-[#5B7A52]"
                        )}
                        title={s.flagged ? "Unflag" : "Flag"}
                        aria-label={s.flagged ? "Unflag session" : "Flag session"}
                      >
                        <Flag className={cn("h-3 w-3", s.flagged && "fill-current")} />
                      </button>
                      {listFilter !== "archived" && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleArchive(s.id);
                          }}
                          className="rounded p-1 text-[#8A8A8A] hover:bg-[#F2F5EF] hover:text-[#5B7A52] transition-colors"
                          title="Archive"
                          aria-label="Archive session"
                        >
                          <Archive className="h-3 w-3" />
                        </button>
                      )}
                      {deleteConfirmId === s.id ? (
                        <span className="flex items-center gap-0.5 text-[10px] text-[#6B6B6B]">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(s.id);
                            }}
                            className="rounded px-1 py-0.5 font-medium text-[#A85C5C] hover:bg-[#FDF2F2]"
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteConfirmId(null);
                            }}
                            className="rounded px-1 py-0.5 font-medium text-[#6B6B6B] hover:bg-[#F2F5EF]"
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirmId(s.id);
                          }}
                          className="rounded p-1 text-[#8A8A8A] hover:bg-[#FDF2F2] hover:text-[#A85C5C] transition-colors"
                          title="Delete"
                          aria-label="Delete session"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* RIGHT PANEL — chat */}
      <div className="flex flex-1 flex-col min-w-0 bg-[#FDFBF7]">
        <div className="border-b border-[#E8E4DC] bg-white px-4 py-3">
          <h1 className="font-heading text-xl font-semibold text-foreground">
            Sage
          </h1>
          {selectedSession ? (
            <p className="mt-0.5 text-xs text-[#8A8A8A]">
              {truncateTitle(selectedSession.title)}
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-foreground-secondary">
              Your private space to think before you act.
            </p>
          )}
        </div>
        <div className="flex-1 min-h-0 p-3 md:p-4 flex flex-col">
          {showDraftAssistant ? (
            <div className="rounded-2xl border border-border bg-background-secondary/40 p-4 flex flex-col gap-4 h-full">
              <p className="text-sm text-foreground-secondary">
                Paste or type the message you want to send. Sage will suggest a calmer, child-focused version.
              </p>
              <Textarea
                value={draftAssistantInput}
                onChange={(e) => setDraftAssistantInput(e.target.value)}
                placeholder="Paste or type your draft here..."
                className="min-h-[120px] rounded-card border-border bg-background text-sm"
              />
              {!draftAssistantRewritten ? (
                <Button
                  type="button"
                  size="sm"
                  className="rounded-full h-9 px-4 bg-[#5B7A52] text-white hover:bg-[#476242] w-fit"
                  disabled={draftAssistantLoading || !draftAssistantInput.trim()}
                  onClick={() => void handleRewriteMessage()}
                >
                  {draftAssistantLoading ? "Rewriting…" : "Get calmer version"}
                </Button>
              ) : (
                <div className="rounded-card border border-[#E8E4DC] bg-[#FDFBF7] p-4 space-y-3">
                  <p className="text-xs font-medium text-[#8A8A8A]">Suggested version</p>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{draftAssistantRewritten}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className="rounded-full h-8 px-3 bg-[#5B7A52] text-white hover:bg-[#476242] text-xs"
                      onClick={() => openNewConversationWithBody(draftAssistantRewritten)}
                    >
                      <Send className="h-3 w-3 mr-1" /> Send
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="rounded-full h-8 px-3 border-[#7C8B6E] text-[#5B7A52] hover:bg-[#F2F5EF] text-xs"
                      onClick={() => {
                        setInitialDraftForSage(draftAssistantRewritten);
                        setShowDraftAssistant(false);
                        setDraftAssistantRewritten(null);
                        setDraftAssistantInput("");
                      }}
                    >
                      <PenLine className="h-3 w-3 mr-1" /> Edit
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="rounded-full h-8 px-3 border-[#E8E4DC] text-[#6B6B6B] hover:bg-[#F5F5F5] text-xs"
                      onClick={() => {
                        setShowDraftAssistant(false);
                        setDraftAssistantRewritten(null);
                        setDraftAssistantInput("");
                      }}
                    >
                      <Trash2 className="h-3 w-3 mr-1" /> Discard
                    </Button>
                  </div>
                </div>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="rounded-full h-8 text-xs text-[#8A8A8A] w-fit"
                onClick={() => {
                  setShowDraftAssistant(false);
                  setDraftAssistantRewritten(null);
                  setDraftAssistantInput("");
                }}
              >
                Back to journal
              </Button>
            </div>
          ) : selectedId ? (
            <SageClient
              sessionId={selectedId}
              sessionTitle={selectedSession?.title ?? undefined}
              onSessionTitleGenerated={loadSessions}
              onOpenDraftAssistant={() => setShowDraftAssistant(true)}
              initialDraft={initialDraftForSage}
              onConsumeInitialDraft={() => setInitialDraftForSage(null)}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center rounded-2xl border border-border bg-background-secondary/40 p-6">
              <p className="text-sm text-foreground-secondary text-center max-w-xs">
                Select a session from the list or use a shortcut above to start a new one.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
