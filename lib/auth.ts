import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import type { Role } from "@prisma/client";
import { logActivity } from "@/lib/activity-logger";

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 30;

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db) as never,
  session: { strategy: "jwt" },
  trustHost: true,
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const email = credentials.email as string;
        const password = credentials.password as string;

        let user;
        try {
          user = await db.user.findUnique({
            where: { email },
            include: { region: true },
          });
        } catch (err) {
          console.error("[auth] DB lookup failed:", err);
          return null;
        }

        if (!user || !user.password) return null;
        if (!user.isActive) return null;

        // Check account lockout
        if (user.lockedUntil && user.lockedUntil > new Date()) {
          console.log(`[auth] Account locked: ${email}, until ${user.lockedUntil}`);
          return null;
        }

        const isValid = await bcrypt.compare(password, user.password);

        if (!isValid) {
          const newAttempts = (user.loginAttempts ?? 0) + 1;
          console.log(`[auth] Failed attempt ${newAttempts}/${MAX_ATTEMPTS} for ${email}`);

          try {
            if (newAttempts >= MAX_ATTEMPTS) {
              const lockUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
              await db.user.update({
                where: { id: user.id },
                data: { loginAttempts: 0, lockedUntil: lockUntil },
              });
              console.log(`[auth] Account LOCKED for ${email} until ${lockUntil}`);
              void notifyAccountLocked(user.email, user.name ?? user.email, lockUntil);
            } else {
              await db.user.update({
                where: { id: user.id },
                data: { loginAttempts: newAttempts },
              });
            }
          } catch (err) {
            console.error("[auth] Failed to update login attempts:", err);
          }

          return null;
        }

        // Successful login — reset attempts and lockout
        try {
          if (user.loginAttempts > 0 || user.lockedUntil) {
            await db.user.update({
              where: { id: user.id },
              data: { loginAttempts: 0, lockedUntil: null },
            });
          }
        } catch (err) {
          console.error("[auth] Failed to reset login attempts:", err);
        }

        void logActivity(user.id, "LOGIN", "USER", user.id, { email: user.email, role: user.role });

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          role: user.role,
          regionId: user.regionId,
          mustChangePassword: user.mustChangePassword,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role: Role }).role;
        token.regionId = (user as { regionId: string | null }).regionId;
        token.mustChangePassword =
          (user as { mustChangePassword?: boolean }).mustChangePassword ?? false;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
        session.user.regionId = token.regionId as string | null;
        session.user.mustChangePassword = (token.mustChangePassword as boolean) ?? false;
      }
      return session;
    },
  },
});

async function notifyAccountLocked(email: string, name: string, lockUntil: Date) {
  try {
    const { sendAccountLockedEmail, getSuperAdminEmails } = await import("@/lib/email");
    await sendAccountLockedEmail({ to: email, name, lockUntil });
    const adminEmails = await getSuperAdminEmails();
    if (adminEmails.length) {
      await sendAccountLockedEmail({
        to: adminEmails,
        name,
        lockUntil,
        isAdminAlert: true,
        targetEmail: email,
      });
    }
  } catch (err) {
    console.error("[auth] Failed to send lockout notification:", err);
  }
}
