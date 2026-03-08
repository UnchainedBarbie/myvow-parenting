import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getKidSession } from "@/lib/kids-session";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public webhook route — must bypass auth/session checks so Stripe can call it.
  if (pathname === "/api/stripe/webhook") {
    return NextResponse.next();
  }

  // No standalone /kids route — redirect to the correct app
  if (pathname === "/kids") {
    const kidSession = await getKidSession(request);
    const url = kidSession
      ? new URL("/kids-calendar", request.url)
      : new URL("/dashboard", request.url);
    return NextResponse.redirect(url);
  }

  const isKidsRoute = pathname === "/kids-calendar" || pathname.startsWith("/kids/");
  const isKidsLogin =
    pathname === "/kids-login" || pathname.startsWith("/kids-login");

  let kidSession: Awaited<ReturnType<typeof getKidSession>> | null | undefined;

  // Protect /kids routes (except /kids/login) with kid session.
  if (isKidsRoute && !isKidsLogin) {
    kidSession = await getKidSession(request);
    if (!kidSession) {
      const loginUrl = new URL("/kids-login", request.url);
      return NextResponse.redirect(loginUrl);
    }
  }

  // Prevent kid sessions from accessing parent dashboard routes.
  const parentPrefixes = [
    "/dashboard",
    "/messages",
    "/sage",
    "/expenses",
    "/reports",
    "/settings",
    "/my-vow",
  ];

  const isParentRoute = parentPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

  if (isParentRoute) {
    if (kidSession === undefined) {
      kidSession = await getKidSession(request);
    }
    if (kidSession) {
      // Parent route but request has kid cookie — might be stale (e.g. after parent login).
      // If user has a Supabase (parent) session, clear kid cookie and allow through to dashboard.
      const res = NextResponse.next();
      const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            get(name: string) {
              return request.cookies.get(name)?.value;
            },
            set() {},
            remove() {},
          },
        }
      );
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        res.cookies.set("kid_session_token", "", { maxAge: 0, path: "/" });
        return res;
      }
      const kidsUrl = new URL("/kids-calendar", request.url);
      return NextResponse.redirect(kidsUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/kids",
    "/kids/:path*",
    "/kids-calendar",
    "/kids-login",
    "/kids-invite",
    "/dashboard/:path*",
    "/messages/:path*",
    "/sage/:path*",
    "/expenses/:path*",
    "/reports/:path*",
    "/settings/:path*",
    "/my-vow/:path*",
  ],
};

