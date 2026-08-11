import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity-logger";
import { sendSecurityAlertEmail, getSuperAdminEmails } from "@/lib/email";
import { guardUserRemoval, RECOVERY_WINDOW_DAYS } from "@/lib/user-lifecycle";
import { trashRecord } from "@/lib/recycle-bin";

/**
 * Soft delete and restore.
 *
 * Deletion is reversible for RECOVERY_WINDOW_DAYS and then anonymised by the
 * scheduled purge. Both operations revoke sessions immediately — a deleted
 * account that stays signed in is the failure this exists to prevent.
 */

// ─── DELETE: soft delete ─────────────────────────────────────────────────────

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const guard = await guardUserRemoval(id, session.user.id, "DELETE");
  if (!guard.ok) return NextResponse.json({ error: guard.reason }, { status: 400 });

  const target = await db.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, role: true, isActive: true },
  });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const now = new Date();
  // Route the soft-delete through the recycle bin so it appears alongside
  // every other trashed item. trashRecord sets deletedAt; the additional
  // session-revocation + isActive flags stay under this endpoint's control.
  await trashRecord({ entityType: "User", entityId: id, userId: session.user.id });
  const updated = await db.user.update({
    where: { id },
    data: {
      // Deactivated as well, so nothing anywhere treats them as a live account
      // if deletedAt is ever missed by a query.
      isActive: false,
      // Kills every session they hold on their next request.
      sessionsRevokedAt: now,
    },
    select: { id: true, email: true, deletedAt: true },
  });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "USER_DELETED",
      entity: "User",
      entityId: id,
      changes: {
        email: target.email,
        role: target.role,
        recoverableUntil: new Date(now.getTime() + RECOVERY_WINDOW_DAYS * 86_400_000).toISOString(),
      },
    },
  });

  void logActivity(session.user.id, "DELETE", "User", id, { email: target.email });

  // Fire-and-forget so a mail failure cannot fail the deletion itself.
  getSuperAdminEmails()
    .then((admins) => {
      if (!admins.length) return;
      return sendSecurityAlertEmail({
        to: admins,
        alertType: "ACCOUNT_DEACTIVATED",
        targetName: target.name ?? target.email,
        targetEmail: target.email,
        changedBy: session.user.name ?? session.user.email ?? "Admin",
        details: {
          Action: "Account deleted",
          Recoverable: `${RECOVERY_WINDOW_DAYS} days`,
          Role: target.role,
        },
        actionUrl: `${process.env.NEXTAUTH_URL ?? ""}/settings`,
      });
    })
    .catch(() => {});

  return NextResponse.json({ user: updated, recoveryWindowDays: RECOVERY_WINDOW_DAYS });
}

// ─── POST: restore ───────────────────────────────────────────────────────────

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const target = await db.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, deletedAt: true, purgedAt: true },
  });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (!target.deletedAt) {
    return NextResponse.json({ error: "That account is not deleted." }, { status: 400 });
  }
  if (target.purgedAt) {
    return NextResponse.json(
      {
        error:
          "That account was permanently anonymised after its recovery window and cannot be restored. Create a new account instead.",
      },
      { status: 410 }
    );
  }

  const updated = await db.user.update({
    where: { id },
    data: {
      deletedAt: null,
      // Deliberately left inactive. Restoring returns the record, not the
      // access — an administrator re-enables the account explicitly, so a
      // restore can never silently hand someone their login back.
      isActive: false,
    },
    select: { id: true, email: true, isActive: true, deletedAt: true },
  });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "USER_RESTORED",
      entity: "User",
      entityId: id,
      changes: { email: target.email, note: "Restored as inactive; access must be re-enabled explicitly." },
    },
  });

  return NextResponse.json({ user: updated });
}
