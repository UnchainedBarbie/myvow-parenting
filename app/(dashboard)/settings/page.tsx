import Link from "next/link";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateCaseButton } from "@/components/create-case-button";
import { Button } from "@/components/ui/button";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("users").select("full_name, email, timezone").eq("id", user.id).single()
    : { data: null };

  // Use service role so case membership is found regardless of RLS/session in server context
  const admin = getServiceRoleClient();
  const { data: membership } = user
    ? await admin
        .from("case_members")
        .select("case_id")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle()
    : { data: null };

  const hasCase = !!membership?.case_id;

  return (
    <div className="p-6 md:p-8">
      <h1 className="font-heading text-2xl font-semibold text-foreground mb-2">
        Settings
      </h1>
      <p className="text-foreground-secondary mb-8">
        Account, case, messaging window, and subscription.
      </p>
      <div className="space-y-6">
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="font-heading text-lg">Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-foreground-secondary">
              {profile?.full_name && <span>Name: {profile.full_name}</span>}
              {profile?.email && (
                <span className="block">Email: {profile.email}</span>
              )}
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="font-heading text-lg">Case</CardTitle>
          </CardHeader>
          <CardContent>
            {hasCase ? (
              <>
                <p className="text-sm text-foreground-secondary mb-4">
                  You have an active case. Open Messages to communicate, or invite your co-parent below.
                </p>
                <Button asChild>
                  <Link href="/messages">Open Messages</Link>
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-foreground-secondary mb-4">
                  Create a case to start messaging. Then you can invite your co-parent by email or user.
                </p>
                <CreateCaseButton />
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
