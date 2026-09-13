"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Inbox,
  MessageSquare,
  Receipt,
  FileText,
  Calendar,
  FileBarChart,
  LogOut,
  HelpCircle,
  User,
  Settings,
  Feather,
  MessageCircle,
  Plus,
  Flag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SAGE_SESSIONS_CHANGED_EVENT,
  createSageSession,
  deleteSageSession,
  fetchSageSessions,
  isSageChatsPath,
  isSageInboxPath,
  patchSageSession,
  sageChatHref,
  truncateSageSessionTitle,
  type SageSessionRow,
} from "@/lib/sage-sessions-client";
import { SageSessionOverflowMenu } from "@/components/sage/sage-session-overflow-menu";
import { showErrorToast } from "@/components/ui/toaster";

const SIDEBAR_CHAT_LIMIT = 10;

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/sage-inbox", label: "Sage Inbox", icon: Inbox },
  { href: "/my-vow", label: "My Vow", icon: Feather },
  { href: "/messages", label: "Messages", icon: MessageSquare },
  { href: "/expenses", label: "Expenses", icon: Receipt },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/calendar", label: "Calendar", icon: Calendar },
  { href: "/reports", label: "Reports", icon: FileBarChart },
];

function isNavActive(href: string, pathname: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  if (href === "/sage-inbox") return isSageInboxPath(pathname);
  return pathname === href || pathname.startsWith(`${href}/`);
}

type DashboardSidebarProps = {
  displayName?: string;
  initial?: string;
  avatarUrl?: string | null;
};

export function DashboardSidebar({
  displayName = "",
  initial = "M",
  avatarUrl = null,
}: DashboardSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [sessions, setSessions] = useState<SageSessionRow[]>([]);
  const [creating, setCreating] = useState<"private" | "incident" | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      const list = await fetchSageSessions("all");
      setSessions(list);
    } catch {
      // Sidebar list is best-effort; the Chats page still loads the full set.
    }
  }, []);

  useEffect(() => {
    void loadSessions();
    function onChanged() {
      void loadSessions();
    }
    window.addEventListener(SAGE_SESSIONS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(SAGE_SESSIONS_CHANGED_EVENT, onChanged);
  }, [loadSessions]);

  useEffect(() => {
    if (isSageChatsPath(pathname)) {
      void loadSessions();
    }
  }, [pathname, loadSessions]);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  async function handleCreate(sessionType: "private" | "incident") {
    if (creating) return;
    setCreating(sessionType);
    try {
      const session = await createSageSession(sessionType);
      router.push(sageChatHref(session.id));
    } catch (e) {
      showErrorToast(
        e instanceof Error ? e.message : "Could not create session."
      );
    } finally {
      setCreating(null);
    }
  }

  async function handleArchive(session: SageSessionRow) {
    const archived = !session.archived;
    try {
      await patchSageSession(session.id, { archived });
      setSessions((prev) =>
        prev
          .map((s) => (s.id === session.id ? { ...s, archived } : s))
          .filter((s) => !s.archived)
      );
      if (archived && pathname === sageChatHref(session.id)) {
        router.push("/sage");
      }
    } catch (e) {
      showErrorToast(
        e instanceof Error ? e.message : "Could not update session."
      );
    }
  }

  async function handleFlag(session: SageSessionRow) {
    const flagged = !session.flagged;
    try {
      await patchSageSession(session.id, { flagged });
      setSessions((prev) =>
        prev.map((s) => (s.id === session.id ? { ...s, flagged } : s))
      );
    } catch (e) {
      showErrorToast(
        e instanceof Error ? e.message : "Could not update session."
      );
    }
  }

  async function handleRename(session: SageSessionRow) {
    const next = renameValue.trim();
    if (!next) {
      setRenamingId(null);
      setRenameValue("");
      return;
    }
    try {
      await patchSageSession(session.id, { title: next });
      setSessions((prev) =>
        prev.map((s) => (s.id === session.id ? { ...s, title: next } : s))
      );
      setRenamingId(null);
      setRenameValue("");
    } catch (e) {
      showErrorToast(
        e instanceof Error ? e.message : "Could not rename session."
      );
      setRenameValue(session.title ?? "");
    }
  }

  async function handleDelete(session: SageSessionRow) {
    try {
      await deleteSageSession(session.id);
      setSessions((prev) => prev.filter((s) => s.id !== session.id));
      setMenuOpenId(null);
      if (pathname === sageChatHref(session.id)) {
        router.push("/sage");
      }
    } catch (e) {
      showErrorToast(
        e instanceof Error ? e.message : "Could not delete conversation."
      );
    }
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  const label = displayName.trim() || "Account";
  const recentSessions = sessions.slice(0, SIDEBAR_CHAT_LIMIT);
  const hasMoreSessions = sessions.length > SIDEBAR_CHAT_LIMIT;
  const chatsActive = isSageChatsPath(pathname);

  return (
    <aside className="hidden w-64 flex-col border-r border-border bg-background md:flex">
      <div className="flex min-h-[4.5rem] items-center border-b border-border bg-background px-4 py-3">
        <Link href="/dashboard" className="flex items-center focus:outline-none">
          <div style={{ isolation: "isolate" }}>
            <Image
              src="/Horiztonal%20logo%20translucent.png"
              alt="MyVow"
              width={160}
              height={48}
              className="h-auto w-[160px] object-contain object-left"
              style={{ mixBlendMode: "multiply" }}
            />
          </div>
        </Link>
      </div>
      <nav className="flex-1 min-h-0 space-y-1 overflow-y-auto p-3">
        {navItems.map(({ href, label: navLabel, icon: Icon }) => {
          const isActive = isNavActive(href, pathname);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-card px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary-light text-primary-dark"
                  : "text-foreground-secondary hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon className="h-5 w-5 shrink-0" />
              {navLabel}
            </Link>
          );
        })}

        <div className="pt-1">
          <Link
            href="/sage"
            className={cn(
              "flex items-center gap-3 rounded-card px-3 py-2 text-sm font-medium transition-colors",
              chatsActive
                ? "bg-primary-light text-primary-dark"
                : "text-foreground-secondary hover:bg-muted hover:text-foreground"
            )}
          >
            <MessageCircle className="h-5 w-5 shrink-0" />
            Chats
          </Link>
          <div className="mt-1 space-y-0.5 pl-2">
            <button
              type="button"
              onClick={() => void handleCreate("private")}
              disabled={creating !== null}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-xs font-medium text-[#5B7A52] hover:bg-[#F2F5EF] disabled:opacity-60"
            >
              <Plus className="h-3.5 w-3.5 shrink-0" />
              {creating === "private" ? "Starting…" : "New chat"}
            </button>
            <button
              type="button"
              onClick={() => void handleCreate("incident")}
              disabled={creating !== null}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[11px] text-[#8A8A8A] hover:bg-[#FFF9EC] hover:text-[#3D3D3D] disabled:opacity-60"
            >
              {creating === "incident" ? "Starting…" : "New incident report"}
            </button>
            {recentSessions.map((s) => {
              const href = sageChatHref(s.id);
              const isActive = pathname === href;
              return (
                <div
                  key={s.id}
                  data-sage-session-card={s.id}
                  onMouseLeave={() => {
                    if (menuOpenId === s.id) setMenuOpenId(null);
                  }}
                  className={cn(
                    "group relative rounded-lg transition-colors",
                    isActive
                      ? "bg-[#E8EDE3] text-[#3D3D3D]"
                      : "text-foreground-secondary hover:bg-muted hover:text-foreground"
                  )}
                >
                  <div className="flex items-center gap-1 py-1.5 pl-3 pr-1">
                    {s.flagged ? (
                      <Flag className="h-3 w-3 shrink-0 fill-current text-[#B45309]" />
                    ) : null}
                    {renamingId === s.id ? (
                      <input
                        ref={renameInputRef}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void handleRename(s);
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
                        className="min-w-0 flex-1 rounded border border-[#E8E4DC] bg-[#FDFBF7] px-1.5 py-0.5 text-sm text-[#3D3D3D] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E]"
                      />
                    ) : (
                      <Link
                        href={href}
                        title={s.title ?? "New chat"}
                        className="min-w-0 flex-1 truncate text-left text-sm"
                      >
                        {truncateSageSessionTitle(s.title, 32)}
                      </Link>
                    )}
                    <SageSessionOverflowMenu
                      session={s}
                      open={menuOpenId === s.id}
                      onOpenChange={(open) => setMenuOpenId(open ? s.id : null)}
                      onArchive={() => void handleArchive(s)}
                      onFlag={() => void handleFlag(s)}
                      onRename={() => {
                        setRenamingId(s.id);
                        setRenameValue(s.title ?? "");
                      }}
                      onDelete={() => void handleDelete(s)}
                    />
                  </div>
                </div>
              );
            })}
            {hasMoreSessions ? (
              <Link
                href="/sage"
                className="block rounded-lg px-3 py-1.5 text-[11px] text-[#5B7A52] hover:bg-[#F2F5EF] hover:underline"
              >
                View all chats
              </Link>
            ) : null}
          </div>
        </div>
      </nav>
      <Separator className="mx-3" />
      <div className="space-y-1 p-3">
        <Link
          href="/support"
          className={cn(
            "flex items-center gap-3 rounded-card px-3 py-2 text-sm font-medium transition-colors",
            pathname.startsWith("/support")
              ? "bg-primary-light text-primary-dark"
              : "text-foreground-secondary hover:bg-muted hover:text-foreground"
          )}
        >
          <HelpCircle className="h-5 w-5 shrink-0" />
          Get support
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex w-full items-center gap-3 rounded-card px-3 py-2 text-sm font-medium transition-colors",
                "text-foreground-secondary hover:bg-[#F2F5EF] hover:text-foreground focus:outline-none focus:ring-0"
              )}
              aria-label="Open account menu"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#E8EDE3] text-[#5B7A52] text-sm font-semibold ring-1 ring-[#E8E4DC]">
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatarUrl}
                    alt={initial}
                    className="h-8 w-8 rounded-full object-cover"
                  />
                ) : (
                  initial
                )}
              </span>
              <span className="truncate text-left">{label}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side="top"
            className="min-w-[11rem] rounded-xl border border-[#E8E4DC] bg-white p-1 shadow-lg shadow-black/5"
          >
            <DropdownMenuItem asChild>
              <Link
                href="/profile"
                className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-[#3D3D3D] outline-none hover:bg-[#F2F5EF] focus:bg-[#F2F5EF] data-[highlighted]:bg-[#F2F5EF]"
              >
                <User className="h-4 w-4 shrink-0 text-[#7C8B6E]" />
                Profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link
                href="/settings"
                className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-[#3D3D3D] outline-none hover:bg-[#F2F5EF] focus:bg-[#F2F5EF] data-[highlighted]:bg-[#F2F5EF]"
              >
                <Settings className="h-4 w-4 shrink-0 text-[#7C8B6E]" />
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="my-1 bg-[#E8E4DC]" />
            <DropdownMenuItem
              onSelect={handleSignOut}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm text-[#3D3D3D] outline-none hover:bg-[#F2F5EF] focus:bg-[#F2F5EF] data-[highlighted]:bg-[#F2F5EF]"
            >
              <LogOut className="h-4 w-4 shrink-0 text-[#7C8B6E]" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}
