"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type KidMe = {
  kid_id: string;
  name: string;
  avatar_url: string | null;
};

type KidSageSession = {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string | null;
};

type KidSageMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

function formatSessionDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function KidsSagePage() {
  const router = useRouter();
  const [me, setMe] = useState<KidMe | null>(null);
  const [sessions, setSessions] = useState<KidSageSession[]>([]);
  const [activeSession, setActiveSession] = useState<KidSageSession | null>(
    null
  );
  const [messages, setMessages] = useState<KidSageMessage[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadMe() {
      try {
        const res = await fetch("/api/kids/me");
        const data = (await res.json().catch(() => ({}))) as KidMe & {
          message?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          router.push("/kids-login");
          return;
        }
        setMe({
          kid_id: data.kid_id,
          name: data.name,
          avatar_url: data.avatar_url ?? null,
        });
      } catch {
        if (!cancelled) {
          setMe({ kid_id: "", name: "Friend", avatar_url: null });
        }
      }
    }
    async function loadSessions() {
      try {
        const res = await fetch("/api/kids/sage/sessions");
        const data = (await res.json().catch(() => ({}))) as {
          sessions?: KidSageSession[];
          message?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setError(data.message ?? "Could not load sessions.");
          return;
        }
        setSessions(data.sessions ?? []);
      } finally {
        if (!cancelled) setLoadingSessions(false);
      }
    }
    void loadMe();
    void loadSessions();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  async function refreshSessions() {
    setLoadingSessions(true);
    try {
      const res = await fetch("/api/kids/sage/sessions");
      const data = (await res.json().catch(() => ({}))) as {
        sessions?: KidSageSession[];
        message?: string;
      };
      if (!res.ok) {
        setError(data.message ?? "Could not load sessions.");
        return;
      }
      setSessions(data.sessions ?? []);
    } finally {
      setLoadingSessions(false);
    }
  }

  async function loadSession(session: KidSageSession) {
    setLoadingMessages(true);
    setError(null);
    try {
      const res = await fetch(`/api/kids/sage/sessions/${session.id}`);
      const data = (await res.json().catch(() => ({}))) as {
        session?: KidSageSession;
        messages?: { id: string; role: string; content: string; created_at: string }[];
        message?: string;
      };
      if (!res.ok) {
        setError(data.message ?? "Could not load session.");
        return;
      }
      setActiveSession(data.session ?? session);
      const msgs = (data.messages ?? []).map((m) => ({
        id: m.id,
        role: (m.role === "assistant" ? "assistant" : "user") as
          | "user"
          | "assistant",
        content: m.content,
        created_at: m.created_at,
      }));
      setMessages(msgs);
    } finally {
      setLoadingMessages(false);
    }
  }

  async function handleNewSession() {
    setError(null);
    try {
      const res = await fetch("/api/kids/sage/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json().catch(() => ({}))) as {
        session?: KidSageSession;
        message?: string;
      };
      if (!res.ok || !data.session) {
        setError(data.message ?? "Could not start a new session.");
        return;
      }
      await refreshSessions();
      setActiveSession(data.session);
      setMessages([]);
    } catch {
      setError("Could not start a new session.");
    }
  }

  async function handleSend() {
    if (!activeSession) {
      setError("Start a session first.");
      return;
    }
    const text = input.trim();
    if (!text || sending) return;

    setSending(true);
    setError(null);
    const nowIso = new Date().toISOString();
    const localId = `local-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: localId, role: "user", content: text, created_at: nowIso },
    ]);
    setInput("");

    try {
      const res = await fetch("/api/kids/sage/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: activeSession.id, message: text }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
      };
      if (!res.ok || !data.message) {
        setError(data.message ?? "Sage could not respond right now.");
        return;
      }
      const assistantIso = new Date().toISOString();
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: data.message ?? "",
          created_at: assistantIso,
        },
      ]);
    } catch {
      setError("Sage could not respond right now.");
    } finally {
      setSending(false);
    }
  }

  const displayName = me?.name ?? "Friend";

  return (
    <div className="flex w-full max-w-5xl flex-col gap-4 md:flex-row">
      <aside className="w-full max-w-xs space-y-3 md:w-64">
        <Card className="border border-[#E8E4DC] bg-white/80 shadow-sm rounded-2xl">
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[#E8E4DC]">
            <div>
              <p className="text-sm font-semibold text-[#3D3D3D]">My Space</p>
              <p className="text-[11px] text-[#6B6B6B]">
                Private check-ins with Sage.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              className="h-8 rounded-full text-xs bg-[#5B7A52] text-white hover:bg-[#476242]"
              onClick={() => void handleNewSession()}
            >
              + New
            </Button>
          </div>
          <div className="max-h-[360px] space-y-1 overflow-y-auto px-2 py-2">
            {loadingSessions ? (
              <p className="px-2 py-2 text-sm text-foreground-secondary">
                Loading…
              </p>
            ) : sessions.length === 0 ? (
              <p className="px-2 py-2 text-sm text-foreground-secondary">
                No sessions yet. Start one to talk with Sage.
              </p>
            ) : (
              sessions.map((s) => {
                const isActive = activeSession?.id === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={cn(
                      "w-full rounded-xl border px-3 py-2 text-left text-sm transition-colors",
                      isActive
                        ? "border-[#7B9E87] bg-[#F2F5EF] text-[#3D3D3D]"
                        : "border-[#E8E4DC] bg-[#FDFBF7] text-[#3D3D3D] hover:bg-[#F2F5EF]"
                    )}
                    onClick={() => void loadSession(s)}
                  >
                    <p className="truncate font-medium">
                      {s.title ?? "Sage session"}
                    </p>
                    <p className="text-[11px] text-[#8A8A8A]">
                      {formatSessionDate(s.updated_at ?? s.created_at)}
                    </p>
                  </button>
                );
              })
            )}
          </div>
        </Card>
      </aside>

      <section className="flex min-h-[420px] flex-1 flex-col space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Image
              src="/dove-translucent.png"
              alt="Sage"
              width={32}
              height={32}
              className="opacity-70"
            />
            <div>
              <p className="text-sm font-semibold text-[#3D3D3D]">
                Sage for kids
              </p>
              <p className="text-[11px] text-[#6B6B6B]">
                Your private place to talk.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-full text-xs"
            onClick={() => router.push("/kids-calendar")}
          >
            ← Back to Home
          </Button>
        </div>

        <Card className="flex flex-1 flex-col rounded-2xl border border-[#E8E4DC] bg-[#FDFBF7] shadow-sm">
          {!activeSession ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-8 text-center">
              <Image
                src="/dove-translucent.png"
                alt="Sage"
                width={72}
                height={72}
                className="opacity-60"
              />
              <div className="space-y-2">
                <p className="text-lg font-semibold text-[#3D3D3D]">
                  Hi {displayName}! This is your private space. 💚
                </p>
                <p className="text-sm text-[#6B6B6B]">
                  You can share your thoughts and feelings here. Sage will
                  always answer gently.
                </p>
              </div>
              <Button
                type="button"
                className="rounded-full bg-[#5B7A52] text-white hover:bg-[#476242] text-sm px-6"
                onClick={() => void handleNewSession()}
              >
                Start a new session
              </Button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-[#E8E4DC] px-4 py-2.5">
                <div>
                  <p className="text-sm font-semibold text-[#3D3D3D]">
                    {activeSession.title ?? "Sage session"}
                  </p>
                  <p className="text-[11px] text-[#8A8A8A]">
                    Tap the box below to talk with Sage.
                  </p>
                </div>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
                {loadingMessages ? (
                  <p className="text-sm text-foreground-secondary">
                    Loading messages…
                  </p>
                ) : messages.length === 0 ? (
                  <p className="text-sm text-foreground-secondary">
                    This session is empty. Say hi to Sage to begin.
                  </p>
                ) : (
                  messages.map((m) => {
                    const isUser = m.role === "user";
                    return (
                      <div
                        key={m.id}
                        className={cn(
                          "mb-1 flex w-full",
                          isUser ? "justify-end" : "justify-start"
                        )}
                      >
                        {!isUser && (
                          <div className="mr-2 mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-[#EEF2E9]">
                            <span className="text-xs">🕊️</span>
                          </div>
                        )}
                        <div
                          className={cn(
                            "max-w-[75%] rounded-2xl px-3 py-2 text-sm",
                            isUser
                              ? "bg-[#7B9E87] text-white rounded-br-sm"
                              : "bg-white text-[#3D3D3D] border border-[#E8E4DC] rounded-bl-sm"
                          )}
                        >
                          {m.content}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>
              <div className="border-t border-[#E8E4DC] px-4 py-3 space-y-2">
                {error && (
                  <p className="text-[11px] text-alert" role="alert">
                    {error}
                  </p>
                )}
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Tell Sage what's on your mind…"
                  rows={2}
                  className="min-h-[60px] resize-none rounded-2xl border-[#E8E4DC] bg-white text-sm"
                />
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-[#6B6B6B]">
                    This is just for you. Only you can see this. 🔒
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 rounded-full bg-[#5B7A52] text-white hover:bg-[#476242] text-xs px-4"
                    disabled={sending || !input.trim()}
                    onClick={() => void handleSend()}
                  >
                    {sending ? "Sending…" : "Send"}
                  </Button>
                </div>
              </div>
            </>
          )}
        </Card>
      </section>
    </div>
  );
}

