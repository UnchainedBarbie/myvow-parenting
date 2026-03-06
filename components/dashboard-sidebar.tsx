"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  MessageSquare,
  Receipt,
  FileText,
  Calendar,
  FileBarChart,
  LogOut,
  Leaf,
  HelpCircle,
  User,
  Settings,
  Feather,
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

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/my-vow", label: "My Vow", icon: Feather },
  { href: "/messages", label: "Messages", icon: MessageSquare },
  { href: "/expenses", label: "Expenses", icon: Receipt },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/calendar", label: "Calendar", icon: Calendar },
  { href: "/reports", label: "Reports", icon: FileBarChart },
];

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

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  const label = displayName.trim() || "Account";

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
      <nav className="flex-1 space-y-1 p-3">
        {navItems.map(({ href, label: navLabel, icon: Icon }) => {
          const isActive =
            pathname === href ||
            (href !== "/dashboard" && pathname.startsWith(href));
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
      </nav>
      <Separator className="mx-3" />
      <div className="space-y-1 p-3">
        <Link
          href="/sage"
          className={cn(
            "flex items-center gap-3 rounded-card px-3 py-2 text-sm font-medium transition-colors",
            pathname.startsWith("/sage")
              ? "bg-primary-light text-primary-dark"
              : "text-foreground-secondary hover:bg-muted hover:text-foreground"
          )}
        >
          <Leaf className="h-5 w-5 shrink-0" />
          Sage
        </Link>
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
