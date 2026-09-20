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
  /// Who the student belongs to. Null when nobody was assigned — see
  /// `ownerOf` for why that is a real state on this system.
  assignedICRId: string | null;
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
      assignedICRId: true,
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
    assignedICRId: r.assignedICRId,
  }));
}

/** The student's name, using the codebase's shared formatter. */
export function leadDisplayName(lead: CapturedLead): string {
  return displayName({ firstName: lead.firstName, lastName: lead.lastName });
}

/**
 * Who a student's email is about.
 *
 * ★ THE ASSIGNED ICR, falling back to whoever captured the record.
 *
 * The owner is the point: "if an ICR is added as ICR then they should get an
 * email, plus their manager". When an administrator captures on an ICR's
 * behalf, it is the ICR who has work to do, not the administrator.
 *
 * The fallback is not defensive padding — it is reachable today.
 * `offline-sync` sets `assignedICRId` only when the capturer's role is
 * literally ICR, and PRODUCTION HAS NO ICR-ROLE USERS, so every booth upload
 * there lands unassigned. Without the fallback those batches would notify
 * nobody at all, which is the silent-nothing failure this whole module exists
 * to avoid. (The assignment gap itself is a separate bug, noted in the PR.)
 */
function ownerOf(lead: CapturedLead, capturedByUserId: string): string {
  return lead.assignedICRId ?? capturedByUserId;
}

/**
 * Tells each student's owner, and that owner's manager, what has arrived.
 *
 * ONE email per person, however many students are in the batch.
 *
 * Leads are GROUPED BY OWNER rather than assumed to share one. A batch today
 * always does — both routes assign uniformly — but a bulk import that assigned
 * per row would otherwise send every ICR the whole batch, including students
 * belonging to colleagues they may not be allowed to see. Grouping costs a few
 * lines and removes that possibility permanently.
 *
 * Call it WITHOUT awaiting. It swallows everything: a notification must never
 * fail a request that has already written a student to the database.
 *
 * `leadIds` should contain only rows created on this attempt. The offline
 * route also reports "already synced" rows, and re-announcing a student
 * because a phone finally found signal would report old work as new.
 */
export async function notifyNewLeads(opts: {
  leadIds: string[];
  /// Fallback owner, used for any lead that was left unassigned.
  capturedByUserId: string;
  batch?: { submitted: number; created: number; failed: number };
}): Promise<void> {
  try {
    if (opts.leadIds.length === 0) return;

    // Imported here rather than at module scope: lib/email.ts pulls in the
    // mail client, and this module is imported by routes that must stay cheap
    // when no notification is due.
    const { sendNewLeadEmail } = await import("@/lib/email");

    const leads = await loadLeadsForNotification(opts.leadIds);
    if (leads.length === 0) return;

    const base = process.env.NEXTAUTH_URL ?? "";
    const listUrl = `${base}/students`;

    const byOwner = new Map<string, CapturedLead[]>();
    for (const lead of leads) {
      const owner = ownerOf(lead, opts.capturedByUserId);
      const bucket = byOwner.get(owner);
      if (bucket) bucket.push(lead);
      else byOwner.set(owner, [lead]);
    }

    await Promise.all(
      [...byOwner.entries()].map(async ([ownerId, ownerLeads]) => {
        const [owner, manager] = await Promise.all([
          db.user.findUnique({
            where: { id: ownerId },
            select: { email: true, name: true },
          }),
          resolveManager(ownerId),
        ]);

        const icrName = owner?.name ?? "Your colleague";
        const rows = ownerLeads.map((l) => ({
          name: leadDisplayName(l),
          url: `${base}/students/${l.id}`,
          possibleDuplicate: !!l.possibleDuplicate,
          // Order matters: the batch email shows only the first three.
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

        // The per-owner batch figures. A mixed batch must not tell one ICR
        // that forty students arrived when three of them are theirs.
        const batch = opts.batch
          ? { ...opts.batch, created: ownerLeads.length }
          : undefined;

        // Sent independently: safeSend never throws, so one address failing
        // cannot stop the other being tried.
        await Promise.all([
          owner?.email
            ? sendNewLeadEmail({
                to: owner.email,
                recipientName: owner.name ?? "there",
                icrName,
                isManagerCopy: false,
                leads: rows,
                batch,
                listUrl,
              })
            : Promise.resolve(),
          // Guarded against a manager who is also the owner — they would
          // otherwise get the same event twice, once addressed to someone else.
          manager && manager.email !== owner?.email
            ? sendNewLeadEmail({
                to: manager.email,
                recipientName: manager.name,
                icrName,
                isManagerCopy: true,
                leads: rows,
                batch,
                listUrl,
              })
            : Promise.resolve(),
        ]);

        // In-app notification for the manager only. The owner has either just
        // done this themselves, or already gets a "new lead assigned" bell
        // entry from the create route; a second one would be noise. The email
        // is a record they can forward, which is a different job.
        if (manager) {
          const managerUser = await db.user.findFirst({
            where: { email: manager.email },
            select: { id: true },
          });
          if (managerUser && managerUser.id !== ownerId) {
            const one = ownerLeads.length === 1;
            await db.notification.create({
              data: {
                userId: managerUser.id,
                title: one ? "New student captured" : `${ownerLeads.length} new students captured`,
                message: one
                  ? `${icrName} added ${leadDisplayName(ownerLeads[0])}`
                  : `${icrName} added ${ownerLeads.length} students`,
                type: "LEAD_CAPTURED",
                link: one ? `/students/${ownerLeads[0].id}` : "/students",
              },
            });
          }
        }
      })
    );
  } catch (err) {
    // Never rethrow. The students are already saved; this is an announcement.
    console.error("[lead-notifications] Failed to notify:", err);
  }
}
