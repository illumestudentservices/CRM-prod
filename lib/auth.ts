import crypto from "crypto";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import type { Role } from "@prisma/client";
import { logActivity } from "@/lib/activity-logger";
import { findUserByEmail } from "@/lib/email-identity";
import { mfaProofSatisfied } from "@/lib/mfa-session";

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 30;

/** Hard ceiling on a browser session: 48 hours from sign-in. */
const SESSION_MAX_AGE_SECONDS = 48 * 60 * 60;

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db) as never,
  session: {
    strategy: "jwt",
    maxAge: SESSION_MAX_AGE_SECONDS,
    // Re-issue the cookie at most hourly rather than on every request.
    updateAge: 60 * 60,
  },
  jwt: { maxAge: SESSION_MAX_AGE_SECONDS },
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
          // Case-insensitive. This was `findUnique({ where: { email } })` on the
          // string exactly as typed, and Postgres compares text case-sensitively
          // — so an account stored as "Ashley-Jane@..." could only be signed into
          // by typing that capitalisation, and anyone entering their own address
          // in lowercase was told their password was wrong.
          //
          // The failure left no trace: no user row was found, so the
          // `loginAttempts` increment below never ran, nothing was logged, and
          // no lockout occurred. It also hid MFA enrolment, which sits behind a
          // successful password check — so it presented as two unrelated faults.
          // See lib/email-identity.ts.
          user = await findUserByEmail(email, { include: { region: true } });
        } catch (err) {
          console.error("[auth] DB lookup failed:", err);
          return null;
        }

        if (!user || !user.password) return null;
        if (!user.isActive) return null;
        if (user.deletedAt) return null;

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

        // If 2FA is enabled, return a pending session — TOTP must be verified before full access
        if (user.twoFactorEnabled) {
          return {
            id: user.id,
            email: user.email,
            name: user.name,
            image: user.image,
            role: user.role,
            regionId: user.regionId,
            mustChangePassword: user.mustChangePassword,
            passwordChangedAt: user.passwordChangedAt?.getTime() ?? null,
            twoFactorPending: true,
            twoFactorEnabled: true,
          };
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
          passwordChangedAt: user.passwordChangedAt?.getTime() ?? null,
          twoFactorPending: false,
          twoFactorEnabled: false,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        // Stamped once at sign-in and never refreshed, so the ceiling below is
        // absolute. maxAge on its own is a rolling window that continued
        // activity would keep pushing out indefinitely.
        token.loginAt = Date.now();
        // A fresh, unguessable id for THIS login. It stays inside the signed
        // JWT and is the anchor the 2FA-verify route stamps against, so the
        // pending gate below can only be lifted by a real server-side proof
        // tied to this exact session — never by a client-sent flag.
        token.sid = crypto.randomUUID();
        token.id = user.id;
        token.role = (user as { role: Role }).role;
        token.regionId = (user as { regionId: string | null }).regionId;
        token.mustChangePassword =
          (user as { mustChangePassword?: boolean }).mustChangePassword ?? false;
        // Stamped at sign-in so expiry can be evaluated on every request with
        // no database round trip.
        token.passwordChangedAt =
          (user as { passwordChangedAt?: number | null }).passwordChangedAt ?? null;
        token.twoFactorPending =
          (user as { twoFactorPending?: boolean }).twoFactorPending ?? false;
        token.twoFactorEnabled =
          (user as { twoFactorEnabled?: boolean }).twoFactorEnabled ?? false;
      }
      // Lift the second-factor gate — but ONLY on server-verified proof, never
      // on the client's say-so. The verify route stamps `mfaVerifiedSid` on the
      // user row equal to this token's `sid` after a real code passes; we clear
      // `twoFactorPending` only when the stored stamp matches. A forged
      // update({ twoFactorVerified: true }) finds no matching stamp and is inert.
      if (
        trigger === "update" &&
        (session as Record<string, unknown>)?.twoFactorVerified === true &&
        token.twoFactorPending &&
        token.sid
      ) {
        try {
          const proof = await db.user.findUnique({
            where: { id: token.id as string },
            select: { mfaVerifiedSid: true },
          });
          if (
            mfaProofSatisfied(
              token.sid as string | undefined,
              token.twoFactorPending as boolean | undefined,
              proof?.mfaVerifiedSid,
            )
          ) {
            token.twoFactorPending = false;
          }
        } catch (err) {
          // Fail CLOSED: a DB blip must not become a way past the gate.
          console.error("[auth] 2FA verification proof check failed:", err);
        }
      }
      // Password just rotated — refresh the stamp so the expiry redirect
      // stops firing without making the user sign in again.
      if (trigger === "update" && (session as Record<string, unknown>)?.passwordChanged === true) {
        token.passwordChangedAt = Date.now();
        token.mustChangePassword = false;
      }

      // Enrolment completed — clear the gate without forcing a re-login.
      if (trigger === "update" && (session as Record<string, unknown>)?.twoFactorEnrolled === true) {
        token.twoFactorEnabled = true;
        token.twoFactorPending = false;
      }

      // Absolute session ceiling. Returning null invalidates the token, so the
      // next request is treated as unauthenticated and lands on /login.
      const loginAt = token.loginAt as number | undefined;
      if (loginAt && Date.now() - loginAt > SESSION_MAX_AGE_SECONDS * 1000) {
        return null;
      }

      // ── Live account check ──────────────────────────────────────────────
      //
      // Sessions are stateless JWTs: there is no server-side session to
      // destroy, so without this a deactivated or deleted account keeps full
      // access until its token happens to expire — up to 48 hours. That is the
      // wrong behaviour for offboarding, where access must stop when the
      // administrator says it stops.
      //
      // Skipped on the sign-in pass (`user` is set) because authorize() has
      // just performed these checks against the same row.
      //
      // Costs one primary-key lookup per token refresh. That is the price of
      // revocation being immediate, and it also makes role and region changes
      // take effect without a re-login instead of silently lagging.
      if (!user && token.id) {
        let current;
        try {
          current = await db.user.findUnique({
            where: { id: token.id as string },
            select: {
              isActive: true,
              deletedAt: true,
              sessionsRevokedAt: true,
              role: true,
              regionId: true,
              twoFactorEnabled: true,
            },
          });
        } catch (err) {
          // Fail open on a database blip rather than signing everybody out.
          // The absolute ceiling above still applies, so this cannot extend a
          // session indefinitely.
          console.error("[auth] session revocation check failed:", err);
          return token;
        }

        if (!current || !current.isActive || current.deletedAt) return null;

        // Anything issued before the revocation stamp is refused.
        if (
          current.sessionsRevokedAt &&
          loginAt &&
          loginAt < current.sessionsRevokedAt.getTime()
        ) {
          return null;
        }

        token.role = current.role;
        token.regionId = current.regionId;
        // The database is the single source of truth for enrolment. If a forged
        // update({ twoFactorEnrolled: true }) flipped the token in this same
        // callback, this overwrites it back to reality — so the mandatory-setup
        // gate in proxy.ts cannot be skipped without actually enrolling.
        token.twoFactorEnabled = current.twoFactorEnabled;
      }

      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
        session.user.regionId = token.regionId as string | null;
        session.user.mustChangePassword = (token.mustChangePassword as boolean) ?? false;
        session.user.passwordChangedAt = (token.passwordChangedAt as number | null) ?? null;
        session.user.twoFactorPending = (token.twoFactorPending as boolean) ?? false;
        session.user.twoFactorEnabled = (token.twoFactorEnabled as boolean) ?? false;
        // The verify route needs this login's id to stamp its proof against.
        // Safe to expose: it is random, bound to the signed cookie, and grants
        // nothing to anyone who does not already hold the session.
        session.user.sid = token.sid as string | undefined;
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
