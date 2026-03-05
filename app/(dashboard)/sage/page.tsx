import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SageSplitView } from "@/components/sage/SageSplitView";

export default async function SagePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="flex flex-col h-[calc(100vh-4.5rem)]">
      <SageSplitView />
    </div>
  );
}
