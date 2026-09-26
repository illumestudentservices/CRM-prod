import { db } from "@/lib/db";

/**
 * Tells every super admin when something consequential and hard to undo has
 * happened.
 *
 * ★ WHAT COUNTS AS SERIOUS, AND WHY THESE.
 *
 * Not "anything privileged" — an admin doing routine admin work all day would
 * bury the one message that mattered, and a buried alert is the same as no
 * alert. The list below is deliberately short and shares one property: each
 * either DESTROYS data, MOVES a lot of it at once, or CHANGES WHO CAN DO WHAT.
 * Those are the actions you would want to find in an inbox the morning after,
 * whether or not anyone thought to check an audit log.
 *
 * Every one of them previously notified nobody at all.
 *
 * Account and identity events — role changes, deactivations, new users, MFA
 * enrolment — are NOT here. They already go out through
 * `sendSecurityAlertEmail`, and duplicating them would be noise.
 *
 * ★ THE ACTOR IS EMAILED TOO, EVEN THOUGH THEY JUST DID IT.
 *
 * Elsewhere in this codebase the person who performed an action is
 * deliberately not told about it — telling someone what they just did is
 * noise. This is the exception, and on purpose: the point of a security alert
 * is that it reaches you when YOUR account did something YOU did not do. Drop
 * the actor and a stolen session becomes the one case that is never reported.
 *
 * Nothing here throws. An alert must never be able to fail the operation it is
 * reporting — the data is already gone, moved or re-permissioned.
 */

export type AdminAlertAction =
  /** Records destroyed permanently from the recycle bin. */
  | "RECYCLE_BIN_PURGED"
  /** A user account deleted outright. */
  | "USER_DELETED"
  /** The role/permission matrix changed. */
  | "PERMISSIONS_CHANGED"
  /** Field- or capability-level permissions changed. */
  | "GRANULAR_PERMISSIONS_CHANGED"
  /** Someone's second factor reset by an administrator. */
  | "MFA_RESET_FOR_USER"
  /** A whole caseload moved between people. */
  | "WORKLOAD_REASSIGNED"
  /** Two student records merged into one. */
  | "LEADS_MERGED"
  /** The "work is still owned" block on revoking access was overridden. */
  | "OFFBOARDING_REVOKE_OVERRIDE"
  /** The entire staff directory left the system as a file. */
  | "STAFF_DIRECTORY_EXPORTED";

const LABELS: Record<AdminAlertAction, { title: string; why: string }> = {
  RECYCLE_BIN_PURGED: {
    title: "Recycle bin purged",
    why: "Deleted records were destroyed permanently and cannot be restored from the app.",
  },
  USER_DELETED: {
    title: "User account deleted",
    why: "An account was removed. Anything it owned needs a new owner.",
  },
  PERMISSIONS_CHANGED: {
    title: "Permissions changed",
    why: "What a role can see and do across the system has been altered.",
  },
  GRANULAR_PERMISSIONS_CHANGED: {
    title: "Field permissions changed",
    why: "Access to specific fields or capabilities has been altered.",
  },
  MFA_RESET_FOR_USER: {
    title: "Two-factor reset for another user",
    why: "That account can now enrol a new device. If this was not requested by them, treat it as an account takeover attempt.",
  },
  WORKLOAD_REASSIGNED: {
    title: "Workload reassigned in bulk",
    why: "A caseload was moved between people in one operation.",
  },
  LEADS_MERGED: {
    title: "Student records merged",
    why: "Two records became one. The merged record's own history is now on the survivor.",
  },
  STAFF_DIRECTORY_EXPORTED: {
    title: "Staff directory exported",
    why: "Every employee record, including home addresses and next of kin, has left the system as a file. Confirm who asked for it and where it is being stored.",
  },
  OFFBOARDING_REVOKE_OVERRIDE: {
    title: "Access revocation override",
    why: "Access was revoked while work was still owned by that person, bypassing the block.",
  },
};

export type AdminAlert = {
  action: AdminAlertAction;
  /** Who did it. */
  actorName: string;
  actorEmail: string;
  /** One sentence naming what was affected, e.g. "40 records across 6 tables". */
  summary: string;
  /** Extra rows for the detail table. */
  detail?: [string, string][];
  /** App-relative link to the relevant screen, if there is one. */
  link?: string;
  /** Where the request came from, when the caller has it. */
  ip?: string | null;
};

/**
 * Sends the alert. Call WITHOUT awaiting — the operation has already happened.
 */
export async function notifyAdmins(alert: AdminAlert): Promise<void> {
  try {
    const admins = await db.user.findMany({
      where: { role: "SUPER_ADMIN", isActive: true, deletedAt: null },
      select: { id: true, email: true, name: true },
    });
    if (admins.length === 0) {
      // Reported rather than swallowed: a system with no reachable
      // administrator is itself worth knowing about.
      console.warn(
        `[admin-alerts] ${alert.action} by ${alert.actorEmail} — NO ACTIVE SUPER ADMIN to tell`
      );
      return;
    }

    const meta = LABELS[alert.action];
    const { sendAdminAlertEmail } = await import("@/lib/email");

    await Promise.all(
      admins
        .filter((a) => a.email)
        .map((a) =>
          sendAdminAlertEmail({
            to: a.email,
            recipientName: a.name ?? "there",
            title: meta.title,
            why: meta.why,
            summary: alert.summary,
            actorName: alert.actorName,
            actorEmail: alert.actorEmail,
            detail: alert.detail ?? [],
            link: alert.link,
            ip: alert.ip ?? null,
          })
        )
    );

    // In-app as well, so it is visible to whoever looks at the app first.
    await db.notification
      .createMany({
        data: admins.map((a) => ({
          userId: a.id,
          title: meta.title,
          message: `${alert.summary} — by ${alert.actorName}`,
          type: "ADMIN_ALERT",
          link: alert.link ?? "/activity-log",
        })),
      })
      .catch(() => { /* the email is the primary channel */ });
  } catch (err) {
    // Never rethrow. The action has already happened; this is the report.
    console.error("[admin-alerts] failed to notify:", err);
  }
}
