export type SageSessionRow = {
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
  session_type?: "private" | "incident";
};

export const SAGE_SESSIONS_CHANGED_EVENT = "sage-sessions-changed";

export function notifySageSessionsChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SAGE_SESSIONS_CHANGED_EVENT));
}

export function truncateSageSessionTitle(title: string | null, max = 40): string {
  if (!title || !title.trim()) return "New chat";
  return title.length <= max ? title : title.slice(0, max).trim() + "…";
}

export function sageChatHref(sessionId: string) {
  return `/sage/${sessionId}`;
}

export function isSageChatsPath(pathname: string | null) {
  if (!pathname) return false;
  return pathname === "/sage" || pathname.startsWith("/sage/");
}

export function isSageInboxPath(pathname: string | null) {
  if (!pathname) return false;
  return pathname === "/sage-inbox" || pathname.startsWith("/sage-inbox/");
}

export async function createSageSession(
  sessionType: "private" | "incident" = "private"
): Promise<SageSessionRow> {
  const res = await fetch("/api/sage/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_type: sessionType }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (data as { message?: string }).message ?? "Could not create session."
    );
  }
  const session = (data as { session?: SageSessionRow }).session;
  if (!session) {
    throw new Error("Could not create session.");
  }
  notifySageSessionsChanged();
  return session;
}

export async function fetchSageSessions(
  filter: "all" | "incident" | "flagged" | "archived" = "all"
): Promise<SageSessionRow[]> {
  const res = await fetch(
    `/api/sage/sessions?filter=${encodeURIComponent(filter)}`
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (data as { message?: string }).message ?? "Could not load sessions."
    );
  }
  return (data as { sessions?: SageSessionRow[] }).sessions ?? [];
}

export async function fetchSageSession(
  id: string
): Promise<SageSessionRow | null> {
  const res = await fetch(`/api/sage/sessions/${encodeURIComponent(id)}`);
  const data = await res.json().catch(() => ({}));
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(
      (data as { message?: string }).message ?? "Could not load session."
    );
  }
  return (data as { session?: SageSessionRow }).session ?? null;
}
