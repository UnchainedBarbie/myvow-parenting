import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { HeaderAvatar } from "@/components/header-avatar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("full_name, email, profile_image")
    .eq("id", user.id)
    .single();

  const displayName =
    (profile as { full_name?: string | null } | null)?.full_name ??
    user.email ??
    "";
  const initial = displayName
    ? displayName.trim().charAt(0).toUpperCase()
    : "M";
  const avatarUrl =
    (profile as { profile_image?: string | null } | null)?.profile_image ??
    null;

  return (
    <div className="flex min-h-screen bg-background">
      <DashboardSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center justify-end px-4 py-2 shrink-0">
          <HeaderAvatar initial={initial} avatarUrl={avatarUrl} />
        </header>
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
