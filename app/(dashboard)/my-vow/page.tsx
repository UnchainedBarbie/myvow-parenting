import { redirect } from "next/navigation";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { MyVowClient, type Vow } from "@/components/my-vow/my-vow-client";

export default async function MyVowPage() {
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

  const caseId = (membership?.case_id as string | undefined) ?? null;

  if (!caseId) {
    return (
      <div className="px-3 pt-3 pb-6 md:px-4 md:pt-6 md:pb-10 flex justify-center bg-[#FDF7EF] min-h-[calc(100vh-4.5rem)]">
        <div className="w-full max-w-2xl">
          <header className="space-y-1 text-center mb-6">
            <h1 className="font-heading text-2xl md:text-3xl font-semibold text-[#2F3E34]">
              My Vow
            </h1>
            <p className="text-xs md:text-sm text-[#6A7A6E] max-w-xl mx-auto">
              Your commitments as a parent. A quiet anchor for difficult moments.
            </p>
          </header>
          <div className="rounded-card border border-[#E4D6BC] bg-[#FBF3E4] p-6 md:p-8 text-center">
            <p className="text-sm md:text-base text-[#6A7A6E] mb-3">
              To keep your vows synced across devices and connected to your
              co-parenting case, you&apos;ll first need to create or join a
              case.
            </p>
            <p className="text-xs md:text-sm text-[#8B7F69]">
              Once your case is set up, this space becomes your personal anchor
              — a place to write and return to the kind of parent you want to
              be.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const { data, error } = await admin
    .from("vows")
    .select("id, content, is_pinned, created_at, updated_at, deleted_at")
    .eq("case_id", caseId)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .order("is_pinned", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    // Fallback: render empty state but keep page usable
    return <MyVowClient initialVows={[]} />;
  }

  const vows: Vow[] = (data ?? []).map((v) => ({
    id: v.id as string,
    content: (v.content as string) ?? "",
    is_pinned: (v.is_pinned as boolean) ?? false,
    created_at: v.created_at as string,
    updated_at: v.updated_at as string,
  }));

  return <MyVowClient initialVows={vows} />;
}

