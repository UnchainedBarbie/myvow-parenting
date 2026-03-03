"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { showErrorToast, showSuccessToast } from "@/components/ui/toaster";

type InboxMessage = {
  id: string;
  source: string;
  from_email: string | null;
  subject: string | null;
  body_text: string | null;
  received_at: string;
  parse_status: string;
  parse_error: string | null;
  parse_confidence: number | null;
  parsed_title: string | null;
  parsed_date: string | null;
  parsed_notes: string | null;
  parsed_category: string | null;
  parsed_visibility: string | null;
  created_event_id: string | null;
  created_at: string;
};

const CATEGORIES = ["medical", "school", "therapy", "extracurricular", "custody_exchange", "other"];

export function CalendarInbox({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [discardingId, setDiscardingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editEventType, setEditEventType] = useState("other");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch("/api/calendar/inbox")
      .then((r) => r.json())
      .then((data) => {
        setMessages(data.messages ?? []);
        setSelectedId(null);
      })
      .finally(() => setLoading(false));
  }, [open]);

  function selectMessage(m: InboxMessage) {
    setSelectedId(m.id);
    setEditTitle(m.parsed_title ?? m.subject ?? "");
    setEditDate(m.parsed_date ? String(m.parsed_date).slice(0, 10) : new Date().toISOString().slice(0, 10));
    setEditEventType(m.parsed_category ?? "other");
  }

  async function handleCreateEvent(messageId: string) {
    setCreatingId(messageId);
    try {
      const res = await fetch(`/api/calendar/inbox/${messageId}/create-event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editTitle,
          date: editDate,
          event_type: editEventType,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, parse_status: "parsed", created_event_id: data.event_id } : m)));
      setSelectedId(null);
      router.refresh();
    } catch (e) {
      showErrorToast(e instanceof Error ? e.message : "Failed");
    } finally {
      setCreatingId(null);
    }
  }

  async function handleDiscard(messageId: string) {
    setDiscardingId(messageId);
    try {
      const res = await fetch(`/api/calendar/inbox/${messageId}/discard`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, parse_status: "failed" } : m)));
      setSelectedId(null);
    } catch (e) {
      showErrorToast(e instanceof Error ? e.message : "Failed");
    } finally {
      setDiscardingId(null);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-background border border-border rounded-card shadow-card max-h-[85vh] w-full max-w-lg flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="font-heading text-lg font-semibold">Calendar Inbox</h2>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-muted" aria-label="Close">×</button>
        </div>
        <div className="p-4 overflow-y-auto flex-1">
          {loading ? (
            <p className="text-sm text-foreground-secondary">Loading…</p>
          ) : messages.length === 0 ? (
            <p className="text-sm text-foreground-secondary">No inbox messages.</p>
          ) : (
            <ul className="space-y-2">
              {messages.map((m) => (
                <li key={m.id} className={cn("border border-border rounded-card p-3", selectedId === m.id && "ring-2 ring-primary")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{m.parsed_title ?? m.subject ?? "No subject"}</p>
                      <p className="text-xs text-foreground-secondary">{m.from_email} · {new Date(m.received_at).toLocaleString()}</p>
                      <span className={cn("text-[11px] px-1.5 py-0.5 rounded", m.parse_status === "needs_review" && "bg-amber-100 text-amber-800", m.parse_status === "parsed" && "bg-emerald-100 text-emerald-800", m.parse_status === "failed" && "bg-gray-100 text-gray-600")}>{m.parse_status}</span>
                      {m.created_event_id && (
                        <a href={`/calendar?event=${m.created_event_id}`} className="text-xs text-primary ml-1">View event</a>
                      )}
                    </div>
                    {m.parse_status === "needs_review" && !m.created_event_id && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => selectMessage(m)} className="text-xs">Edit</Button>
                        <Button size="sm" onClick={() => handleCreateEvent(m.id)} disabled={creatingId === m.id} className="text-xs">{creatingId === m.id ? "Creating…" : "Create event"}</Button>
                        <Button size="sm" variant="outline" onClick={() => handleDiscard(m.id)} disabled={discardingId === m.id} className="text-xs">{discardingId === m.id ? "…" : "Discard"}</Button>
                      </div>
                    )}
                  </div>
                  {selectedId === m.id && m.parse_status === "needs_review" && (
                    <div className="mt-3 pt-3 border-t border-border space-y-2">
                      <div>
                        <Label className="text-xs">Title</Label>
                        <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="h-8 text-sm" />
                      </div>
                      <div>
                        <Label className="text-xs">Date</Label>
                        <Input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} className="h-8 text-sm" />
                      </div>
                      <div>
                        <Label className="text-xs">Category</Label>
                        <select value={editEventType} onChange={(e) => setEditEventType(e.target.value)} className="h-8 w-full rounded-card border border-border bg-background px-2 text-xs">
                          {CATEGORIES.map((c) => (
                            <option key={c} value={c}>{c.replace("_", " ")}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
