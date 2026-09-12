import { redirect } from "next/navigation";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { SageInbox } from "@/components/sage/sage-inbox";

export default async function SageInboxPage() {
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

  const caseId = (membership?.case_id as string | undefined) ?? "";

  const { data: childrenData } = caseId
    ? await admin
        .from("children")
        .select("id, first_name")
        .eq("case_id", caseId)
        .order("first_name")
    : { data: [] as { id: string; first_name: string }[] };

  const children = (childrenData ?? []).map((c) => ({
    id: c.id as string,
    first_name: c.first_name as string,
  }));

  return (
    <div className="px-3 pt-3 pb-1 md:px-4 md:pt-4 md:pb-2">
      <div className="mb-4">
        <h1 className="font-heading text-xl md:text-2xl font-semibold text-foreground mb-1">
          Sage Inbox
        </h1>
        <p className="text-xs md:text-sm text-foreground-secondary leading-snug">
          What&apos;s come in and how Sage read it.
        </p>
      </div>
      <SageInbox caseId={caseId} children={children} />
    </div>
  );
}
