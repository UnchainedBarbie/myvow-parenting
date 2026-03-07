export const dynamic = "force-dynamic";

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type KidMe = {
  kid_id: string;
  name: string;
  avatar_url: string | null;
};

export default function KidsHomePage() {
  const router = useRouter();
  const [me, setMe] = useState<KidMe | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/kids/me");
        const data = (await res.json().catch(() => ({}))) as KidMe & {
          message?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          router.push("/kids/login");
          return;
        }
        setMe({
          kid_id: data.kid_id,
          name: data.name,
          avatar_url: data.avatar_url ?? null,
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleLogout() {
    try {
      await fetch("/api/kids/auth", { method: "DELETE" });
    } finally {
      router.push("/kids-login");
    }
  }

  const displayName = me?.name ?? "Friend";

  return (
    <div className="w-full max-w-xl space-y-6">
      <header className="flex items-center justify-between gap-3 rounded-2xl border border-[#E8E4DC] bg-white/80 px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2">
          <Image
            src="/dove-translucent.png"
            alt="MyVow dove"
            width={36}
            height={36}
            className="opacity-70"
          />
          <span className="text-sm font-semibold text-[#3D3D3D]">
            MyVow
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-[#3D3D3D]">
            {loading ? "Loading…" : displayName}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-full text-xs"
            onClick={() => void handleLogout()}
          >
            Log out
          </Button>
        </div>
      </header>

      <main className="space-y-4">
        <section className="space-y-1">
          <h1 className="font-heading text-2xl text-[#3D3D3D]">
            Hi {displayName}! 👋
          </h1>
          <p className="text-sm text-[#6B6B6B]">
            This is your space to see what&apos;s coming up and stay organized.
          </p>
        </section>

        <section>
          <div className="grid grid-cols-2 gap-3">
            <Card
              className="min-h-[120px] cursor-pointer rounded-2xl border border-[#E8E4DC] bg-white px-4 py-3 shadow-sm hover:bg-[#F2F5EF] transition-colors flex flex-col justify-center"
              onClick={() => router.push("/kids-calendar")}
            >
              <div className="text-2xl mb-1">📅</div>
              <div className="text-sm font-semibold text-[#3D3D3D]">
                Calendar
              </div>
              <p className="mt-0.5 text-[11px] text-[#6B6B6B]">
                See what&apos;s coming up.
              </p>
            </Card>

            <Card
              className="min-h-[120px] cursor-pointer rounded-2xl border border-[#E8E4DC] bg-white px-4 py-3 shadow-sm hover:bg-[#F2F5EF] transition-colors flex flex-col justify-center"
              onClick={() => router.push("/kids-documents")}
            >
              <div className="text-2xl mb-1">📁</div>
              <div className="text-sm font-semibold text-[#3D3D3D]">
                Documents
              </div>
              <p className="mt-0.5 text-[11px] text-[#6B6B6B]">
                Important things saved for your family.
              </p>
            </Card>

            <Card
              className="min-h-[120px] cursor-pointer rounded-2xl border border-[#E8E4DC] bg-white px-4 py-3 shadow-sm hover:bg-[#F2F5EF] transition-colors flex flex-col justify-center"
              onClick={() => router.push("/kids/messages")}
            >
              <div className="text-2xl mb-1">💬</div>
              <div className="text-sm font-semibold text-[#3D3D3D]">
                Messages
              </div>
              <p className="mt-0.5 text-[11px] text-[#6B6B6B]">
                A calmer place to talk. (Coming soon)
              </p>
            </Card>

            <Card
              className="min-h-[120px] cursor-pointer rounded-2xl border border-[#E8E4DC] bg-white px-4 py-3 shadow-sm hover:bg-[#F2F5EF] transition-colors flex flex-col justify-center"
              onClick={() => router.push("/kids-sage")}
            >
              <div className="text-2xl mb-1">🕊️</div>
              <div className="text-sm font-semibold text-[#3D3D3D]">
                Sage
              </div>
              <p className="mt-0.5 text-[11px] text-[#6B6B6B]">
                Private check-ins with Sage. (Coming soon)
              </p>
            </Card>
          </div>
        </section>
      </main>
    </div>
  );
}

