"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Send, PenLine, Trash2, Flag, Archive, Search, FileText, MoreVertical } from "lucide-react";
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
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!menuOpenId) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (
        !target?.closest("[data-sage-session-menu]") &&
        !target?.closest("[data-sage-session-menu-button]")
      ) {
        setMenuOpenId(null);
        setDeleteConfirmId(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpenId]);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

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

  async function handleArchive(sessionId: string, archived: boolean) {
    try {
      const res = await fetch(`/api/sage/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showErrorToast((data as { message?: string }).message ?? "Could not update session.");
        return;
      }
      setSessions((prev) =>
        prev
          .map((s) =>
            s.id === sessionId ? { ...s, archived } : s
          )
          .filter((s) => !s.archived || listFilter === "archived")
      );
      if (selectedId === sessionId && archived) setSelectedId(null);
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
      setMenuOpenId(null);
    } catch {
      showErrorToast("Something went wrong.");
    }
  }

  async function handleRename(sessionId: string, currentTitle: string | null) {
    const next = renameValue.trim();
    if (!next) {
      setRenamingId(null);
      setRenameValue("");
      return;
    }
    try {
      const res = await fetch(`/api/sage/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showErrorToast((data as { message?: string }).message ?? "Could not rename session.");
        setRenameValue(currentTitle ?? "");
        return;
      }
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, title: next } : s))
      );
      setRenamingId(null);
      setRenameValue("");
      setMenuOpenId(null);
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
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[#E8E4DC]">
            <select
              value={listFilter}
              onChange={(e) => setListFilter(e.target.value as ListFilter)}
              className={cn(
                "h-8 w-[120px] shrink-0 rounded-full border px-2 py-1 text-[11px] text-[#3D3D3D] bg-[#FDFBF7] border-[#E8E4DC] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E]",
                listFilter !== "all" && "bg-[#F2F5EF] border-[#7C8B6E]"
              )}
              aria-label="Filter sessions"
            >
              <option value="all">All sessions</option>
              <option value="flagged">Flagged</option>
              <option value="documented">Documented</option>
              <option value="archived">Archived</option>
            </select>
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
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
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
                            {renamingId === s.id ? (
                              <input
                                ref={renameInputRef}
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    void handleRename(s.id, s.title);
                                  } else if (e.key === "Escape") {
                                    e.preventDefault();
                                    setRenamingId(null);
                                    setRenameValue("");
                                  }
                                }}
                                onBlur={() => {
                                  setRenamingId(null);
                                  setRenameValue("");
                                }}
                                className="w-full rounded border border-[#E8E4DC] bg-[#FDFBF7] px-2 py-1 text-[11px] text-[#3D3D3D] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E]"
                              />
                            ) : (
                              <span className="min-w-0 truncate">
                                {truncateTitle(s.title)}
                              </span>
                            )}
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
                        </div>
                        <button
                          type="button"
                          data-sage-session-menu-button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setMenuOpenId(menuOpenId === s.id ? null : s.id);
                            setDeleteConfirmId(null);
                          }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-[#E8E4DC] text-[#B0A899] hover:text-[#6A7A6E]"
                          aria-label="Session options"
                          aria-expanded={menuOpenId === s.id}
                        >
                          <MoreVertical className="h-4 w-4" />
                        </button>
                      </div>
                    </button>
                    {menuOpenId === s.id && (
                      <div
                        data-sage-session-menu
                        className="absolute right-0 top-9 z-20 min-w-[180px] rounded-lg border border-[#E8E4DC] bg-white py-1 shadow-lg"
                      >
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-[#3D3D3D] hover:bg-[#F2F5EF] text-left"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setRenamingId(s.id);
                            setRenameValue(s.title ?? "");
                          }}
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-[#3D3D3D] hover:bg-[#F2F5EF] text-left"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void handleFlag(s.id, !!s.flagged);
                            setMenuOpenId(null);
                          }}
                        >
                          <Flag className="h-3.5 w-3.5" />{" "}
                          {s.flagged ? "Unflag session" : "Flag session"}
                        </button>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-[#3D3D3D] hover:bg-[#F2F5EF] text-left"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void handleArchive(s.id, !s.archived);
                            setMenuOpenId(null);
                          }}
                        >
                          {s.archived ? (
                            <>
                              <Archive className="h-3.5 w-3.5" /> Unarchive session
                            </>
                          ) : (
                            <>
                              <Archive className="h-3.5 w-3.5" /> Archive session
                            </>
                          )}
                        </button>
                        <div className="border-t border-[#F2F5EF] mt-1 pt-1">
                          {deleteConfirmId === s.id ? (
                            <div className="px-3 py-2 text-[12px] text-[#6B6B6B] space-y-1">
                              <p>Delete this session?</p>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  className="rounded px-2 py-1 text-[12px] font-medium text-[#A85C5C] hover:bg-[#FDF2F2]"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    void handleDelete(s.id);
                                  }}
                                >
                                  Yes
                                </button>
                                <button
                                  type="button"
                                  className="rounded px-2 py-1 text-[12px] font-medium text-[#6B6B6B] hover:bg-[#F2F5EF]"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setDeleteConfirmId(null);
                                  }}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-[#C3442D] hover:bg-[#FDF2F0] text-left"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setDeleteConfirmId(s.id);
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" /> Delete session
                            </button>
                          )}
                        </div>
                      </div>
                    )}
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
