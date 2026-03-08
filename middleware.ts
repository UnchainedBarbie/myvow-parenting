import { NextRequest, NextResponse } from "next/server";
import { getKidSession } from "@/lib/kids-session";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public webhook route — must bypass auth/session checks so Stripe can call it.
  if (pathname === "/api/stripe/webhook") {
    return NextResponse.next();
  }

  // Redirect legacy /kids to /kids-calendar
  if (pathname === "/kids") {
    return NextResponse.redirect(new URL("/kids-calendar", request.url));
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
      const kidsUrl = new URL("/kids-calendar", request.url);
      return NextResponse.redirect(kidsUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/kids/:path*",
    "/dashboard/:path*",
    "/messages/:path*",
    "/sage/:path*",
    "/expenses/:path*",
    "/reports/:path*",
    "/settings/:path*",
    "/my-vow/:path*",
  ],
};

