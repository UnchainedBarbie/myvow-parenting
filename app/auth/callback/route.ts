import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Supabase auth callback (OAuth, magic link, etc.).
 * Exchanges code for session and redirects to /dashboard (parent app).
 * Never redirect to /kids — parent login always goes to dashboard.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  // Only allow redirect to dashboard or relative paths; never to /kids
  const allowedNext = next.startsWith("/") && !next.startsWith("/kids")
    ? next
    : "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const res = NextResponse.redirect(new URL(allowedNext, origin));
      // Clear kid session so parent is not redirected to kids app
      res.cookies.set("kid_session_token", "", { maxAge: 0, path: "/" });
      return res;
    }
  }

  // No code or exchange failed — still send to dashboard
  const res = NextResponse.redirect(new URL("/dashboard", origin));
  res.cookies.set("kid_session_token", "", { maxAge: 0, path: "/" });
  return res;
}
