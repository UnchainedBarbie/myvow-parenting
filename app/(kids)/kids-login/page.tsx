"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Image from "next/image";
import { cn } from "@/lib/utils";

const FAMILY_CODE_LENGTH = 6;
type LoginMode = "family_code" | "email";

export default function KidsLoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<LoginMode>("family_code");
  const [familyCode, setFamilyCode] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleFamilyCodeChange(value: string) {
    const next = value.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, FAMILY_CODE_LENGTH);
    setFamilyCode(next);
    setError(null);
  }

  function handlePinChange(value: string) {
    if (/^\d*$/.test(value)) setPin(value);
    setError(null);
  }

  async function handleFamilyCodeSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!familyCode.trim() || !name.trim() || !pin) {
      setError("Please enter family code, your name, and PIN.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/kids/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          family_code: familyCode.trim().toUpperCase(),
          name: name.trim(),
          pin,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        message?: string;
      };
      if (res.ok && data.success) {
        router.push("/kids-calendar");
        return;
      }
      setError(data.message ?? "Name not found or incorrect PIN.");
    } catch {
      setError("Invalid code or PIN. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEmailSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !pin) {
      setError("Please enter your email and PIN.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/kids/auth/login-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          pin,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        message?: string;
      };
      if (res.ok && data.success) {
        router.push("/kids-calendar");
        return;
      }
      setError(data.message ?? "Email or PIN is incorrect.");
    } catch {
      setError("Email or PIN is incorrect.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-4">
          <div className="relative w-32 h-10">
            <Image
              src="/Horiztonal%20logo%20translucent.png"
              alt="MyVow"
              fill
              className="object-contain object-center"
              priority
            />
          </div>
          <div className="flex rounded-xl border border-[#E8E4DC] bg-white p-1 w-full">
            <button
              type="button"
              onClick={() => { setMode("family_code"); setError(null); }}
              className={cn(
                "flex-1 py-2 text-xs font-medium rounded-lg transition-colors",
                mode === "family_code"
                  ? "bg-[#7B9E87] text-white"
                  : "text-stone-600 hover:bg-stone-100"
              )}
            >
              Sign in with family code
            </button>
            <button
              type="button"
              onClick={() => { setMode("email"); setError(null); }}
              className={cn(
                "flex-1 py-2 text-xs font-medium rounded-lg transition-colors",
                mode === "email"
                  ? "bg-[#7B9E87] text-white"
                  : "text-stone-600 hover:bg-stone-100"
              )}
            >
              Sign in with email
            </button>
          </div>
        </div>

        {mode === "family_code" ? (
          <form onSubmit={handleFamilyCodeSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="kids-family-code" className="text-sm font-medium text-stone-700">
                Family Code
              </Label>
              <Input
                id="kids-family-code"
                type="text"
                inputMode="text"
                autoComplete="off"
                maxLength={FAMILY_CODE_LENGTH}
                placeholder="e.g. ABC123"
                value={familyCode}
                onChange={(e) => handleFamilyCodeChange(e.target.value)}
                className="h-11 rounded-xl border-[#E8E4DC] bg-white text-center text-lg tracking-widest uppercase font-medium placeholder:normal-case placeholder:tracking-normal placeholder:text-stone-400"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="kids-name" className="text-sm font-medium text-stone-700">
                Your name
              </Label>
              <Input
                id="kids-name"
                type="text"
                autoComplete="off"
                placeholder="Your first name"
                value={name}
                onChange={(e) => { setName(e.target.value); setError(null); }}
                className="h-11 rounded-xl border-[#E8E4DC] bg-white text-center text-lg"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="kids-pin" className="text-sm font-medium text-stone-700">
                PIN
              </Label>
              <Input
                id="kids-pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                placeholder="••••"
                value={pin}
                onChange={(e) => handlePinChange(e.target.value)}
                className="h-11 rounded-xl border-[#E8E4DC] bg-white text-center text-lg"
              />
            </div>
            {error && (
              <p className="text-sm text-red-600 text-center" role="alert">
                {error}
              </p>
            )}
            <Button
              type="submit"
              disabled={submitting || !familyCode.trim() || !name.trim() || !pin}
              className="w-full h-11 rounded-xl bg-[#7B9E87] hover:bg-[#6A8A78] text-white font-medium text-sm"
            >
              {submitting ? "Signing in…" : "Sign In"}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleEmailSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="kids-email" className="text-sm font-medium text-stone-700">
                Email
              </Label>
              <Input
                id="kids-email"
                type="email"
                autoComplete="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(null); }}
                className="h-11 rounded-xl border-[#E8E4DC] bg-white text-center text-lg"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="kids-pin-email" className="text-sm font-medium text-stone-700">
                PIN
              </Label>
              <Input
                id="kids-pin-email"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                placeholder="••••"
                value={pin}
                onChange={(e) => handlePinChange(e.target.value)}
                className="h-11 rounded-xl border-[#E8E4DC] bg-white text-center text-lg"
              />
            </div>
            {error && (
              <p className="text-sm text-red-600 text-center" role="alert">
                {error}
              </p>
            )}
            <Button
              type="submit"
              disabled={submitting || !email.trim() || !pin}
              className="w-full h-11 rounded-xl bg-[#7B9E87] hover:bg-[#6A8A78] text-white font-medium text-sm"
            >
              {submitting ? "Signing in…" : "Sign In"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
