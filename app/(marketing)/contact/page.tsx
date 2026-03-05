"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const SUBJECT_OPTIONS = [
  "I'm interested in a demo",
  "I work with co-parents professionally",
  "Press or media inquiry",
  "Partnership opportunity",
  "Something else",
] as const;

export default function ContactPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [subject, setSubject] = useState<string>(SUBJECT_OPTIONS[0]);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "sales",
          name: name.trim(),
          email: email.trim(),
          company_organization: company.trim() || undefined,
          role_title: role.trim() || undefined,
          subject: subject || SUBJECT_OPTIONS[0],
          message: message.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string }).error ?? "Something went wrong. Please try again.");
        return;
      }
      setSuccess(true);
      setName("");
      setEmail("");
      setCompany("");
      setRole("");
      setSubject("");
      setMessage("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="border-b border-border bg-gradient-to-b from-background to-background-secondary/40">
      <div className="container mx-auto px-4 py-10 md:py-14 lg:py-16">
        <div className="grid gap-10 lg:gap-12 lg:grid-cols-2 items-start max-w-5xl mx-auto">
          {/* Left: value prop */}
          <div className="space-y-6">
            <h1 className="font-heading text-3xl md:text-4xl font-semibold text-foreground">
              Let&apos;s talk about MyVow
            </h1>
            <p className="text-base md:text-lg text-foreground-secondary max-w-xl">
              Whether you&apos;re a mediator, therapist, attorney, or co-parenting
              coordinator — we&apos;d love to show you how MyVow works.
            </p>
            <ul className="space-y-3 text-sm text-foreground">
              <li className="flex items-center gap-2">
                <span aria-hidden>🕊️</span>
                <span>Built for calm, not conflict</span>
              </li>
              <li className="flex items-center gap-2">
                <span aria-hidden>📋</span>
                <span>Court-ready documentation</span>
              </li>
              <li className="flex items-center gap-2">
                <span aria-hidden>🔒</span>
                <span>Private by design</span>
              </li>
            </ul>
          </div>

          {/* Right: form */}
          <div className="rounded-2xl border border-border bg-card shadow-lg shadow-black/5 p-6 md:p-8">
            {success ? (
              <p className="text-foreground font-medium">
                Thanks — we&apos;ll be in touch within one business day.
              </p>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="contact-name" className="text-xs font-medium">
                    Name <span className="text-foreground-secondary">(required)</span>
                  </Label>
                  <Input
                    id="contact-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className="mt-1 border-[#E8E4DC] bg-[#FDFBF7] focus:ring-[#7C8B6E]"
                    placeholder="Your name"
                  />
                </div>
                <div>
                  <Label htmlFor="contact-email" className="text-xs font-medium">
                    Email <span className="text-foreground-secondary">(required)</span>
                  </Label>
                  <Input
                    id="contact-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="mt-1 border-[#E8E4DC] bg-[#FDFBF7] focus:ring-[#7C8B6E]"
                    placeholder="you@example.com"
                  />
                </div>
                <div>
                  <Label htmlFor="contact-company" className="text-xs font-medium">
                    Company / Organization <span className="text-foreground-secondary">(optional)</span>
                  </Label>
                  <Input
                    id="contact-company"
                    type="text"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    className="mt-1 border-[#E8E4DC] bg-[#FDFBF7] focus:ring-[#7C8B6E]"
                    placeholder="Company name"
                  />
                </div>
                <div>
                  <Label htmlFor="contact-role" className="text-xs font-medium">
                    Role / Title <span className="text-foreground-secondary">(optional)</span>
                  </Label>
                  <Input
                    id="contact-role"
                    type="text"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="mt-1 border-[#E8E4DC] bg-[#FDFBF7] focus:ring-[#7C8B6E]"
                    placeholder="e.g. Mediator, Attorney"
                  />
                </div>
                <div>
                  <Label htmlFor="contact-subject" className="text-xs font-medium">
                    Subject <span className="text-foreground-secondary">(required)</span>
                  </Label>
                  <select
                    id="contact-subject"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    required
                    className="mt-1 flex h-10 w-full rounded-card border border-[#E8E4DC] bg-[#FDFBF7] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7C8B6E]"
                  >
                    {SUBJECT_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="contact-message" className="text-xs font-medium">
                    Message <span className="text-foreground-secondary">(required)</span>
                  </Label>
                  <Textarea
                    id="contact-message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    required
                    rows={4}
                    className="mt-1 border-[#E8E4DC] bg-[#FDFBF7] focus:ring-[#7C8B6E] resize-y"
                    placeholder="How can we help?"
                  />
                </div>
                {error && (
                  <p className="text-sm text-foreground-secondary">{error}</p>
                )}
                <Button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-full h-10 bg-[#5B7A52] text-white hover:bg-[#476242]"
                >
                  {submitting ? "Sending…" : "Send message"}
                </Button>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
