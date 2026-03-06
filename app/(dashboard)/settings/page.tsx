import { createClient } from "@/lib/supabase/server";
import { SettingsContent } from "@/components/settings/settings-content";
import { SubscriptionSection } from "@/components/settings/subscription-section";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("users").select("full_name, email, timezone").eq("id", user.id).single()
    : { data: null };

  return (
    <div className="p-6 md:p-8">
      <h1 className="font-heading text-2xl font-semibold text-foreground mb-2">
        Settings
      </h1>
      <SettingsContent profile={profile} />
      <div className="mt-8 space-y-3">
        <h2 className="font-heading text-xl font-semibold text-foreground">
          Subscription
        </h2>
        <SubscriptionSection />
      </div>
    </div>
  );
}
