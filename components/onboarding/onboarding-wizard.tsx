"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Upload, Check } from "lucide-react";

const APP_MODES = [
  { value: "solo", label: "Solo", description: "Parenting on your own" },
  { value: "partner", label: "With a Partner", description: "Raising kids together" },
  { value: "coparenting", label: "Co-Parenting", description: "Co-parenting with an ex" },
  { value: "solo_coparenting", label: "Solo + Co-Parenting", description: "Solo now, co-parenting too" },
] as const;

type AppMode = (typeof APP_MODES)[number]["value"];

const BACKGROUND = "#FDFBF7";
const SAGE = "#7B9E87";
const SAGE_HOVER = "#6A8A78";
const MUTED_TEXT = "#6B6B6B";

interface OnboardingWizardProps {
  onComplete: () => void;
}

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [appMode, setAppMode] = useState<AppMode | null>(null);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 2
  const [selectedMode, setSelectedMode] = useState<AppMode | null>(null);

  // Step 3
  const [firstName, setFirstName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [nickname, setNickname] = useState("");

  // Step 4
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Step 5
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteSending, setInviteSending] = useState(false);

  const effectiveMode = appMode ?? selectedMode;
  const isCoParenting =
    effectiveMode === "coparenting" || effectiveMode === "solo_coparenting";
  const totalDots = isCoParenting ? 6 : 4;
  const currentDotIndex = isCoParenting ? step : step <= 3 ? step : 4;

  const fetchCaseId = useCallback(async () => {
    try {
      const res = await fetch("/api/cases/settings");
      const data = await res.json().catch(() => ({}));
      if (data?.case_id) setCaseId(data.case_id);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if ((step === 4 || step === 5) && isCoParenting && !caseId) fetchCaseId();
  }, [step, isCoParenting, caseId, fetchCaseId]);

  async function patchOnboarding(payload: {
    onboarding_completed?: boolean;
    onboarding_step?: number;
    app_mode?: string;
  }) {
    const res = await fetch("/api/onboarding", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.message ?? "Update failed");
    }
  }

  async function handleSkip() {
    setError(null);
    setLoading(true);
    try {
      await patchOnboarding({ onboarding_step: step });
      onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  // Step 1 → 2
  function handleGetStarted() {
    setStep(2);
  }

  // Step 2 → 3
  async function handleModeContinue() {
    if (!selectedMode) return;
    setError(null);
    setLoading(true);
    try {
      await patchOnboarding({ app_mode: selectedMode, onboarding_step: 2 });
      setAppMode(selectedMode);
      setStep(3);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  // Step 3 → 4 or 6
  async function handleAddChildSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = firstName.trim();
    if (!name) {
      setError("First name is required.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/children/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: name,
          date_of_birth: dateOfBirth.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "Failed to add child");
      }
      await patchOnboarding({ onboarding_step: 3 });
      if (isCoParenting) setStep(4);
      else setStep(6);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleStep3Skip() {
    setError(null);
    setLoading(true);
    try {
      await patchOnboarding({ onboarding_step: 3 });
      if (isCoParenting) setStep(4);
      else setStep(6);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  // Step 4 upload
  function handleDrag(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(e.type === "dragenter" || e.type === "dragover");
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      const ok =
        file.type === "application/pdf" ||
        file.type.startsWith("image/");
      if (ok) setUploadFile(file);
    }
  }

  async function handleUploadSubmit() {
    if (!uploadFile || !caseId) return;
    setError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.set("file", uploadFile);
      formData.set("case_id", caseId);
      formData.set("title", "Parenting plan");
      formData.set("category", "court_order");
      formData.set("description", "Uploaded during onboarding");
      formData.set("visibility", "parents_only");
      const res = await fetch("/api/documents/upload", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.message ?? "Upload failed");
      }
      await patchOnboarding({ onboarding_step: 4 });
      setStep(5);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleStep4Skip() {
    setError(null);
    setLoading(true);
    try {
      await patchOnboarding({ onboarding_step: 4 });
      setStep(5);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleInviteSubmit(e: React.FormEvent) {
    e.preventDefault();
    const email = inviteEmail.trim();
    if (!email) return;
    setError(null);
    setInviteSending(true);
    try {
      const res = await fetch("/api/cases/invite-coparent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "Failed to send invite");
      }
      await patchOnboarding({ onboarding_step: 5 });
      setStep(6);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setInviteSending(false);
    }
  }

  async function handleStep5Skip() {
    setError(null);
    setLoading(true);
    try {
      await patchOnboarding({ onboarding_step: 5 });
      setStep(6);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleFinish() {
    setError(null);
    setLoading(true);
    try {
      await patchOnboarding({ onboarding_completed: true });
      onComplete();
      router.push("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-start overflow-y-auto pt-8 pb-12"
      style={{ backgroundColor: BACKGROUND }}
    >
      {/* Progress dots */}
      <div className="flex items-center gap-2 mb-8">
        {Array.from({ length: totalDots }).map((_, i) => {
          const idx = i + 1;
          const effectiveStep = isCoParenting ? idx : (idx <= 3 ? idx : 6);
          const active = currentDotIndex === effectiveStep;
          return (
            <div
              key={i}
              className={cn(
                "h-2 w-2 rounded-full transition-colors",
                active ? "opacity-100" : "opacity-40"
              )}
              style={{
                backgroundColor: active ? SAGE : "#E8E4DC",
              }}
            />
          );
        })}
      </div>

      <div className="w-full max-w-lg px-4 flex flex-col items-center">
        {error && (
          <p className="text-sm mb-4 text-[#C97B7B]" role="alert">
            {error}
          </p>
        )}

        {/* Step 1: Welcome */}
        {step === 1 && (
          <div className="text-center space-y-6">
            <h1 className="font-heading text-2xl md:text-3xl font-semibold text-foreground">
              Welcome to MyVow
            </h1>
            <p className="text-sm text-foreground-secondary max-w-md mx-auto">
              Parenting with clarity and calm. Track schedules, expenses, and
              communication in one place—so you can focus on what matters.
            </p>
            <div className="flex flex-col gap-3 pt-4">
              <Button
                type="button"
                onClick={handleGetStarted}
                className="rounded-full text-white"
                style={{ backgroundColor: SAGE }}
              >
                Let&apos;s get started
              </Button>
              <button
                type="button"
                onClick={handleSkip}
                disabled={loading}
                className="text-sm hover:underline disabled:opacity-50"
                style={{ color: MUTED_TEXT }}
              >
                Skip for now
              </button>
            </div>
          </div>
        )}

        {/* Step 2: App mode */}
        {step === 2 && (
          <div className="w-full space-y-6">
            <div className="text-center">
              <h2 className="font-heading text-xl font-semibold text-foreground mb-1">
                How are you parenting?
              </h2>
              <p className="text-sm text-foreground-secondary">
                Choose the option that best fits your situation.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {APP_MODES.map((mode) => (
                <Card
                  key={mode.value}
                  className={cn(
                    "cursor-pointer transition-all rounded-card border-2",
                    selectedMode === mode.value
                      ? "border-[#7B9E87] shadow-md"
                      : "border-[#E8E4DC] hover:border-[#B0A899]"
                  )}
                  onClick={() => setSelectedMode(mode.value)}
                >
                  <CardContent className="p-4">
                    <p className="font-medium text-foreground">{mode.label}</p>
                    <p className="text-xs text-foreground-secondary mt-0.5">
                      {mode.description}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
            <div className="flex flex-col gap-3">
              <Button
                type="button"
                onClick={handleModeContinue}
                disabled={!selectedMode || loading}
                className="rounded-full text-white w-full"
                style={{
                  backgroundColor: selectedMode ? SAGE : "#B0A899",
                }}
              >
                Continue
              </Button>
              <button
                type="button"
                onClick={handleSkip}
                disabled={loading}
                className="text-sm hover:underline disabled:opacity-50"
                style={{ color: MUTED_TEXT }}
              >
                Skip for now
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Add first child */}
        {step === 3 && (
          <div className="w-full space-y-6">
            <div className="text-center">
              <h2 className="font-heading text-xl font-semibold text-foreground mb-1">
                Add your first child
              </h2>
              <p className="text-sm text-foreground-secondary">
                You can add more later from your profile.
              </p>
            </div>
            <form onSubmit={handleAddChildSubmit} className="space-y-4">
              <div>
                <Label htmlFor="onboarding-first-name" className="text-foreground">
                  First name <span className="text-[#C97B7B]">*</span>
                </Label>
                <Input
                  id="onboarding-first-name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="e.g. Sam"
                  className="mt-1.5 rounded-card border-[#E8E4DC]"
                  required
                />
              </div>
              <div>
                <Label htmlFor="onboarding-dob" className="text-foreground">
                  Date of birth (optional)
                </Label>
                <Input
                  id="onboarding-dob"
                  type="date"
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                  className="mt-1.5 rounded-card border-[#E8E4DC]"
                />
              </div>
              <div>
                <Label htmlFor="onboarding-nickname" className="text-foreground">
                  Nickname (optional)
                </Label>
                <Input
                  id="onboarding-nickname"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="e.g. Sammy"
                  className="mt-1.5 rounded-card border-[#E8E4DC]"
                />
              </div>
              <div className="flex flex-col gap-3 pt-2">
                <Button
                  type="submit"
                  disabled={loading}
                  className="rounded-full text-white w-full"
                  style={{ backgroundColor: SAGE }}
                >
                  Add child
                </Button>
                <button
                  type="button"
                  onClick={handleStep3Skip}
                  disabled={loading}
                  className="text-sm hover:underline disabled:opacity-50"
                  style={{ color: MUTED_TEXT }}
                >
                  Skip for now
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Step 4: Upload parenting plan (coparenting only) */}
        {step === 4 && isCoParenting && (
          <div className="w-full space-y-6">
            <div className="text-center">
              <h2 className="font-heading text-xl font-semibold text-foreground mb-1">
                Upload your parenting plan
              </h2>
              <p className="text-sm text-foreground-secondary">
                PDF or image. You can add more documents later.
              </p>
            </div>
            <div
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              className={cn(
                "rounded-card border-2 border-dashed p-8 text-center transition-colors",
                dragActive ? "border-[#7B9E87] bg-[#EEF2E9]/50" : "border-[#E8E4DC] bg-[#FDFBF7]"
              )}
            >
              <Upload className="mx-auto h-10 w-10 text-foreground-secondary mb-2" />
              {uploadFile ? (
                <p className="text-sm text-foreground">{uploadFile.name}</p>
              ) : (
                <p className="text-sm text-foreground-secondary">
                  Drag and drop a file here, or click to browse
                </p>
              )}
              <input
                type="file"
                accept=".pdf,image/*"
                className="sr-only"
                id="onboarding-upload"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setUploadFile(f);
                }}
              />
              <Label
                htmlFor="onboarding-upload"
                className="mt-2 inline-block text-sm cursor-pointer"
                style={{ color: SAGE }}
              >
                Choose file
              </Label>
            </div>
            <div className="flex flex-col gap-3">
              <Button
                type="button"
                onClick={handleUploadSubmit}
                disabled={!uploadFile || !caseId || uploading}
                className="rounded-full text-white w-full"
                style={{ backgroundColor: SAGE }}
              >
                {uploading ? "Uploading…" : "Upload"}
              </Button>
              <button
                type="button"
                onClick={handleStep4Skip}
                disabled={loading}
                className="text-sm hover:underline disabled:opacity-50"
                style={{ color: MUTED_TEXT }}
              >
                Skip for now
              </button>
            </div>
          </div>
        )}

        {/* Step 5: Invite co-parent (coparenting only) */}
        {step === 5 && isCoParenting && (
          <div className="w-full space-y-6">
            <div className="text-center">
              <h2 className="font-heading text-xl font-semibold text-foreground mb-1">
                Invite your co-parent
              </h2>
              <p className="text-sm text-foreground-secondary">
                They&apos;ll get an email to join MyVow and this case.
              </p>
            </div>
            <form onSubmit={handleInviteSubmit} className="space-y-4">
              <div>
                <Label htmlFor="onboarding-invite-email" className="text-foreground">
                  Co-parent email
                </Label>
                <Input
                  id="onboarding-invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="email@example.com"
                  className="mt-1.5 rounded-card border-[#E8E4DC]"
                />
              </div>
              <div className="flex flex-col gap-3 pt-2">
                <Button
                  type="submit"
                  disabled={!inviteEmail.trim() || inviteSending}
                  className="rounded-full text-white w-full"
                  style={{ backgroundColor: SAGE }}
                >
                  {inviteSending ? "Sending…" : "Send invite"}
                </Button>
                <button
                  type="button"
                  onClick={handleStep5Skip}
                  disabled={loading}
                  className="text-sm hover:underline disabled:opacity-50"
                  style={{ color: MUTED_TEXT }}
                >
                  Skip for now
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Step 6: Completion */}
        {step === 6 && (
          <div className="text-center space-y-6">
            <h1 className="font-heading text-2xl md:text-3xl font-semibold text-foreground">
              You&apos;re ready to go
            </h1>
            <ul className="text-left max-w-xs mx-auto space-y-2 text-sm text-foreground-secondary">
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 shrink-0 text-[#7B9E87]" />
                Chose your parenting mode
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 shrink-0 text-[#7B9E87]" />
                {firstName.trim() ? "Added your first child" : "Skipped adding a child"}
              </li>
              {isCoParenting && (
                <>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 shrink-0 text-[#7B9E87]" />
                    {uploadFile ? "Uploaded parenting plan" : "Skipped upload"}
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 shrink-0 text-[#7B9E87]" />
                    Invite step completed
                  </li>
                </>
              )}
            </ul>
            <Button
              type="button"
              onClick={handleFinish}
              disabled={loading}
              className="rounded-full text-white px-8"
              style={{ backgroundColor: SAGE }}
            >
              Go to my dashboard
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
