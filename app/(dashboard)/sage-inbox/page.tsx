import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SageInbox } from "@/components/sage/sage-inbox";

export default async function SageInboxPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

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
      <SageInbox />
    </div>
  );
}
