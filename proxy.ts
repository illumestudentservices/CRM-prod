import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

const PUBLIC_ROUTES = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/api/auth",
];

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Pass current pathname to server components via request header.
  // AppShell reads x-pathname to highlight the active sidebar nav item.
  const headers = new Headers(req.headers);
  headers.set("x-pathname", pathname);

  // Public routes — no auth required
  if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
    // Redirect fully-authenticated users away from the login page
    if (req.auth?.user && !req.auth.user.twoFactorPending && pathname === "/login") {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
    return NextResponse.next({ request: { headers } });
  }

  // Unauthenticated — redirect to login with the original path as callbackUrl
  if (!req.auth) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Authenticated but 2FA not yet verified
  if (req.auth.user?.twoFactorPending) {
    // Allow the 2FA verification page — the /api/auth/* routes (including 2fa/verify)
    // are already in PUBLIC_ROUTES and pass through above
    if (pathname === "/verify-2fa") {
      return NextResponse.next({ request: { headers } });
    }
    // Return JSON 401 for API routes, HTML redirect for pages
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "2FA verification required" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/verify-2fa", req.url));
  }

  // Fully authenticated user hitting the verify-2fa page — redirect to dashboard
  if (pathname === "/verify-2fa") {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  // MFA is mandatory for every role. Anyone without it enrolled is held on the
  // setup page — they can still reach the 2FA endpoints (to enrol) and sign out,
  // but nothing else.
  if (!req.auth.user?.twoFactorEnabled) {
    const allowed =
      pathname === "/setup-2fa" ||
      pathname.startsWith("/api/auth/2fa/");
    if (!allowed) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          { error: "Two-factor authentication setup required" },
          { status: 403 }
        );
      }
      return NextResponse.redirect(new URL("/setup-2fa", req.url));
    }
    return NextResponse.next({ request: { headers } });
  }

  // Already enrolled — no reason to sit on the setup page
  if (pathname === "/setup-2fa") {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next({ request: { headers } });
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
