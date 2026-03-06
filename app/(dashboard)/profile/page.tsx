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
    .select("full_name, email, profile_image")
    .eq("id", user.id)
    .single();

  let children: { id: string; first_name: string; date_of_birth: string | null; member_status: "not_invited" | "invited" | "active"; invited_email: string | null; invited_phone: string | null; case_id?: string | null; profile_image?: string | null; pin_set_at?: string | null; kid_sage_tone?: string | null }[] = [];
  let courtOrders: CourtOrderRow[] = [];
  let coparent: { id: string | null; name: string; email: string | null; status: "not_invited" | "invited" | "connected" } | null = null;

  if (caseId) {
    const membersResult = await admin
      .from("case_members")
      .select("id, user_id, display_name, external_email, invitation_status")
      .eq("case_id", caseId);
    const members = (membersResult.data ?? []) as { id: string; user_id: string | null; display_name: string | null; external_email: string | null; invitation_status: string | null }[];
    const otherMembers = members.filter((m) => m.user_id !== user.id);
    const invitedRow = otherMembers.find((m) => m.user_id == null);
    const connectedRow = otherMembers.find((m) => m.user_id != null);
    if (connectedRow?.user_id) {
      const userRow = await admin.from("users").select("full_name").eq("id", connectedRow.user_id).single();
      const fullName = (userRow.data as { full_name?: string | null } | null)?.full_name ?? connectedRow.display_name ?? "Co-Parent";
      coparent = { id: connectedRow.id, name: fullName, email: null, status: "connected" };
    } else if (invitedRow) {
      const name = invitedRow.display_name ?? invitedRow.external_email ?? "Co-Parent";
      coparent = { id: invitedRow.id, name, email: invitedRow.external_email, status: "invited" };
    } else {
      coparent = { id: null, name: "", email: null, status: "not_invited" };
    }

    // All children with deleted_at IS NULL; do not filter by member_status — all appear in Family table
    const childrenResult = await admin
      .from("children")
      .select(
        "id, first_name, date_of_birth, member_status, invited_email, invited_phone, case_id, profile_image, pin_set_at, kid_sage_tone"
      )
      .eq("case_id", caseId)
      .is("deleted_at", null)
      .order("first_name");

    console.log("[profile] children query", {
      caseId,
      dataCount: childrenResult.data?.length ?? 0,
      sample: (childrenResult.data ?? []).slice(0, 3),
      error: childrenResult.error ?? null,
    });

    const rawChildren = (childrenResult.data ?? []) as { id: string; first_name: string; date_of_birth: string | null; member_status?: string | null; invited_email?: string | null; invited_phone?: string | null; case_id?: string | null; profile_image?: string | null; pin_set_at?: string | null; kid_sage_tone?: string | null }[];
    children = rawChildren.map((c) => ({
      id: c.id,
      first_name: c.first_name,
      date_of_birth: c.date_of_birth,
      member_status: (c.member_status === "invited" || c.member_status === "active" ? c.member_status : "not_invited") as "not_invited" | "invited" | "active",
      invited_email: c.invited_email ?? null,
      invited_phone: c.invited_phone ?? null,
      case_id: c.case_id ?? null,
      profile_image: c.profile_image ?? null,
      pin_set_at: c.pin_set_at ?? null,
      kid_sage_tone: c.kid_sage_tone ?? null,
    }));

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

  const accountNumber = caseId
    ? `MV-${caseId.replace(/-/g, "").slice(0, 4).toUpperCase()}-${caseId.replace(/-/g, "").slice(4, 8).toUpperCase()}`
    : null;

  return (
    <div className="px-3 pt-3 pb-1 md:px-4 md:pt-4 md:pb-2">
      <h1 className="font-heading text-xl md:text-2xl font-semibold text-foreground mb-1">
        Profile
      </h1>
      <ProfileContent
        profile={profile}
        userEmail={user.email ?? null}
        userId={user.id}
        children={children}
        courtOrders={courtOrders}
        accountNumber={accountNumber}
        coparent={caseId ? coparent : null}
      />
    </div>
  );
}
