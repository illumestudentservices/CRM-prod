import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe NextAuth base config — no Node.js-only imports.
 * Used by middleware.ts for JWT verification at the edge.
 * The full config (with PrismaAdapter + bcrypt) lives in lib/auth.ts.
 */
export const authConfig: NextAuthConfig = {
  session: { strategy: "jwt" },
  trustHost: true,
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [],
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const { pathname } = nextUrl;

      // Public routes — no auth required
      const isPublic =
        pathname.startsWith("/login") ||
        pathname.startsWith("/forgot-password") ||
        pathname.startsWith("/reset-password") ||
        pathname.startsWith("/api/auth");

      if (isPublic) return true;
      return isLoggedIn; // Unauthenticated → NextAuth redirects to signIn page
    },
  },
};
