"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { showErrorToast } from "@/components/ui/toaster";
import { MessageSquare, Clock, PenLine, FileText } from "lucide-react";

export type SageMessage = {
  id: string;
  user_id: string;
  role: "user" | "sage";
  content: string;
  created_at: string;
};

const SAGE_PILL_CLASS =
  "rounded-full border border-[#7C8B6E] bg-transparent px-2.5 py-1 text-[11px] text-[#5B7A52] hover:bg-[#F2F5EF] transition-colors";

const SAGE_ACTION_PILL =
  "inline-flex items-center gap-1.5 rounded-full border border-[#7C8B6E] bg-transparent px-2.5 py-1.5 text-[11px] text-[#5B7A52] hover:bg-[#F2F5EF] transition-colors";

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
  const [pauseEndsAt, setPauseEndsAt] = useState<number | null>(null);
  const [writePrivatelyPlaceholder, setWritePrivatelyPlaceholder] = useState(false);
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
        const list = (data as { messages?: SageMessage[] }).messages ?? [];
        setMessages(list);
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
      const userMsg = (data as { user_message?: SageMessage }).user_message;
      const sageMsg = (data as { sage_message?: SageMessage }).sage_message;
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

  function startPause30() {
    const end = Date.now() + 30 * 60 * 1000;
    setPauseEndsAt(end);
  }

  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  const showActionButtons =
    !loading &&
    messages.length > 0 &&
    lastMessage?.role === "sage" &&
    !writePrivatelyPlaceholder;

  const pauseRemaining =
    pauseEndsAt != null && pauseEndsAt > Date.now()
      ? Math.max(0, Math.ceil((pauseEndsAt - Date.now()) / 1000))
      : null;

  useEffect(() => {
    if (pauseEndsAt == null) return;
    const id = setInterval(() => {
      if (Date.now() >= pauseEndsAt) setPauseEndsAt(null);
    }, 1000);
    return () => clearInterval(id);
  }, [pauseEndsAt]);

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
                  return (
                    <div
                      key={msg.id}
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
                  );
                })}
                {showActionButtons && (
                  <div className="flex flex-wrap gap-2 pt-2">
                    {pauseRemaining != null ? (
                      <div className="inline-flex items-center gap-2 rounded-full border border-[#7C8B6E] bg-[#F2F5EF] px-3 py-2 text-[12px] text-[#5B7A52]">
                        <Clock className="h-3.5 w-3.5" />
                        <span>
                          Pause:{" "}
                          {Math.floor(pauseRemaining / 60)}:
                          {String(pauseRemaining % 60).padStart(2, "0")}
                        </span>
                      </div>
                    ) : (
                      <>
                        {onOpenDraftAssistant && (
                          <button
                            type="button"
                            className={SAGE_ACTION_PILL}
                            onClick={onOpenDraftAssistant}
                          >
                            <MessageSquare className="h-3 w-3" />
                            Draft a message to co-parent
                          </button>
                        )}
                        <button
                          type="button"
                          className={SAGE_ACTION_PILL}
                          onClick={startPause30}
                        >
                          <Clock className="h-3 w-3" />
                          Take a 30-minute pause
                        </button>
                        <button
                          type="button"
                          className={SAGE_ACTION_PILL}
                          onClick={() => {
                            setWritePrivatelyPlaceholder(true);
                            textareaRef.current?.focus();
                          }}
                        >
                          <PenLine className="h-3 w-3" />
                          Write privately
                        </button>
                        <button
                          type="button"
                          className={SAGE_ACTION_PILL}
                          onClick={() => {
                            const d = new Date();
                            const subject = d.toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            });
                            router.push(
                              `/messages?new=1&subject=${encodeURIComponent(subject)}`
                            );
                          }}
                        >
                          <FileText className="h-3 w-3" />
                          Document this interaction
                        </button>
                      </>
                    )}
                  </div>
                )}
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
    </div>
  );
}
