import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SupportForm } from "./support-form";

function formatAccountNumber(userId: string): string {
  const hex = userId.replace(/-/g, "").slice(0, 8);
  const part1 = hex.slice(0, 4).toUpperCase();
  const part2 = hex.slice(4, 8).toUpperCase();
  return `MV-${part1}-${part2}`;
}

export default async function SupportPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const email = user.email ?? "";
  const accountNumber = formatAccountNumber(user.id);

  return (
    <div className="flex flex-col items-center justify-start p-4 md:p-6">
      <div className="w-full max-w-2xl">
        <div className="mb-6">
          <h1 className="font-heading text-xl font-semibold text-foreground">
            Get support
          </h1>
          <p className="mt-1 text-sm text-foreground-secondary">
            We&apos;re here to help. Typical response time is one business day.
          </p>
        </div>
        <SupportForm
          email={email}
          accountNumber={accountNumber}
        />
      </div>
    </div>
  );
}
