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
    // Redirect already-authenticated users away from the login page
    if (req.auth?.user && pathname === "/login") {
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

  return NextResponse.next({ request: { headers } });
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
