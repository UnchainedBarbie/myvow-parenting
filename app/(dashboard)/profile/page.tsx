import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

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
  let parentingPlan: Record<string, unknown> | null = null;
  let holidaySchedules: Record<string, unknown>[] = [];

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
      const planResult = await admin
        .from("parenting_plans")
        .select("*")
        .eq("case_id", caseId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      parentingPlan = planResult.data as Record<string, unknown> | null;
    } catch {
      parentingPlan = null;
    }

    try {
      const holidayResult = await admin
        .from("holiday_schedules")
        .select("*")
        .eq("case_id", caseId)
        .order("holiday_name");
      holidaySchedules = (holidayResult.data ?? []) as Record<string, unknown>[];
    } catch {
      holidaySchedules = [];
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

  function formatDate(value: string | null): string {
    if (!value) return "—";
    try {
      return new Date(value).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return "—";
    }
  }

  return (
    <div className="px-3 pt-3 pb-1 md:px-4 md:pt-4 md:pb-2">
      <h1 className="font-heading text-xl md:text-2xl font-semibold text-foreground mb-1">
        Profile
      </h1>
      <p className="text-xs md:text-sm text-foreground-secondary mb-4">
        Your family, case details, and parenting plan.
      </p>

      <div className="space-y-6">
        <Card className="shadow-card border-border rounded-card">
          <CardHeader className="pb-2 px-4 pt-4">
            <CardTitle className="font-heading text-lg text-foreground">Your Info</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            <div>
              <label className="text-xs font-medium text-foreground-secondary">Name</label>
              <p className="text-sm text-foreground mt-0.5">{profile?.full_name ?? "—"}</p>
            </div>
            <div>
              <label className="text-xs font-medium text-foreground-secondary">Email</label>
              <p className="text-sm text-foreground mt-0.5">{profile?.email ?? user.email ?? "—"}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-card border-border rounded-card">
          <CardHeader className="pb-2 px-4 pt-4 flex flex-row items-center justify-between">
            <CardTitle className="font-heading text-lg text-foreground">Children</CardTitle>
            <Button size="sm" className="rounded-full h-8 text-xs bg-[#7B9E87] hover:bg-[#6A8A78] text-white" disabled>
              Add Child
            </Button>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {children.length === 0 ? (
              <p className="text-sm text-foreground-secondary">No children added yet.</p>
            ) : (
              <ul className="space-y-2">
                {children.map((c) => (
                  <li key={c.id} className="flex items-center justify-between text-sm">
                    <span className="font-medium text-foreground">{c.first_name}</span>
                    <span className="text-foreground-secondary">{formatDate(c.date_of_birth)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-card border-border rounded-card">
          <CardHeader className="pb-2 px-4 pt-4">
            <CardTitle className="font-heading text-lg text-foreground">Case Details</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            <div>
              <label className="text-xs font-medium text-foreground-secondary">Case number</label>
              <p className="text-sm text-foreground mt-0.5">—</p>
            </div>
            <div>
              <label className="text-xs font-medium text-foreground-secondary">Jurisdiction</label>
              <p className="text-sm text-foreground mt-0.5">—</p>
            </div>
            <div>
              <label className="text-xs font-medium text-foreground-secondary">Custody split</label>
              <p className="text-sm text-foreground mt-0.5">{custodySplit}% / {100 - custodySplit}%</p>
            </div>
            <div>
              <label className="text-xs font-medium text-foreground-secondary">Co-parent status</label>
              <p className="text-sm text-foreground mt-0.5">—</p>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-card border-border rounded-card">
          <CardHeader className="pb-2 px-4 pt-4">
            <CardTitle className="font-heading text-lg text-foreground">Parenting Plan</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            <div>
              <label className="text-xs font-medium text-foreground-secondary">Court order</label>
              <p className="text-sm text-foreground mt-0.5">Upload court order (placeholder)</p>
            </div>
            <div>
              <label className="text-xs font-medium text-foreground-secondary">Effective date</label>
              <p className="text-sm text-foreground mt-0.5">
                {parentingPlan?.effective_date ? formatDate(String(parentingPlan.effective_date)) : "—"}
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-foreground-secondary">Custody type</label>
              <p className="text-sm text-foreground mt-0.5">
                {(parentingPlan?.custody_type as string) ?? "—"}
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-foreground-secondary">Schedule description</label>
              <p className="text-sm text-foreground mt-0.5">
                {(parentingPlan?.schedule_description as string) ?? "—"}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-card border-border rounded-card">
          <CardHeader className="pb-2 px-4 pt-4">
            <CardTitle className="font-heading text-lg text-foreground">Holiday Schedule</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {holidaySchedules.length === 0 ? (
              <p className="text-sm text-foreground-secondary">No holiday schedule added yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-card border border-border">
                <table className="min-w-full text-left text-xs">
                  <thead>
                    <tr className="bg-[#E7EFE8]/80 text-foreground-secondary">
                      <th className="px-3 py-2 font-medium">Holiday</th>
                      <th className="px-3 py-2 font-medium">Rotation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {holidaySchedules.map((row, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="px-3 py-1.5 text-foreground">
                          {(row as { holiday_name?: string }).holiday_name ?? "—"}
                        </td>
                        <td className="px-3 py-1.5 text-foreground-secondary">
                          {(row as { rotation?: string }).rotation ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
