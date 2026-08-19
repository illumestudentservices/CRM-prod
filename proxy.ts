import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { NAV_PERMISSIONS, type Role } from "@/lib/permissions";

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

  // ── Module authorisation ───────────────────────────────────────────────
  //
  // NAV_PERMISSIONS decides which modules appear in the sidebar. Until now it
  // only decided that: individual pages checked you were signed in, and most
  // did not check your role was allowed the module. Hiding the link while
  // leaving the route open means anyone who types the URL — or keeps a
  // bookmark after a role change — still gets in.
  //
  // Enforcing here rather than per-page keeps one source of truth, so the nav
  // and the guard cannot drift apart.
  const moduleKey = moduleForPath(pathname);
  if (moduleKey) {
    const role = req.auth.user?.role as Role | undefined;
    const allowedRoles = NAV_PERMISSIONS[moduleKey];
    if (role && allowedRoles && !allowedRoles.includes(role)) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
  }

  return NextResponse.next({ request: { headers } });
});

/**
 * Ordered most-specific-first so `/recruitment-network/...` can't match a
 * shorter prefix by accident.
 */
const PATH_TO_MODULE: ReadonlyArray<readonly [string, string]> = [
  ["/recruitment-network", "recruitment_network"],
  ["/recruitment-planning", "recruitment_planning"],
  ["/market-intelligence", "market_intelligence"],
  ["/field-operations", "field_operations"],
  ["/risk-compliance", "risk_compliance"],
  // Added 2026-08-19. Both modules were listed in NAV_PERMISSIONS with a
  // restricted role list and had no prefix here, so this proxy never gated
  // them — the list was decoration and the only real check was the one each
  // page happens to run for itself. Those page checks are correct today, which
  // is why nothing leaked, but "correct because every page remembered" is not
  // the guarantee this file exists to provide. Verified before adding that the
  // NAV_PERMISSIONS lists and PERMISSION_MATRIX read grants agree for both, so
  // this closes the gap without changing who gets in.
  ["/icr-transition", "icr_transition"],
  ["/forecasting", "forecasting"],
  ["/activity-log", "activity_log"],
  ["/recycle-bin", "recycle_bin"],
  ["/institutions", "institutions"],
  ["/stakeholders", "stakeholders"],
  ["/students", "students"],
  ["/analytics", "analytics"],
  ["/knowledge", "knowledge"],
  ["/whatsapp", "whatsapp"],
  ["/settings", "settings"],
  ["/reports", "reports"],
  ["/markets", "markets"],
  ["/events", "events"],
  ["/tasks", "tasks"],
  ["/hr", "hr"],
];

/**
 * Longest-prefix match from a pathname to its NAV_PERMISSIONS key. Returns
 * undefined for anything that isn't a module page, which is left alone.
 */
function moduleForPath(pathname: string): string | undefined {
  for (const [prefix, key] of PATH_TO_MODULE) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) return key;
  }
  return undefined;
}

export const config = {
  matcher: [
    // sw.js is excluded because the service worker spec rejects a registration
    // whose script request redirects, and every path through this proxy sends a
    // signed-out visitor to /login. Left in, the worker silently fails to
    // install and offline capture never cold-starts — with no error anywhere
    // except the browser console.
    //
    // Nothing is exposed by that: the file is a static caching policy with no
    // data in it, and the pages and APIs it touches stay guarded as before.
    "/((?!_next/static|_next/image|favicon\\.ico|sw\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
