import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { MessagesView } from "@/components/messages/messages-view";

export default async function MessagesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Use service role to read membership so we don't rely on RLS/session in server context
  const admin = getServiceRoleClient();
  const { data: membership } = await admin
    .from("case_members")
    .select("case_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  const caseId = membership?.case_id ?? null;

  const { data: messages } = caseId
    ? await admin
        .from("messages")
        .select(
          `
          id,
          direction,
          original_content,
          ai_rewritten_content,
          category,
          sub_category,
          current_status,
          external_comm_id,
          created_at
        `
        )
        .eq("case_id", caseId)
        .order("created_at", { ascending: true })
    : { data: [] };

  const { data: flags } =
    messages && messages.length > 0
      ? await admin
          .from("message_flags")
          .select("message_id, flag_type, description")
          .in(
            "message_id",
            messages.map((m) => m.id)
          )
      : { data: [] };

  const flagsByMessage = (flags ?? []).reduce(
    (acc, f) => {
      if (!acc[f.message_id]) acc[f.message_id] = [];
      acc[f.message_id].push({
        flag_type: f.flag_type,
        description: f.description,
      });
      return acc;
    },
    {} as Record<string, Array<{ flag_type: string; description: string | null }>>
  );

  const messagesWithFlags = (messages ?? []).map((m) => ({
    ...m,
    flags: flagsByMessage[m.id] ?? [],
  }));

  return (
    <div className="flex flex-col h-full">
      <header className="border-b border-border bg-background px-4 py-4">
        <h1 className="font-heading text-xl font-semibold text-foreground">
          Messages
        </h1>
        <p className="text-sm text-foreground-secondary mt-0.5">
          AI-mediated communication. What you send is rewritten to be calm and
          child-focused.
        </p>
      </header>
      {caseId ? (
        <MessagesView messages={messagesWithFlags} caseId={caseId} />
      ) : (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center max-w-md">
            <p className="text-foreground-secondary mb-2">
              Create or join a case to start messaging.
            </p>
            <p className="text-sm text-foreground-secondary">
              Go to Settings to create a case or invite your co-parent.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
