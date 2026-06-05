"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let resolved = false;

    const resolve = (valid: boolean) => {
      if (resolved) return;
      resolved = true;
      setHasRecoverySession(valid);
      setCheckingSession(false);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN")) {
        resolve(true);
        return;
      }
      if (event === "INITIAL_SESSION") {
        if (session) {
          resolve(true);
        } else {
          window.setTimeout(async () => {
            const { data: { session: retrySession } } = await supabase.auth.getSession();
            resolve(!!retrySession);
          }, 500);
        }
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!success) return;
    const t = window.setTimeout(() => {
      router.push("/login");
    }, 2000);
    return () => window.clearTimeout(t);
  }, [success, router]);

  function validate(): string | null {
    if (password.length < 8) {
      return "Password must be at least 8 characters.";
    }
    if (password !== confirmPassword) {
      return "Passwords do not match.";
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setValidationError(null);
    setSubmitError(null);

    const validation = validate();
    if (validation) {
      setValidationError(validation);
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      setSubmitError(error.message);
      return;
    }
    setSuccess(true);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md shadow-card">
        <CardHeader className="space-y-1">
          <CardTitle className="font-heading text-2xl">Set new password</CardTitle>
          <CardDescription>
            Choose a new password for your account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {checkingSession ? (
            <p className="text-sm text-foreground-secondary">Loading…</p>
          ) : !hasRecoverySession ? (
            <div className="space-y-4">
              <p className="text-sm text-amber-600 dark:text-amber-500" role="alert">
                This reset link is invalid or has expired. Request a new one.
              </p>
              <p className="text-center text-sm text-foreground-secondary">
                <Link href="/auth/forgot-password" className="text-primary hover:underline">
                  Request a new reset link
                </Link>
              </p>
            </div>
          ) : success ? (
            <p className="text-sm text-foreground-secondary">
              Your password has been updated
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {(validationError || submitError) && (
                <p className="text-sm text-amber-600 dark:text-amber-500" role="alert">
                  {validationError ?? submitError}
                </p>
              )}
              <div className="space-y-2">
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  minLength={8}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  minLength={8}
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Updating…" : "Update password"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
