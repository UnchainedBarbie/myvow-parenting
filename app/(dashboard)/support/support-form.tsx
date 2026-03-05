"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { showErrorToast } from "@/components/ui/toaster";

const SUPPORT_SUBJECTS = [
  "I have a technical issue",
  "Billing question",
  "I can't access my account",
  "Question about a feature",
  "I want to give feedback",
  "Something else",
] as const;

const MIN_MESSAGE_LENGTH = 20;
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

interface SupportFormProps {
  email: string;
  accountNumber: string;
}

export function SupportForm({ email, accountNumber }: SupportFormProps) {
  const [subject, setSubject] = useState<string>(SUPPORT_SUBJECTS[0]);
  const [message, setMessage] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const chosen = e.target.files?.[0];
    if (!chosen) {
      setFile(null);
      return;
    }
    if (!ALLOWED_IMAGE_TYPES.includes(chosen.type)) {
      setError("Please choose an image file (JPEG, PNG, GIF, or WebP).");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (chosen.size > MAX_SCREENSHOT_BYTES) {
      setError("Image must be 5MB or smaller.");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setFile(chosen);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedMessage = message.trim();
    if (trimmedMessage.length < MIN_MESSAGE_LENGTH) {
      setError(`Please write at least ${MIN_MESSAGE_LENGTH} characters.`);
      return;
    }

    setSubmitting(true);
    let screenshotUrl: string | undefined;

    try {
      if (file) {
        const formData = new FormData();
        formData.set("file", file);
        const uploadRes = await fetch("/api/support/upload-screenshot", {
          method: "POST",
          body: formData,
        });
        const uploadData = await uploadRes.json().catch(() => ({}));
        if (!uploadRes.ok) {
          showErrorToast(
            (uploadData as { error?: string }).error ?? "Screenshot upload failed."
          );
          setSubmitting(false);
          return;
        }
        screenshotUrl = (uploadData as { url?: string }).url;
      }

      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "support",
          email,
          account_number: accountNumber,
          subject,
          message: trimmedMessage,
          screenshot_url: screenshotUrl ?? undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string }).error ?? "Something went wrong. Please try again.");
        return;
      }
      setSuccess(true);
      setMessage("");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card shadow-card p-6 md:p-8">
      {success ? (
        <p className="text-foreground font-medium">
          Your request has been submitted. We&apos;ll follow up at {email}.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-xs text-foreground-secondary">
            Account: {accountNumber}
          </p>
          <div>
            <Label htmlFor="support-email" className="text-xs font-medium">
              Email
            </Label>
            <Input
              id="support-email"
              type="email"
              value={email}
              readOnly
              className="mt-1 bg-muted cursor-not-allowed"
              tabIndex={-1}
              aria-readonly
            />
          </div>
          <div>
            <Label htmlFor="support-subject" className="text-xs font-medium">
              Subject <span className="text-foreground-secondary">(required)</span>
            </Label>
            <select
              id="support-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
              className="mt-1 flex h-10 w-full rounded-card border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {SUPPORT_SUBJECTS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="support-message" className="text-xs font-medium">
              Message <span className="text-foreground-secondary">(required, min 20 characters)</span>
            </Label>
            <Textarea
              id="support-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              required
              minLength={MIN_MESSAGE_LENGTH}
              rows={4}
              className="mt-1 resize-y"
              placeholder="Describe your question or issue..."
            />
          </div>
          <div>
            <Label htmlFor="support-screenshot" className="text-xs font-medium">
              Attach a screenshot <span className="text-foreground-secondary">(optional, image only, max 5MB)</span>
            </Label>
            <input
              ref={fileInputRef}
              id="support-screenshot"
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              onChange={handleFileChange}
              className="mt-1 block w-full text-sm text-foreground-secondary file:mr-3 file:rounded-full file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90"
            />
            {file && (
              <p className="mt-1 text-xs text-foreground-secondary">
                Selected: {file.name}
              </p>
            )}
          </div>
          {error && (
            <p className="text-sm text-foreground-secondary">{error}</p>
          )}
          <Button
            type="submit"
            disabled={submitting}
            className="bg-[#5B7A52] hover:bg-[#476242] text-white"
          >
            {submitting ? "Submitting…" : "Submit request"}
          </Button>
        </form>
      )}
    </div>
  );
}
