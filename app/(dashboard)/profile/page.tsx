import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { presentCoparent } from "@/lib/cases/coparent-invitation";
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

  let appMode: string | null = null;
  let familyCode: string | null = null;
  if (caseId) {
    const { data: caseRow } = await admin
      .from("cases")
      .select("mode, app_mode, family_code")
      .eq("id", caseId)
      .single();
    const row = caseRow as { mode?: string | null; app_mode?: string | null; family_code?: string | null } | null;
    appMode = (row?.mode ?? row?.app_mode) ?? null;
    familyCode = row?.family_code ?? null;
  }

  const { data: profile } = await supabase
    .from("users")
    .select("full_name, email, profile_image")
    .eq("id", user.id)
    .single();

  let children: { id: string; first_name: string; date_of_birth: string | null; grade_level: string | null; member_status: "not_invited" | "invited" | "active"; invited_email: string | null; invited_phone: string | null; case_id?: string | null; profile_image?: string | null; pin_set_at?: string | null; kid_sage_tone?: string | null }[] = [];
  let courtOrders: CourtOrderRow[] = [];
  let coparent: {
    id: string | null;
    name: string;
    email: string | null;
    status: "not_invited" | "invited" | "connected";
    invitationSentAt: string | null;
    invitationError: string | null;
  } | null = null;

  if (caseId) {
    const withDelivery = await admin
      .from("case_members")
      .select("id, user_id, display_name, external_email, invitation_status, invitation_sent_at, invitation_last_error")
      .eq("case_id", caseId);
    const membersResult =
      withDelivery.error && /invitation_/i.test(withDelivery.error.message)
        ? await admin
            .from("case_members")
            .select("id, user_id, display_name, external_email, invitation_status")
            .eq("case_id", caseId)
        : withDelivery;
    const members = (membersResult.data ?? []) as {
      id: string;
      user_id: string | null;
      display_name: string | null;
      external_email: string | null;
      invitation_status: string | null;
      invitation_sent_at?: string | null;
      invitation_last_error?: string | null;
    }[];
    const otherIds = members.map((member) => member.user_id).filter((id): id is string => Boolean(id) && id !== user.id);
    const userRows = otherIds.length
      ? await admin.from("users").select("id, full_name, email").in("id", otherIds)
      : { data: [] };
    const addressRows = await admin
      .from("case_member_emails")
      .select("case_member_id, email, is_reply")
      .eq("case_id", caseId);
    coparent = presentCoparent({
      currentUserId: user.id,
      members: members.map((member) => ({
        id: member.id,
        userId: member.user_id,
        displayName: member.display_name,
        externalEmail: member.external_email,
        status: member.invitation_status,
        sentAt: member.invitation_sent_at ?? null,
        lastError: member.invitation_last_error ?? null,
      })),
      users: ((userRows.data ?? []) as { id: string; full_name: string | null; email: string | null }[]).map((row) => ({
        id: row.id,
        fullName: row.full_name,
        email: row.email,
      })),
      addresses: ((addressRows.data ?? []) as { case_member_id: string; email: string | null; is_reply: boolean | null }[]).map(
        (row) => ({
          caseMemberId: row.case_member_id,
          email: row.email ?? "",
          isReply: row.is_reply === true,
        })
      ),
    });

    // All children with deleted_at IS NULL; do not filter by member_status — all appear in Family table
    const childrenResult = await admin
      .from("children")
      .select(
        "id, first_name, date_of_birth, grade_level, member_status, invited_email, invited_phone, case_id, profile_image, pin_set_at, kid_sage_tone"
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

    const rawChildren = (childrenResult.data ?? []) as { id: string; first_name: string; date_of_birth: string | null; grade_level: string | null; member_status?: string | null; invited_email?: string | null; invited_phone?: string | null; case_id?: string | null; profile_image?: string | null; pin_set_at?: string | null; kid_sage_tone?: string | null }[];
    children = rawChildren.map((c) => ({
      id: c.id,
      first_name: c.first_name,
      date_of_birth: c.date_of_birth,
      grade_level: c.grade_level ?? null,
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
        caseId={caseId}
        appMode={appMode}
        familyCode={familyCode}
      />
    </div>
  );
}
