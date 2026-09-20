import { db } from "@/lib/db";
import { displayName } from "@/lib/person-name";

/**
 * Who hears about a newly captured student, and how.
 *
 * One rule, two shapes: the ICR who captured the student and that ICR's manager
 * each get one email. A booth upload of forty students sends ONE summary each,
 * not forty — the point of the notification is "work has arrived", and forty
 * copies of that is not forty times more useful.
 *
 * Nothing here throws. A notification that fails must never cost a student
 * record, which is the whole contract of `safeSend` in lib/email.ts. The two
 * callers deliberately do not await this.
 */

export type CapturedLead = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  nationality: string | null;
  countryOfResidence: string | null;
  interestedProgram: string | null;
  intakeYear: number | null;
  intakeMonth: number | null;
  institutionName: string | null;
  possibleDuplicate?: boolean;
};

export type Recipient = { email: string; name: string };

/**
 * The ICR's manager.
 *
 * ★ RESOLVED FROM `Employee.managerId` FIRST, NOT FROM THE REGION.
 *
 * `lib/interest-automation.ts` finds a manager by looking for a
 * REGIONAL_MANAGER in the same region, and copying that here would have been
 * the obvious move. Measured on production it is close to useless:
 *
 *   manager found via Employee.managerId  -> 14 of 16 active users
 *   manager found via region              ->  2 of 16
 *
 * Only 6 of 16 users have a region at all, and just 3 of 8 regions have a
 * manager in them. Region-first would have sent nothing for almost everybody
 * while looking like it worked — and silently, since there is no error when a
 * lookup simply finds nobody.
 *
 * Region is kept as a fallback because it is right when it does resolve, and a
 * new starter may have a region before anyone sets their manager.
 *
 * Returns null when neither resolves. That is a real state, not a failure: the
 * ICR still gets their own email, and nobody is spammed as a stand-in. Do NOT
 * "fix" this by falling back to the super admins — on a busy day that turns
 * every capture into admin inbox noise, which is how people learn to ignore the
 * alert that matters.
 */
export async function resolveManager(userId: string): Promise<Recipient | null> {
  const employee = await db.employee.findFirst({
    where: { userId },
    select: {
      manager: {
        select: {
          user: {
            select: { id: true, email: true, name: true, isActive: true, deletedAt: true },
          },
        },
      },
    },
  });

  const viaEmployee = employee?.manager?.user;
  if (viaEmployee?.email && viaEmployee.isActive && !viaEmployee.deletedAt && viaEmployee.id !== userId) {
    return { email: viaEmployee.email, name: viaEmployee.name ?? "Manager" };
  }

  // Fallback: a Regional Manager covering the same region.
  const self = await db.user.findUnique({
    where: { id: userId },
    select: { regionId: true },
  });
  if (!self?.regionId) return null;

  const rm = await db.user.findFirst({
    where: {
      role: "REGIONAL_MANAGER",
      regionId: self.regionId,
      isActive: true,
      deletedAt: null,
      // An RM capturing their own lead is not their own manager.
      id: { not: userId },
    },
    select: { email: true, name: true },
    orderBy: { name: "asc" },
  });

  return rm?.email ? { email: rm.email, name: rm.name ?? "Manager" } : null;
}

/** "Sep 2027", or an em dash when the intake is not yet known. */
export function intakeLabel(year: number | null, month: number | null): string {
  if (!year) return "—";
  if (!month || month < 1 || month > 12) return String(year);
  const name = new Date(2000, month - 1, 1).toLocaleString("en-GB", { month: "short" });
  return `${name} ${year}`;
}

/**
 * Loads the fields an email needs for a set of leads.
 *
 * Re-read from the database rather than passed in from the caller, so the two
 * creation paths cannot drift into sending different details for the same
 * event. The institution is flattened to a name here because the template
 * should not have to know the shape of a Prisma include.
 */
export async function loadLeadsForNotification(leadIds: string[]): Promise<CapturedLead[]> {
  if (leadIds.length === 0) return [];
  const rows = await db.lead.findMany({
    where: { id: { in: leadIds } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      nationality: true,
      countryOfResidence: true,
      interestedProgram: true,
      intakeYear: true,
      intakeMonth: true,
      isDuplicate: true,
      institution: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    firstName: r.firstName,
    lastName: r.lastName,
    email: r.email,
    phone: r.phone,
    nationality: r.nationality,
    countryOfResidence: r.countryOfResidence,
    interestedProgram: r.interestedProgram,
    intakeYear: r.intakeYear,
    intakeMonth: r.intakeMonth,
    institutionName: r.institution?.name ?? null,
    possibleDuplicate: r.isDuplicate,
  }));
}

/** The student's name, using the codebase's shared formatter. */
export function leadDisplayName(lead: CapturedLead): string {
  return displayName({ firstName: lead.firstName, lastName: lead.lastName });
}

/**
 * Tells the ICR and their manager that students have been captured.
 *
 * ONE email each, however many students are in the batch.
 *
 * Call it WITHOUT awaiting. It swallows everything: a notification must never
 * be able to fail a request that has already written a student to the database.
 * The two creation routes both do `void notifyNewLeads(...)`.
 *
 * `leadIds` should contain only rows that were actually created. The offline
 * route also reports "already synced" rows, and re-announcing a student the ICR
 * captured last week because their phone finally found signal would be wrong.
 */
export async function notifyNewLeads(opts: {
  leadIds: string[];
  /// The user who captured them, which is not always the assignee.
  capturedByUserId: string;
  batch?: { submitted: number; created: number; failed: number };
}): Promise<void> {
  try {
    if (opts.leadIds.length === 0) return;

    // Imported here rather than at module scope: lib/email.ts pulls in the
    // Brevo client, and this module is imported by routes that must stay
    // cheap when no notification is due.
    const { sendNewLeadEmail } = await import("@/lib/email");

    const [icr, leads] = await Promise.all([
      db.user.findUnique({
        where: { id: opts.capturedByUserId },
        select: { email: true, name: true },
      }),
      loadLeadsForNotification(opts.leadIds),
    ]);
    if (leads.length === 0) return;

    const icrName = icr?.name ?? "Your colleague";
    const base = process.env.NEXTAUTH_URL ?? "";
    const listUrl = `${base}/students`;

    const rows = leads.map((l) => ({
      name: leadDisplayName(l),
      url: `${base}/students/${l.id}`,
      possibleDuplicate: !!l.possibleDuplicate,
      // Order matters: the batch email shows only the first three of these.
      detail: [
        ["Programme", l.interestedProgram || "—"],
        ["Intake", intakeLabel(l.intakeYear, l.intakeMonth)],
        ["Nationality", l.nationality || "—"],
        ["Living in", l.countryOfResidence || "—"],
        ["Email", l.email || "—"],
        ["Phone", l.phone || "—"],
        ["Institution", l.institutionName || "Not chosen yet"],
      ] as [string, string][],
    }));

    const manager = await resolveManager(opts.capturedByUserId);

    // Sent in parallel, and independently: `safeSend` never throws, so one
    // address failing cannot stop the other being tried.
    await Promise.all([
      icr?.email
        ? sendNewLeadEmail({
            to: icr.email,
            recipientName: icr.name ?? "there",
            icrName,
            isManagerCopy: false,
            leads: rows,
            batch: opts.batch,
            listUrl,
          })
        : Promise.resolve(),
      // Guarded against a manager who is somehow also the capturer — they would
      // otherwise get the same event twice, once addressed to someone else.
      manager && manager.email !== icr?.email
        ? sendNewLeadEmail({
            to: manager.email,
            recipientName: manager.name,
            icrName,
            isManagerCopy: true,
            leads: rows,
            batch: opts.batch,
            listUrl,
          })
        : Promise.resolve(),
    ]);

    // In-app notification for the manager only. The ICR just did this, so
    // telling them about it in the bell menu is noise; the email is a record
    // they can forward, which is a different job.
    if (manager) {
      const managerUser = await db.user.findFirst({
        where: { email: manager.email },
        select: { id: true },
      });
      if (managerUser && managerUser.id !== opts.capturedByUserId) {
        await db.notification.create({
          data: {
            userId: managerUser.id,
            title: leads.length === 1 ? "New student captured" : `${leads.length} new students captured`,
            message:
              leads.length === 1
                ? `${icrName} added ${leadDisplayName(leads[0])}`
                : `${icrName} added ${leads.length} students`,
            type: "LEAD_CAPTURED",
            link: leads.length === 1 ? `/students/${leads[0].id}` : "/students",
          },
        });
      }
    }
  } catch (err) {
    // Never rethrow. The students are already saved; this is an announcement.
    console.error("[lead-notifications] Failed to notify:", err);
  }
}
