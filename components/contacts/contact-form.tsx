"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ChildMultiSelect, type ChildOption } from "@/components/documents/child-multi-select";
import { cn } from "@/lib/utils";

const ROLE_OPTIONS = [
  "Doctor",
  "Dentist",
  "Medical Specialist",
  "Therapist",
  "Teacher",
  "School Administrator",
  "Coach",
  "Attorney",
  "Mediator",
  "Other",
] as const;

const VISIBILITY_OPTIONS = [
  { value: "family", label: "Family" },
  { value: "parents", label: "Parents only" },
  { value: "private", label: "Just me" },
] as const;

interface ContactFormProps {
  caseId: string;
  children: ChildOption[];
}

export function ContactForm({ caseId, children }: ContactFormProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [role, setRole] = useState<string>("");
  const [organization, setOrganization] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [visibility, setVisibility] = useState<string>("parents");
  const [childIds, setChildIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEmergency, setIsEmergency] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/contacts/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          case_id: caseId,
          name: name.trim(),
          role: role || null,
          organization: organization.trim() || null,
          phone: phone.trim() || null,
          email: email.trim() || null,
          address: address.trim() || null,
          notes: notes.trim() || null,
          visibility: visibility || "parents",
          is_emergency: isEmergency,
          child_ids: childIds,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = (data as { message?: string }).message ?? "Could not save contact.";
        throw new Error(message);
      }
      setName("");
      setRole("");
      setOrganization("");
      setPhone("");
      setEmail("");
      setAddress("");
      setNotes("");
      setVisibility("parents");
      setChildIds([]);
      setIsEmergency(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="shadow-card border-border rounded-card">
      <CardHeader className="pb-2 px-4 pt-4">
        <CardTitle className="font-heading text-lg text-foreground">Add contact</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          {error && (
            <p className="text-xs text-alert" role="alert">
              {error}
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="contact-name" className="text-xs font-medium">
              Name
            </Label>
            <Input
              id="contact-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Dr. Patel"
              className="h-8 text-xs rounded-card"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contact-role" className="text-xs font-medium">
              Role / type
            </Label>
            <select
              id="contact-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className={cn(
                "flex h-8 w-full rounded-card border border-input bg-background px-2 py-1 text-xs",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              )}
            >
              <option value="">Select role</option>
              {ROLE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contact-org" className="text-xs font-medium">
              Practice / organization
            </Label>
            <Input
              id="contact-org"
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
              placeholder="Clinic, school, firm..."
              className="h-8 text-xs rounded-card"
            />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="contact-phone" className="text-xs font-medium">
                Phone
              </Label>
              <Input
                id="contact-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(555) 555-5555"
                className="h-8 text-xs rounded-card"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact-email" className="text-xs font-medium">
                Email
              </Label>
              <Input
                id="contact-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="h-8 text-xs rounded-card"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contact-address" className="text-xs font-medium">
              Address
            </Label>
            <Textarea
              id="contact-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Street, city, state, ZIP"
              className="text-xs min-h-[64px]"
            />
          </div>
          {children.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Child</Label>
              <ChildMultiSelect
                children={children}
                value={childIds}
                onChange={setChildIds}
              />
              <p className="text-[11px] text-foreground-secondary">
                Link this contact to one or more children.
              </p>
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              id="contact-emergency"
              type="checkbox"
              checked={isEmergency}
              onChange={(e) => setIsEmergency(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-border text-[#7B9E87] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Label
              htmlFor="contact-emergency"
              className="text-[11px] text-foreground-secondary"
            >
              Mark as Emergency Contact
            </Label>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contact-notes" className="text-xs font-medium">
              Notes
            </Label>
            <Textarea
              id="contact-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional details, preferences, or reminders."
              className="text-xs min-h-[64px]"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contact-visibility" className="text-xs font-medium">
              Visibility
            </Label>
            <select
              id="contact-visibility"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value)}
              className={cn(
                "flex h-8 w-full rounded-card border border-input bg-background px-2 py-1 text-xs",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              )}
            >
              {VISIBILITY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <Button
            type="submit"
            disabled={saving}
            className="rounded-full h-8 text-xs bg-[#7B9E87] hover:bg-[#6A8A78] text-white w-full sm:w-auto"
          >
            {saving ? "Saving…" : "Save contact"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

