import crypto from "crypto";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import type { Role } from "@prisma/client";
import { logActivity } from "@/lib/activity-logger";
import { findUserByEmail } from "@/lib/email-identity";

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 30;

/** Hard ceiling on a browser session: 48 hours from sign-in. */
const SESSION_MAX_AGE_SECONDS = 48 * 60 * 60;

/**
 * How long a stamped 2FA proof stays usable. The verify route stamps it and the
 * client calls update() within milliseconds, so this is generous; it exists so
 * a stamp that is never consumed (the user closed the tab) cannot be replayed
 * with a stolen pending cookie minutes or hours later.
 */
const MFA_PROOF_TTL_MS = 5 * 60 * 1000;

/**
 * A valid bcrypt hash used as a constant-time stand-in when there is no real
 * password to check (unknown email, inactive/deleted account, or one currently
 * locked). Comparing the submitted password against it makes every failed
 * authorize() path pay for exactly one bcrypt comparison, so response time can
 * no longer distinguish a real account from a fabricated one (timing-based user
 * enumeration). Generated once at startup from a random value; its plaintext is
 * never needed.
 */
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(crypto.randomUUID(), 12);

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
  events: {
    // Instant server-side revocation on explicit sign-out — THIS DEVICE ONLY.
    // JWT sessions are stateless, so by default a copy of the cookie captured
    // before sign-out keeps working until the token's own expiry. We record the
    // signed-out token's per-login `sid` in revoked_sessions; the jwt() callback
    // below refuses exactly that sid on its next request, leaving the user's
    // other devices signed in (password change / lockout still end every
    // session via sessionsRevokedAt). A fresh sign-in gets a new sid and is
    // unaffected.
    async signOut(message) {
      const token = (message as { token?: { id?: unknown; sid?: unknown } }).token;
      const sid = typeof token?.sid === "string" ? token.sid : null;
      const userId = typeof token?.id === "string" ? token.id : null;
      if (!sid || !userId) return;
      try {
        // upsert, not create: a replayed sign-out of the same token must not
        // throw on the primary key.
        await db.revokedSession.upsert({
          where: { sid },
          create: { sid, userId },
          update: {},
        });
        // A revoked sid cannot out-live the absolute session ceiling, after
        // which the token is already dead by maxAge — so drop the old rows and
        // keep the table small.
        await db.revokedSession.deleteMany({
          where: { revokedAt: { lt: new Date(Date.now() - SESSION_MAX_AGE_SECONDS * 1000) } },
        });
      } catch (err) {
        // Never let a revocation write failure throw out of sign-out — the
        // cookie is cleared regardless; this only closes the replay window.
        console.error("[auth] sign-out revocation failed:", err);
      }
    },
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

        // Is this an account we can actually check a password against? A missing
        // user, one with no password hash, an inactive or deleted account, or one
        // whose lockout window is still open — none of them should proceed, but
        // all of them must take the SAME time as a real check (see below).
        const usable =
          !!user &&
          !!user.password &&
          user.isActive &&
          !user.deletedAt &&
          !(user.lockedUntil && user.lockedUntil > new Date());

        // Exactly one bcrypt comparison runs on every path. For an unusable
        // account we compare against a fixed dummy hash and throw the result
        // away, so the response time does not reveal whether the email exists,
        // is active, or is locked — closing the timing user-enumeration channel.
        const hashToCheck = usable && user && user.password ? user.password : DUMMY_PASSWORD_HASH;
        const isValid = await bcrypt.compare(password, hashToCheck);

        if (!usable || !user) {
          // Non-existent / inactive / deleted / already-locked: there is no
          // failed-attempt counter to advance, and we must not disclose which
          // of those it was. Lockout of a real account still happens on the
          // wrong-password branch below.
          if (user && user.lockedUntil && user.lockedUntil > new Date()) {
            console.log(`[auth] Account locked: ${email}, until ${user.lockedUntil}`);
          }
          return null;
        }

        if (!isValid) {
          // Atomic increment: parallel password guesses each advance the counter
          // rather than overwriting one another, so the five-strike lockout cannot
          // be bypassed by firing attempts concurrently. (bcrypt cost 12 already
          // bounds raw throughput, but the counter must still be correct.)
          try {
            const updated = await db.user.update({
              where: { id: user.id },
              data: { loginAttempts: { increment: 1 } },
              select: { loginAttempts: true },
            });
            console.log(`[auth] Failed attempt ${updated.loginAttempts}/${MAX_ATTEMPTS} for ${email}`);
            if (updated.loginAttempts >= MAX_ATTEMPTS) {
              const lockUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
              await db.user.update({
                where: { id: user.id },
                // `sessionsRevokedAt` kills any still-open sessions for this
                // account the moment it locks: the jwt live-check refuses every
                // token issued before this stamp, so a locked-out account is
                // signed out everywhere, not just blocked at the login form.
                data: { loginAttempts: 0, lockedUntil: lockUntil, sessionsRevokedAt: new Date() },
              });
              console.log(`[auth] Account LOCKED for ${email} until ${lockUntil}`);
              void notifyAccountLocked(user.email, user.name ?? user.email, lockUntil);
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
          // Consume the proof atomically: clear both columns only where the
          // stamp matches THIS session's sid AND is still fresh. updateMany is a
          // single conditional UPDATE, so a replay — or a second tab, or a
          // stolen pending cookie used later — finds nothing left to consume.
          // The proof is therefore strictly single-use and time-bounded.
          const consumed = await db.user.updateMany({
            where: {
              id: token.id as string,
              mfaVerifiedSid: token.sid as string,
              mfaVerifiedAt: { gt: new Date(Date.now() - MFA_PROOF_TTL_MS) },
            },
            data: { mfaVerifiedSid: null, mfaVerifiedAt: null },
          });
          if (consumed.count === 1) {
            token.twoFactorPending = false;
          }
        } catch (err) {
          // Fail CLOSED: a DB blip must not become a way past the gate.
          console.error("[auth] 2FA verification proof check failed:", err);
        }
      }
      // NOTE: there used to be `passwordChanged` and `twoFactorEnrolled` update
      // branches here that flipped token flags on the client's say-so. Both were
      // forgeable gate-bypasses: a caller holding only the password could POST
      // update({ twoFactorEnrolled: true }) to clear `twoFactorPending` on an
      // already-enrolled account and skip MFA entirely, and update({
      // passwordChanged: true }) to clear a forced/expired password change.
      // They are gone. `twoFactorEnabled` (and role, region, revocation) are now
      // sourced from the database in the live-account check below; the pending
      // gate is cleared ONLY by the server-verified proof-consume branch
      // above. The legitimate flows (enrolment via /api/auth/2fa/enable, a real
      // password change) end by re-reading the database or re-authenticating, so
      // nothing depends on a client-driven update() to move these flags.

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

        // Anything issued before the revocation stamp is refused (password
        // change and lockout bump this, ending every session).
        if (
          current.sessionsRevokedAt &&
          loginAt &&
          loginAt < current.sessionsRevokedAt.getTime()
        ) {
          return null;
        }

        // Per-device sign-out: this exact session's sid was revoked, so refuse
        // it while leaving the user's other sessions alone. A separate indexed
        // lookup; fail OPEN on a DB blip, like the user read above (the absolute
        // ceiling still bounds any session).
        if (token.sid) {
          try {
            const revoked = await db.revokedSession.findUnique({
              where: { sid: token.sid as string },
              select: { sid: true },
            });
            if (revoked) return null;
          } catch (err) {
            console.error("[auth] revoked-session check failed:", err);
          }
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
