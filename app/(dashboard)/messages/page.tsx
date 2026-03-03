import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { MessagesSplitView } from "@/components/messages/messages-split-view";

export default async function MessagesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: userProfile } = await supabase
    .from("users")
    .select("full_name, profile_image")
    .eq("id", user.id)
    .single();

  const displayName =
    (userProfile as { full_name?: string | null } | null)?.full_name ??
    user.email ??
    "";
  const currentUserInitial = displayName
    ? displayName.trim().charAt(0).toUpperCase()
    : "M";
  const currentUserAvatarUrl =
    (userProfile as { profile_image?: string | null } | null)?.profile_image ??
    null;

  // Use service role to read membership so we don't rely on RLS/session in server context
  const admin = getServiceRoleClient();
  const { data: membership } = await admin
    .from("case_members")
    .select("case_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  const caseId = membership?.case_id ?? null;

  const { data: children } = caseId
    ? await admin
        .from("children")
        .select("id, first_name")
        .eq("case_id", caseId)
        .is("deleted_at", null)
        .order("first_name")
    : { data: [] };

  let coparentName: string | null = null;
  if (caseId) {
    const { data: membersResult } = await admin
      .from("case_members")
      .select("id, user_id, display_name, external_email")
      .eq("case_id", caseId);
    const members =
      (membersResult ?? []) as {
        id: string;
        user_id: string | null;
        display_name: string | null;
        external_email: string | null;
      }[];
    const otherMembers = members.filter((m) => m.user_id !== user.id);
    const connectedRow = otherMembers.find((m) => m.user_id != null);
    const invitedRow = otherMembers.find((m) => m.user_id == null);
    if (connectedRow?.user_id) {
      const { data: userRow } = await admin
        .from("users")
        .select("full_name")
        .eq("id", connectedRow.user_id)
        .maybeSingle();
      coparentName =
        (userRow as { full_name?: string | null } | null)?.full_name ??
        connectedRow.display_name ??
        "Co-parent";
    } else if (invitedRow) {
      coparentName =
        invitedRow.display_name ?? invitedRow.external_email ?? "Co-parent";
    }
  }

  if (!caseId) {
    return (
      <div className="px-3 pt-3 pb-1 md:px-4 md:pt-4 md:pb-2">
        <div className="rounded-card border border-border bg-background-secondary p-8 text-center">
          <p className="text-foreground-secondary mb-2">
            Create or join a case to start messaging.
          </p>
          <p className="text-sm text-foreground-secondary">
            Go to Settings to create a case or invite your co-parent.
          </p>
        </div>
      </div>
    );
  }

  return (
    <MessagesSplitView
      caseId={caseId}
      children={(children ?? []) as { id: string; first_name: string }[]}
      coparentName={coparentName}
      currentUserInitial={currentUserInitial}
      currentUserAvatarUrl={currentUserAvatarUrl}
    />
  );
}
