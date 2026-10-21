"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { safeInviteNext } from "@/lib/cases/coparent-invitation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Preview = { status: "invalid" | "expired" | "used" | "valid"; emailHint: string | null };

export default function InvitePage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const current = new URLSearchParams(window.location.search).get("token")?.trim() ?? "";
    setToken(current);
    const next = safeInviteNext(`/invite?token=${encodeURIComponent(current)}`);
    void (async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      setSignedInEmail(data.user?.email ?? null);
      const res = await fetch(`/api/cases/invite-coparent/preview?token=${encodeURIComponent(current)}`);
      const body = (await res.json().catch(() => ({}))) as Partial<Preview>;
      setPreview({
        status: body.status === "valid" || body.status === "expired" || body.status === "used" ? body.status : "invalid",
        emailHint: typeof body.emailHint === "string" ? body.emailHint : null,
      });
      if (!next) setPreview({ status: "invalid", emailHint: null });
    })();
  }, []);

  async function accept() {
    setError(null);
    setAccepting(true);
    try {
      const res = await fetch("/api/cases/invite-coparent/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "This invitation could not be accepted.");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } finally {
      setAccepting(false);
    }
  }

  const nextHref = token ? `/invite?token=${encodeURIComponent(token)}` : "/invite";
  const title =
    preview?.status === "expired"
      ? "This invitation has expired"
      : preview?.status === "used"
        ? "This invitation has already been used"
        : preview?.status === "valid"
          ? "Join your family on MyVow"
          : preview
            ? "This invitation link is not valid"
            : "Checking invitation";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md shadow-card">
        <CardHeader className="space-y-1">
          <CardTitle className="font-heading text-2xl">{title}</CardTitle>
          {preview?.status === "valid" && (
            <CardDescription>
              {preview.emailHint
                ? `This invitation is for ${preview.emailHint}. Sign in with that address, or create an account if you are new.`
                : "Sign in with the address that received the invitation, or create an account if you are new."}
            </CardDescription>
          )}
          {preview?.status === "expired" && (
            <CardDescription>Ask the other parent to resend the invitation from their profile.</CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {error && (
            <p className="text-sm text-amber-600 dark:text-amber-500" role="alert">
              {error}
            </p>
          )}
          {preview?.status === "valid" && signedInEmail && (
            <>
              <p className="text-sm text-foreground-secondary">Signed in as {signedInEmail}</p>
              <Button type="button" className="w-full" onClick={() => void accept()} disabled={accepting}>
                {accepting ? "Joining…" : "Accept invitation"}
              </Button>
            </>
          )}
          {preview?.status === "valid" && !signedInEmail && (
            <div className="flex flex-col gap-2">
              <Button asChild className="w-full">
                <Link href={`/login?next=${encodeURIComponent(nextHref)}`}>Sign in</Link>
              </Button>
              <Button asChild variant="outline" className="w-full">
                <Link href={`/signup?next=${encodeURIComponent(nextHref)}`}>Create an account</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
