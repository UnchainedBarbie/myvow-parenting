import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { Resend } from "resend";

const RESEND_FROM = process.env.RESEND_FROM ?? "MyVow <onboarding@resend.dev>";
const CONTACT_TO = "allison@myvowparenting.com";

function buildEmailBody(payload: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null || value === "") continue;
    const label = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    lines.push(`${label}: ${String(value)}`);
  }
  return lines.join("\n");
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const {
      type,
      name,
      email,
      company_organization,
      role_title,
      subject,
      message,
      account_number,
      screenshot_url,
    } = body as {
      type?: string;
      name?: string;
      email?: string;
      company_organization?: string;
      role_title?: string;
      subject?: string;
      message?: string;
      account_number?: string;
      screenshot_url?: string;
    };

    const rawType = (type ?? "").toLowerCase().trim();
    if (rawType !== "sales" && rawType !== "support") {
      return NextResponse.json(
        { error: "type must be 'sales' or 'support'" },
        { status: 400 }
      );
    }

    const trimmedMessage = (message ?? "").trim();
    if (!trimmedMessage) {
      return NextResponse.json(
        { error: "message is required" },
        { status: 400 }
      );
    }

    const trimmedSubject = (subject ?? "").trim();
    if (!trimmedSubject) {
      return NextResponse.json(
        { error: "subject is required" },
        { status: 400 }
      );
    }

    const trimmedEmail = (email ?? "").trim();
    if (!trimmedEmail) {
      return NextResponse.json(
        { error: "email is required" },
        { status: 400 }
      );
    }

    if (rawType === "sales" && !(name ?? "").trim()) {
      return NextResponse.json(
        { error: "name is required for sales inquiries" },
        { status: 400 }
      );
    }

    const admin = getServiceRoleClient();
    const { data: row, error: insertError } = await admin
      .from("contact_submissions")
      .insert({
        type: rawType,
        name: (name ?? "").trim() || null,
        email: trimmedEmail,
        company_organization: (company_organization ?? "").trim() || null,
        role_title: (role_title ?? "").trim() || null,
        subject: trimmedSubject,
        message: trimmedMessage,
        account_number: (account_number ?? "").trim() || null,
        screenshot_url: (screenshot_url ?? "").trim() || null,
      })
      .select("id")
      .single();

    if (insertError) {
      return NextResponse.json(
        { error: insertError.message ?? "Failed to save submission" },
        { status: 500 }
      );
    }

    const payload: Record<string, unknown> = {
      type: rawType,
      name: (name ?? "").trim() || "(not provided)",
      email: trimmedEmail,
      company_organization: (company_organization ?? "").trim() || "(not provided)",
      role_title: (role_title ?? "").trim() || "(not provided)",
      subject: trimmedSubject,
      message: trimmedMessage,
    };
    if (rawType === "support") {
      payload.account_number = (account_number ?? "").trim() || "(not provided)";
      if (screenshot_url) payload.screenshot_url = screenshot_url;
    }

    const emailBody = buildEmailBody(payload);
    const emailSubject = `[MyVow ${rawType}] ${trimmedSubject}`;

    const apiKey = process.env.RESEND_API_KEY;
    if (apiKey) {
      try {
        const resend = new Resend(apiKey);
        const { error: emailError } = await resend.emails.send({
          from: RESEND_FROM,
          to: CONTACT_TO,
          replyTo: trimmedEmail,
          subject: emailSubject,
          text: emailBody,
        });
        if (emailError) {
          console.error("[contact] Resend error:", emailError);
          // Still return success; submission was stored
        }
      } catch (e) {
        console.error("[contact] Resend exception:", e);
      }
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Something went wrong" },
      { status: 500 }
    );
  }
}
