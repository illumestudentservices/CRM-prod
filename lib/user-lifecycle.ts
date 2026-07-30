import { db } from "@/lib/db";

/**
 * Deactivation, soft deletion, restore, and permanent purge of user accounts.
 *
 * Three states, deliberately distinct:
 *
 *   active                 normal
 *   inactive               cannot sign in, still listed, fully reversible
 *   deleted (soft)         cannot sign in, hidden from the main list, restorable
 *                          for RECOVERY_WINDOW_DAYS, then anonymised
 *
 * Why anonymise rather than delete the row: nine foreign keys reference users
 * with ON DELETE RESTRICT on NOT NULL columns — leads.createdById,
 * employees.userId, monthly_reports.icrId, report_approvals.userId and others.
 * A hard delete of anyone who has ever created a lead or filed a report would
 * simply fail; relaxing those constraints would instead destroy the company's
 * own records. Stripping the personal data achieves the same outcome for the
 * individual while leaving business history intact and attributable.
 */

export const RECOVERY_WINDOW_DAYS = 30;

const DAY_MS = 86_400_000;

/** Days left before a soft-deleted account is anonymised. Negative once due. */
export function daysUntilPurge(deletedAt: Date | string | null | undefined, now: Date = new Date()): number | null {
  if (!deletedAt) return null;
  const t = typeof deletedAt === "string" ? Date.parse(deletedAt) : deletedAt.getTime();
  if (!Number.isFinite(t)) return null;
  return RECOVERY_WINDOW_DAYS - Math.floor((now.getTime() - t) / DAY_MS);
}

export function isPurgeDue(deletedAt: Date | string | null | undefined, now: Date = new Date()): boolean {
  const d = daysUntilPurge(deletedAt, now);
  return d !== null && d <= 0;
}

// ─── Guardrails ──────────────────────────────────────────────────────────────

export interface GuardResult {
  ok: boolean;
  reason?: string;
}

/**
 * Refuses the two ways an administrator can lock the organisation out of its
 * own system: removing their own access, and removing the last Super Admin.
 *
 * Checked for deactivation and deletion alike — an inactive Super Admin cannot
 * sign in, so leaving only inactive ones is the same lockout as deleting them.
 */
export async function guardUserRemoval(
  targetUserId: string,
  actingUserId: string,
  intent: "DEACTIVATE" | "DELETE"
): Promise<GuardResult> {
  if (targetUserId === actingUserId) {
    return {
      ok: false,
      reason:
        intent === "DELETE"
          ? "You cannot delete your own account. Ask another Super Admin."
          : "You cannot deactivate your own account. Ask another Super Admin.",
    };
  }

  const target = await db.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, role: true, isActive: true, deletedAt: true },
  });
  if (!target) return { ok: false, reason: "User not found." };
  if (target.deletedAt && intent === "DELETE") {
    return { ok: false, reason: "That account is already deleted." };
  }

  if (target.role === "SUPER_ADMIN") {
    // Count the ones that would still be able to sign in afterwards.
    const remaining = await db.user.count({
      where: {
        role: "SUPER_ADMIN",
        isActive: true,
        deletedAt: null,
        id: { not: targetUserId },
      },
    });
    if (remaining < 1) {
      return {
        ok: false,
        reason: `That is the last Super Admin who can still sign in. ${
          intent === "DELETE" ? "Deleting" : "Deactivating"
        } them would lock everyone out of user management. Promote another Super Admin first.`,
      };
    }
  }

  return { ok: true };
}

// ─── Purge ───────────────────────────────────────────────────────────────────

export interface PurgeSummary {
  dryRun: boolean;
  ranAt: string;
  purged: Array<{ id: string; email: string; deletedAt: string }>;
  skipped: Array<{ id: string; email: string; reason: string }>;
}

/**
 * Anonymises accounts whose recovery window has expired.
 *
 * Everything identifying is overwritten, and everything that could authenticate
 * is destroyed: password hash, MFA secret and backup codes, sessions, OAuth
 * links, and any outstanding reset tokens. What remains is a tombstone row so
 * that "who created this lead" still resolves.
 */
export async function purgeExpiredUsers(
  {
    dryRun = false,
    now = new Date(),
    userIds,
  }: {
    dryRun?: boolean;
    now?: Date;
    /**
     * Restrict the sweep to specific accounts.
     *
     * The scheduled job leaves this unset and processes everything due, which
     * is its purpose. Anything else — a test, or an administrator purging one
     * account early — should scope it: this is irreversible, and a helper whose
     * only mode is "anonymise every expired account in the database" is far too
     * blunt an instrument to invoke casually.
     */
    userIds?: string[];
  } = {}
): Promise<PurgeSummary> {
  const cutoff = new Date(now.getTime() - RECOVERY_WINDOW_DAYS * DAY_MS);

  const candidates = await db.user.findMany({
    where: {
      deletedAt: { not: null, lte: cutoff },
      // Never process the same account twice; a purged row keeps its deletedAt.
      purgedAt: null,
      ...(userIds ? { id: { in: userIds } } : {}),
    },
    select: { id: true, email: true, role: true, deletedAt: true },
  });

  const summary: PurgeSummary = {
    dryRun,
    ranAt: now.toISOString(),
    purged: [],
    skipped: [],
  };

  for (const u of candidates) {
    // Belt and braces. A Super Admin should never reach this state because the
    // guard blocks deleting the last one, but a purge is irreversible and the
    // check is cheap.
    if (u.role === "SUPER_ADMIN") {
      const others = await db.user.count({
        where: { role: "SUPER_ADMIN", isActive: true, deletedAt: null },
      });
      if (others < 1) {
        summary.skipped.push({
          id: u.id,
          email: u.email,
          reason: "last Super Admin — refusing to purge",
        });
        continue;
      }
    }

    if (dryRun) {
      summary.purged.push({
        id: u.id,
        email: u.email,
        deletedAt: u.deletedAt!.toISOString(),
      });
      continue;
    }

    // The email must stay unique, so it becomes a non-routable placeholder
    // rather than null. .invalid is reserved by RFC 2606 and can never resolve.
    const tombstone = `deleted-${u.id}@invalid`;

    await db.$transaction([
      db.session.deleteMany({ where: { userId: u.id } }),
      db.account.deleteMany({ where: { userId: u.id } }),
      db.passwordResetToken.deleteMany({ where: { userId: u.id } }),
      db.passwordHistory.deleteMany({ where: { userId: u.id } }),
      db.notification.deleteMany({ where: { userId: u.id } }),
      db.user.update({
        where: { id: u.id },
        data: {
          email: tombstone,
          name: "Deleted user",
          image: null,
          password: null,
          emailVerified: null,
          twoFactorEnabled: false,
          twoFactorSecret: null,
          twoFactorBackupCodes: [],
          isActive: false,
          regionId: null,
          mustChangePassword: false,
          passwordChangedAt: null,
          loginAttempts: 0,
          lockedUntil: null,
          sessionsRevokedAt: now,
          purgedAt: now,
        },
      }),
      db.auditLog.create({
        data: {
          // No actor: this is the scheduled job, not a person.
          action: "USER_PURGED",
          entity: "User",
          entityId: u.id,
          changes: {
            previousEmail: u.email,
            deletedAt: u.deletedAt!.toISOString(),
            note: "Personal data anonymised after the recovery window. Row retained because business records reference it.",
          },
        },
      }),
    ]);

    summary.purged.push({
      id: u.id,
      email: u.email,
      deletedAt: u.deletedAt!.toISOString(),
    });
  }

  return summary;
}
