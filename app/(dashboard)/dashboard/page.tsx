import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("users").select("full_name").eq("id", user.id).single()
    : { data: null };

  return (
    <div className="p-6 md:p-8">
      <h1 className="font-heading text-2xl font-semibold text-foreground mb-2">
        Welcome back{profile?.full_name ? `, ${profile.full_name}` : ""}
      </h1>
      <p className="text-foreground-secondary mb-8">
        Here’s an overview of your co-parenting communication.
      </p>
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="font-heading text-lg">Messages</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-foreground-secondary mb-4">
              View and send AI-mediated messages with your co-parent.
            </p>
            <Button asChild>
              <Link href="/messages">Open Messages</Link>
            </Button>
          </CardContent>
        </Card>
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="font-heading text-lg">Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-foreground-secondary">
              Recent activity will appear here once you have a case and messages.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
