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
  Users,
  Feather,
  Leaf,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { Separator } from "@/components/ui/separator";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/my-vow", label: "My Vow", icon: Feather },
  { href: "/messages", label: "Messages", icon: MessageSquare },
  { href: "/expenses", label: "Expenses", icon: Receipt },
  { href: "/calendar", label: "Calendar", icon: Calendar },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/documents", label: "Documents", icon: FileText },
];

export function DashboardSidebar() {
  const pathname = usePathname();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  return (
    <aside className="hidden w-64 flex-col border-r border-border bg-background md:flex">
      <div className="flex min-h-[4.5rem] items-center border-b border-border bg-background px-4 py-3">
        <Link href="/dashboard" className="flex items-center focus:outline-none">
          <Image
            src="/Horiztonal%20logo%20translucent.png"
            alt="MyVow"
            width={160}
            height={48}
            className="h-auto w-[160px] object-contain object-left"
          />
        </Link>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
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
              {label}
            </Link>
          );
        })}
      </nav>
      <Separator className="mx-3" />
      <div className="p-3 space-y-1">
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
        <Button
          variant="ghost"
          className="w-full justify-start gap-3 text-foreground-secondary"
          onClick={handleSignOut}
        >
          <LogOut className="h-5 w-5" />
          Sign out
        </Button>
      </div>
    </aside>
  );
}
