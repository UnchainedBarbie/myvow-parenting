import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function SagePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="px-3 pt-3 pb-6 md:px-4 md:pt-6 md:pb-10 flex justify-center">
      <div className="w-full max-w-2xl space-y-4">
        <header className="space-y-1">
          <h1 className="font-heading text-xl md:text-2xl font-semibold text-foreground">
            Sage
          </h1>
          <p className="text-xs md:text-sm text-foreground-secondary leading-snug">
            Sage is your private reflection space. Coming soon.
          </p>
        </header>
      </div>
    </div>
  );
}

