"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Plus,
  Send,
  PenLine,
  Trash2,
  Flag,
  Archive,
  ArchiveRestore,
  Search,
  FileText,
  MoreVertical,
  ArrowLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SageClient } from "./SageClient";
import { IncidentSessionView } from "./IncidentSessionView";
import { showErrorToast } from "@/components/ui/toaster";
import {
  createSageSession,
  fetchSageSession,
  fetchSageSessions,
  notifySageSessionsChanged,
  sageChatHref,
  truncateSageSessionTitle,
  type SageSessionRow,
} from "@/lib/sage-sessions-client";

type ListFilter = "all" | "incident" | "flagged" | "archived";

type IncidentPattern = {
  id: string;
  label: string;
  summary: string;
  session_ids: string[];
};

function formatSessionDate(iso: string): string {
  const d = new Date(iso);
  const mon = d.toLocaleString("en-US", { month: "short" });
  const day = d.getDate();
  return `${mon} ${day}`;
}

export function SageSplitView() {
  const router = useRouter();
  const params = useParams();
  const urlSessionId =
    typeof params?.sessionId === "string" ? params.sessionId : null;

  const [sessions, setSessions] = useState<SageSessionRow[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [activeSession, setActiveSession] = useState<SageSessionRow | null>(
    null
  );
  const [sessionMissing, setSessionMissing] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [showDraftAssistant, setShowDraftAssistant] = useState(false);
  const [draftAssistantInput, setDraftAssistantInput] = useState("");
  const [draftAssistantRewritten, setDraftAssistantRewritten] = useState<
    string | null
  >(null);
  const [draftAssistantLoading, setDraftAssistantLoading] = useState(false);
  const [initialDraftForSage, setInitialDraftForSage] = useState<string | null>(
    null
  );

  const [listFilter, setListFilter] = useState<ListFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const [patterns, setPatterns] = useState<IncidentPattern[]>([]);
  const [activePatternSessionIds, setActivePatternSessionIds] = useState<
    string[] | null
  >(null);
  const [loadingPatterns, setLoadingPatterns] = useState(false);

  const showListPanel = !urlSessionId;
  const selectedSession =
    activeSession ??
    sessions.find((s) => s.id === urlSessionId) ??
    null;

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
      const list = await fetchSageSessions(listFilter);
      setSessions(list);
    } catch {
      showErrorToast("Could not load sessions.");
    } finally {
      setLoadingSessions(false);
    }
  }, [listFilter]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (!urlSessionId) {
      setActiveSession(null);
      setSessionMissing(false);
      return;
    }
    let cancelled = false;
    async function loadActive() {
      try {
        const session = await fetchSageSession(urlSessionId as string);
        if (cancelled) return;
        if (!session) {
          setActiveSession(null);
          setSessionMissing(true);
          return;
        }
        setSessionMissing(false);
        setActiveSession(session);
      } catch {
        if (!cancelled) {
          setActiveSession(null);
          setSessionMissing(true);
        }
      }
    }
    void loadActive();
    return () => {
      cancelled = true;
    };
  }, [urlSessionId]);

  useEffect(() => {
    const incidentCount = sessions.filter(
      (s) => s.session_type === "incident"
    ).length;
    if (incidentCount < 2) {
      setPatterns([]);
      setActivePatternSessionIds(null);
      return;
    }
    let cancelled = false;
    async function loadPatterns() {
      setLoadingPatterns(true);
      try {
        const res = await fetch("/api/sage/incidents/patterns");
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) {
          setPatterns(
            ((data as { patterns?: IncidentPattern[] }).patterns ??
              []) as IncidentPattern[]
          );
        }
      } catch {
        if (!cancelled) {
          setPatterns([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingPatterns(false);
        }
      }
    }
    void loadPatterns();
    return () => {
      cancelled = true;
    };
  }, [sessions]);

  async function handleNewSession(sessionType: "private" | "incident") {
    if (creatingSession) return;
    setCreatingSession(true);
    try {
      const session = await createSageSession(sessionType);
      setSessions((prev) => [session, ...prev]);
      router.push(sageChatHref(session.id));
    } catch (e) {
      showErrorToast(
        e instanceof Error ? e.message : "Could not create session."
      );
    } finally {
      setCreatingSession(false);
    }
  }

  const filteredSessions = searchQuery.trim()
    ? sessions.filter((s) =>
        truncateSageSessionTitle(s.title)
          .toLowerCase()
          .includes(searchQuery.trim().toLowerCase())
      )
    : sessions;

  const visibleSessions =
    activePatternSessionIds && listFilter === "incident"
      ? filteredSessions.filter((s) => activePatternSessionIds.includes(s.id))
      : filteredSessions;

  function patchSession(sessionId: string, patch: Partial<SageSessionRow>) {
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, ...patch } : s))
    );
    setActiveSession((prev) =>
      prev && prev.id === sessionId ? { ...prev, ...patch } : prev
    );
  }

  async function handleFlag(sessionId: string, currentFlagged: boolean) {
    try {
      const res = await fetch(`/api/sage/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flagged: !currentFlagged }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showErrorToast(
          (data as { message?: string }).message ?? "Could not update session."
        );
        return;
      }
      patchSession(sessionId, { flagged: !currentFlagged });
      notifySageSessionsChanged();
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
        showErrorToast(
          (data as { message?: string }).message ?? "Could not update session."
        );
        return;
      }
      setSessions((prev) =>
        prev
          .map((s) => (s.id === sessionId ? { ...s, archived } : s))
          .filter((s) => !s.archived || listFilter === "archived")
      );
      setActiveSession((prev) =>
        prev && prev.id === sessionId ? { ...prev, archived } : prev
      );
      notifySageSessionsChanged();
      if (urlSessionId === sessionId && archived) router.push("/sage");
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
        showErrorToast(
          (data as { message?: string }).message ?? "Could not delete conversation."
        );
        return;
      }
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      setDeleteConfirmId(null);
      setMenuOpenId(null);
      notifySageSessionsChanged();
      if (urlSessionId === sessionId) router.push("/sage");
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
        showErrorToast(
          (data as { message?: string }).message ?? "Could not rename session."
        );
        setRenameValue(currentTitle ?? "");
        return;
      }
      patchSession(sessionId, { title: next });
      setRenamingId(null);
      setRenameValue("");
      setMenuOpenId(null);
      notifySageSessionsChanged();
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
        showErrorToast(
          (data as { message?: string }).message ?? "Could not rewrite message."
        );
        return;
      }
      setDraftAssistantRewritten(
        (data as { rewritten?: string }).rewritten ?? text
      );
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

  function renderArchiveButton(
    s: SageSessionRow,
    opts?: { alwaysVisible?: boolean }
  ) {
    const archived = !!s.archived;
    return (
      <button
        type="button"
        title={archived ? "Unarchive" : "Archive"}
        aria-label={archived ? "Unarchive chat" : "Archive chat"}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void handleArchive(s.id, !archived);
          setMenuOpenId(null);
        }}
        className={cn(
          "inline-flex h-7 w-7 items-center justify-center rounded-md text-[#B0A899] transition-colors hover:bg-[#E8E4DC] hover:text-[#6A7A6E]",
          !opts?.alwaysVisible && "opacity-0 group-hover:opacity-100"
        )}
      >
        {archived ? (
          <ArchiveRestore className="h-3.5 w-3.5" />
        ) : (
          <Archive className="h-3.5 w-3.5" />
        )}
      </button>
    );
  }

  function renderSessionMenu(s: SageSessionRow) {
    return (
      <>
        <button
          type="button"
          data-sage-session-menu-button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setMenuOpenId(menuOpenId === s.id ? null : s.id);
            setDeleteConfirmId(null);
          }}
          className="p-0.5 rounded hover:bg-[#E8E4DC] text-[#B0A899] hover:text-[#6A7A6E]"
          aria-label="Session options"
          aria-expanded={menuOpenId === s.id}
        >
          <MoreVertical className="h-4 w-4" />
        </button>
        {menuOpenId === s.id && (
          <div
            data-sage-session-menu
            className="absolute right-0 top-9 z-20 min-w-[180px] rounded-lg border border-[#E8E4DC] bg-white py-1 shadow-lg"
          >
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-[#5B7A52] hover:bg-[#F2F5EF] text-left"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void handleArchive(s.id, !s.archived);
                setMenuOpenId(null);
              }}
            >
              {s.archived ? (
                <>
                  <ArchiveRestore className="h-4 w-4" /> Unarchive
                </>
              ) : (
                <>
                  <Archive className="h-4 w-4" /> Archive
                </>
              )}
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-[#3D3D3D] hover:bg-[#F2F5EF] text-left"
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
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-[#3D3D3D] hover:bg-[#F2F5EF] text-left"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void handleFlag(s.id, !!s.flagged);
                setMenuOpenId(null);
              }}
            >
              <Flag className="h-3.5 w-3.5" />{" "}
              {s.flagged ? "Unflag" : "Flag"}
            </button>
            <div className="border-t border-[#F2F5EF] mt-1 pt-1">
              {deleteConfirmId === s.id ? (
                <div className="px-3 py-2 text-[12px] text-[#6B6B6B] space-y-1">
                  <p>Delete this conversation?</p>
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
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-[#C3442D] hover:bg-[#FDF2F0] text-left"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDeleteConfirmId(s.id);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete conversation
                </button>
              )}
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4.5rem)] bg-[#FDFBF7]">
      {showListPanel && (
        <div className="flex h-full w-[400px] min-w-[360px] flex-col shrink-0 border-r border-[#E8E4DC] bg-white">
          <div className="border-b border-[#E8E4DC] px-3 py-3">
            <h2 className="font-heading text-sm font-semibold text-[#3D3D3D]">
              Chats
            </h2>
            <p className="mt-0.5 text-[11px] text-[#8A8A8A]">
              Your private space to think before you act.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleNewSession("private")}
                disabled={creatingSession}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#7C8B6E] bg-[#F2F5EF] px-3 py-1.5 text-xs font-medium text-[#5B7A52] hover:bg-[#E8EDE3] disabled:opacity-60"
              >
                <Plus className="h-3.5 w-3.5" />
                New chat
              </button>
              <button
                type="button"
                onClick={() => void handleNewSession("incident")}
                disabled={creatingSession}
                className="inline-flex items-center rounded-full border border-[#D4A843] bg-[#FFF9EC] px-3 py-1.5 text-xs font-medium text-[#3D3D3D] hover:bg-[#FDF3D8] disabled:opacity-60"
              >
                New incident report
              </button>
            </div>
          </div>

          <div className="flex flex-1 flex-col min-h-0">
            <div className="px-3 py-2 border-b border-[#E8E4DC]">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#8A8A8A]" />
                <input
                  type="search"
                  placeholder="Search chats"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={cn(
                    "w-full rounded-full border border-[#E8E4DC] bg-[#FDFBF7] pl-8 pr-3 py-1.5 text-xs text-[#3D3D3D] placeholder:text-[#8A8A8A]",
                    "focus:outline-none focus:ring-1 focus:ring-[#7C8B6E] focus:border-[#7C8B6E]"
                  )}
                  aria-label="Search chat titles"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 px-3 py-2 border-b border-[#E8E4DC]">
              <select
                value={listFilter}
                onChange={(e) => setListFilter(e.target.value as ListFilter)}
                className={cn(
                  "h-8 w-[140px] shrink-0 rounded-full border px-2 py-1 text-[11px] text-[#3D3D3D] bg-[#FDFBF7] border-[#E8E4DC] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E]",
                  listFilter !== "all" && "bg-[#F2F5EF] border-[#7C8B6E]"
                )}
                aria-label="Filter chats"
              >
                <option value="all">All chats</option>
                <option value="incident">Incident reports</option>
                <option value="flagged">Flagged</option>
                <option value="archived">Archived</option>
              </select>
            </div>

            <ScrollArea className="flex-1">
              <div className="px-2 py-2 space-y-0.5">
                {loadingSessions ? (
                  <p className="px-2 py-2 text-[11px] text-[#8A8A8A]">
                    Loading…
                  </p>
                ) : visibleSessions.length === 0 ? (
                  <p className="px-2 py-2 text-[11px] text-[#8A8A8A]">
                    {sessions.length === 0
                      ? listFilter === "archived"
                        ? "No archived chats."
                        : listFilter === "flagged"
                          ? "No flagged chats."
                          : "No chats yet. Start typing on the right, or create a new chat."
                      : "No chats match your search."}
                  </p>
                ) : (
                  visibleSessions.map((s) => (
                    <div
                      key={s.id}
                      className={cn(
                        "group relative w-full rounded-lg border transition-colors",
                        urlSessionId === s.id
                          ? "bg-[#F2F5EF] border-[#E8EDE3]"
                          : "border-transparent hover:bg-[#F9FAF8]"
                      )}
                    >
                      <div className="flex items-start gap-1 px-2.5 py-2">
                        <button
                          type="button"
                          onClick={() => router.push(sageChatHref(s.id))}
                          className="min-w-0 flex-1 rounded-lg text-left"
                        >
                          <p className="text-sm font-medium text-[#3D3D3D] truncate flex items-center gap-1.5">
                            {s.flagged && (
                              <span
                                className="shrink-0 text-[#5B7A52]"
                                title="Flagged"
                              >
                                <Flag className="h-3 w-3 fill-current" />
                              </span>
                            )}
                            {s.documented && (
                              <span
                                className="shrink-0 text-[#5B7A52]"
                                title="Documented interaction"
                              >
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
                                className="w-full rounded border border-[#E8E4DC] bg-[#FDFBF7] px-2 py-1 text-sm text-[#3D3D3D] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E]"
                              />
                            ) : (
                              <span className="min-w-0 truncate">
                                {truncateSageSessionTitle(s.title)}
                              </span>
                            )}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <span className="text-[10px] text-[#8A8A8A]">
                              {formatSessionDate(s.updated_at)}
                            </span>
                            <span className="inline-flex items-center rounded-full bg-[#F2F5EF] px-1.5 py-0.5 text-[9px] text-[#5B7A52]">
                              {s.session_type === "incident"
                                ? "Incident"
                                : "Private"}
                            </span>
                            {s.category ? (
                              <span className="inline-flex items-center rounded-full bg-[#E8E4DC] px-1.5 py-0.5 text-[9px] text-[#6B6B6B]">
                                {s.category}
                              </span>
                            ) : null}
                          </div>
                        </button>
                        <div className="relative shrink-0 flex items-center">
                          {renderArchiveButton(s)}
                          <span className="opacity-0 group-hover:opacity-100 transition-opacity">
                            {renderSessionMenu(s)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
            {sessions.filter((s) => s.session_type === "incident").length >=
              2 && (
              <div className="border-t border-[#E8E4DC] px-3 py-2">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-[11px] font-medium text-[#8A8A8A]">
                    Patterns
                  </span>
                  {activePatternSessionIds && (
                    <button
                      type="button"
                      className="text-[10px] text-[#5B7A52] hover:underline"
                      onClick={() => setActivePatternSessionIds(null)}
                    >
                      Clear
                    </button>
                  )}
                </div>
                {loadingPatterns ? (
                  <p className="text-[11px] text-[#8A8A8A]">
                    Looking for patterns…
                  </p>
                ) : patterns.length === 0 ? (
                  <p className="text-[11px] text-[#8A8A8A]">
                    Patterns will appear after you record a few incidents.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {patterns.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={cn(
                          "w-full rounded-lg px-2 py-1.5 text-left text-[11px] transition-colors",
                          activePatternSessionIds &&
                            activePatternSessionIds.length > 0 &&
                            activePatternSessionIds.every((id) =>
                              p.session_ids.includes(id)
                            )
                            ? "bg-[#F2F5EF] border border-[#E8E4DC]"
                            : "border border-transparent hover:bg-[#F9FAF8]"
                        )}
                        onClick={() => setActivePatternSessionIds(p.session_ids)}
                      >
                        <p className="font-medium text-[#3D3D3D] truncate">
                          {p.label}
                        </p>
                        <p className="text-[10px] text-[#6B6B6B] truncate">
                          {p.summary}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-1 flex-col min-w-0 bg-[#FDFBF7]">
        {urlSessionId && selectedSession && (
          <div className="border-b border-[#E8E4DC] bg-white px-4 py-3">
            <div className="flex items-center gap-2">
              <Link
                href="/sage"
                className="shrink-0 rounded-full p-1 text-[#8A8A8A] hover:bg-[#F2F5EF] hover:text-[#3D3D3D]"
                aria-label="Back to all chats"
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
              {renamingId === selectedSession.id ? (
                <input
                  ref={renameInputRef}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleRename(selectedSession.id, selectedSession.title);
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
                  className="min-w-0 flex-1 rounded border border-[#E8E4DC] bg-[#FDFBF7] px-2 py-1 text-sm text-[#3D3D3D] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E]"
                />
              ) : (
                <h2 className="font-heading text-base font-semibold text-foreground truncate">
                  {truncateSageSessionTitle(selectedSession.title)}
                </h2>
              )}
              <span className="inline-flex items-center rounded-full bg-[#F2F5EF] px-2 py-0.5 text-[10px] font-medium text-[#5B7A52]">
                {selectedSession.session_type === "incident"
                  ? "Incident"
                  : "Private"}
              </span>
              <div className="relative ml-auto flex items-center gap-0.5">
                {renderArchiveButton(selectedSession, { alwaysVisible: true })}
                {renderSessionMenu(selectedSession)}
              </div>
            </div>
          </div>
        )}
        <div className="flex-1 min-h-0 p-3 md:p-4 flex flex-col">
          {sessionMissing && urlSessionId ? (
            <div className="flex flex-1 items-center justify-center rounded-2xl border border-border bg-background-secondary/40 p-6">
              <div className="text-center space-y-2">
                <p className="text-sm text-foreground-secondary">
                  This chat could not be found.
                </p>
                <Link
                  href="/sage"
                  className="text-xs text-[#5B7A52] hover:underline"
                >
                  Back to all chats
                </Link>
              </div>
            </div>
          ) : urlSessionId && !selectedSession ? (
            <div className="flex flex-1 items-center justify-center rounded-2xl border border-border bg-background-secondary/40 p-6">
              <p className="text-sm text-foreground-secondary">Loading chat…</p>
            </div>
          ) : selectedSession?.session_type === "incident" && urlSessionId ? (
            <IncidentSessionView key={urlSessionId} sessionId={urlSessionId} />
          ) : showDraftAssistant ? (
            <div className="rounded-2xl border border-border bg-background-secondary/40 p-4 flex flex-col gap-4 h-full">
              <p className="text-sm text-foreground-secondary">
                Paste or type the message you want to send. Sage will suggest a
                calmer, child-focused version.
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
                  disabled={
                    draftAssistantLoading || !draftAssistantInput.trim()
                  }
                  onClick={() => void handleRewriteMessage()}
                >
                  {draftAssistantLoading ? "Rewriting…" : "Get calmer version"}
                </Button>
              ) : (
                <div className="rounded-card border border-[#E8E4DC] bg-[#FDFBF7] p-4 space-y-3">
                  <p className="text-xs font-medium text-[#8A8A8A]">
                    Suggested version
                  </p>
                  <p className="text-sm text-foreground whitespace-pre-wrap">
                    {draftAssistantRewritten}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className="rounded-full h-8 px-3 bg-[#5B7A52] text-white hover:bg-[#476242] text-xs"
                      onClick={() =>
                        openNewConversationWithBody(draftAssistantRewritten)
                      }
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
          ) : (
            <SageClient
              key={urlSessionId ?? "new"}
              sessionId={urlSessionId}
              sessionTitle={selectedSession?.title ?? undefined}
              onSessionTitleGenerated={() => {
                void loadSessions();
                notifySageSessionsChanged();
                if (urlSessionId) {
                  void fetchSageSession(urlSessionId).then((s) => {
                    if (s) setActiveSession(s);
                  });
                }
              }}
              onOpenDraftAssistant={() => setShowDraftAssistant(true)}
              initialDraft={initialDraftForSage}
              onConsumeInitialDraft={() => setInitialDraftForSage(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
