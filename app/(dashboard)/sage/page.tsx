import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SageClient } from "@/components/sage/SageClient";

export default async function SagePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="px-3 pt-3 pb-0 md:px-4 md:pt-4 md:pb-0 flex justify-center min-h-[calc(100vh-4.5rem)]">
      <div className="w-full max-w-2xl flex flex-col gap-4 h-[calc(100vh-5.5rem)]">
        <header className="space-y-1 text-center md:text-left">
          <h1 className="font-heading text-xl md:text-2xl font-semibold text-foreground">
            Sage
          </h1>
          <p className="text-xs md:text-sm text-foreground-secondary leading-snug">
            Your private space to think before you act.
          </p>
        </header>

        <div className="flex-1 flex">
          <SageClient />
        </div>
      </div>
    </div>
  );
}

