import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ProfileContent, type CourtOrderRow } from "@/components/profile/profile-content";

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = getServiceRoleClient();
  const { data: membership } = await admin
    .from("case_members")
    .select("case_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  const caseId = membership?.case_id ?? null;

  const { data: profile } = await supabase
    .from("users")
    .select("full_name, email")
    .eq("id", user.id)
    .single();

  let children: { id: string; first_name: string; date_of_birth: string | null }[] = [];
  let caseRow: { id: string; custody_split_percent?: number } | null = null;
  let courtOrders: CourtOrderRow[] = [];

  if (caseId) {
    const childrenResult = await admin
      .from("children")
      .select("id, first_name, date_of_birth")
      .eq("case_id", caseId)
      .is("deleted_at", null)
      .order("first_name");
    children = (childrenResult.data ?? []).map((c) => ({
      id: (c as { id: string }).id,
      first_name: (c as { first_name: string }).first_name,
      date_of_birth: (c as { date_of_birth: string | null }).date_of_birth,
    }));

    const caseResult = await admin
      .from("cases")
      .select("id, custody_split_percent")
      .eq("id", caseId)
      .single();
    caseRow = caseResult.data as { id: string; custody_split_percent?: number } | null;

    try {
      const ordersResult = await admin
        .from("parenting_plans")
        .select("*")
        .eq("case_id", caseId)
        .order("created_at", { ascending: false });
      courtOrders = (ordersResult.data ?? []) as CourtOrderRow[];
    } catch {
      courtOrders = [];
    }
  }

  const custodySplit = caseRow?.custody_split_percent != null ? Number(caseRow.custody_split_percent) : 50;

  if (!caseId) {
    return (
      <div className="px-3 pt-3 pb-1 md:px-4 md:pt-4 md:pb-2">
        <h1 className="font-heading text-xl md:text-2xl font-semibold text-foreground mb-1">
          Profile
        </h1>
        <p className="text-xs md:text-sm text-foreground-secondary mb-4">
          Your family, case details, and parenting plan.
        </p>
        <div className="rounded-card border border-border bg-background-secondary p-8 text-center">
          <p className="text-foreground-secondary">
            Create or join a case in Settings to view your profile and parenting plan.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-3 pt-3 pb-1 md:px-4 md:pt-4 md:pb-2">
      <h1 className="font-heading text-xl md:text-2xl font-semibold text-foreground mb-1">
        Profile
      </h1>
      <p className="text-xs md:text-sm text-foreground-secondary mb-4">
        Your family, case details, and parenting plan.
      </p>
      <ProfileContent
        profile={profile}
        userEmail={user.email ?? null}
        children={children}
        custodySplit={custodySplit}
        courtOrders={courtOrders}
      />
    </div>
  );
}
