"use client";

import { Suspense, useState, useEffect, FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Image from "next/image";

function KidsInviteInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [childName, setChildName] = useState("");
  const [loading, setLoading] = useState(!!token);
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError("Invalid or missing link.");
      setLoading(false);
      return;
    }
    fetch(`/api/kids-invite?token=${encodeURIComponent(token)}`)
      .then((res) => res.json().catch(() => ({})))
      .then((data: { child_name?: string; message?: string }) => {
        if (data.child_name) {
          setChildName(data.child_name);
        } else {
          setError((data as { message?: string }).message ?? "Invalid or expired link.");
        }
      })
      .catch(() => setError("Could not load invite."))
      .finally(() => setLoading(false));
  }, [token]);

  function handlePinChange(value: string) {
    if (/^\d*$/.test(value) && value.length <= 6) setPin(value);
    setSubmitError(null);
  }
  function handleConfirmPinChange(value: string) {
    if (/^\d*$/.test(value) && value.length <= 6) setConfirmPin(value);
    setSubmitError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (pin.length < 4 || pin.length > 6) {
      setSubmitError("PIN must be 4–6 digits.");
      return;
    }
    if (pin !== confirmPin) {
      setSubmitError("PINs don't match.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/kids-invite/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, pin }),
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; message?: string };
      if (res.ok && data.success) {
        router.push("/kids-calendar");
        return;
      }
      setSubmitError(data.message ?? "Something went wrong. Please try again.");
    } catch {
      setSubmitError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FDFBF7] flex flex-col items-center justify-center p-4">
        <p className="text-sm text-stone-500">Loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#FDFBF7] flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-sm text-center space-y-4">
          <div className="relative w-32 h-10 mx-auto">
            <Image
              src="/Horiztonal%20logo%20translucent.png"
              alt="MyVow"
              fill
              className="object-contain object-center"
            />
          </div>
          <p className="text-sm text-red-600">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center gap-4">
          <div className="relative w-32 h-10">
            <Image
              src="/Horiztonal%20logo%20translucent.png"
              alt="MyVow"
              fill
              className="object-contain object-center"
            />
          </div>
          <h1 className="text-lg font-semibold text-foreground text-center">
            Welcome {childName || "there"}! Create a PIN to access your calendar
          </h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="kids-invite-pin" className="text-sm font-medium text-stone-700">
              PIN (4–6 digits)
            </Label>
            <Input
              id="kids-invite-pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              placeholder="••••"
              value={pin}
              onChange={(e) => handlePinChange(e.target.value)}
              className="h-11 rounded-xl border-[#E8E4DC] bg-white text-center text-lg"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="kids-invite-confirm" className="text-sm font-medium text-stone-700">
              Confirm PIN
            </Label>
            <Input
              id="kids-invite-confirm"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              placeholder="••••"
              value={confirmPin}
              onChange={(e) => handleConfirmPinChange(e.target.value)}
              className="h-11 rounded-xl border-[#E8E4DC] bg-white text-center text-lg"
            />
          </div>
          {submitError && (
            <p className="text-sm text-red-600 text-center" role="alert">
              {submitError}
            </p>
          )}
          <Button
            type="submit"
            disabled={submitting || pin.length < 4 || confirmPin.length < 4}
            className="w-full h-11 rounded-xl bg-[#7B9E87] hover:bg-[#6A8A78] text-white font-medium text-sm"
          >
            {submitting ? "Setting up…" : "Create PIN & continue"}
          </Button>
        </form>
      </div>
    </div>
  );
}

export default function KidsInvitePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          Loading...
        </div>
      }
    >
      <KidsInviteInner />
    </Suspense>
  );
}
