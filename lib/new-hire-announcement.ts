import { db } from "@/lib/db";
import { announcementAudience } from "@/lib/announcement-visibility";

/**
 * Announce a new joiner to the company.
 *
 * Posted automatically when an employee is created through the new-hire form,
 * so welcoming somebody is not a thing anybody has to remember to do.
 *
 * ★ WHAT IS IN IT, AND WHAT IS DELIBERATELY NOT.
 *
 * Name, job title, department, region, start date and who they report to —
 * what a colleague needs in order to place them. No email address, no phone
 * number, no personal details: those live in the staff directory, behind the
 * permissions that exist for them, and an announcement is the one object in
 * this system that is deliberately broadcast to everyone. Widening what it
 * carries is how personal data ends up in a hundred inboxes and in whatever
 * those inboxes sync to.
 *
 * ★ IT EXPIRES.
 *
 * Thirty days. A welcome is news for a few weeks and clutter after that, and
 * the feed shows the fifty most recent — without an expiry, a year of joiners
 * would push out everything a reader actually needs to see.
 *
 * ★ WHO IS LEFT OUT.
 *
 * The new joiner, and whoever created the record. Telling someone "please
 * welcome yourself" is the one notification guaranteed to be useless, and the
 * new joiner is at that moment receiving a welcome email of their own and
 * cannot sign in yet to read anything else.
 *
 * ★ THE COMPANY-WIDE AUDIENCE IS NOT A WAY ROUND THE REACH RULE.
 *
 * This posts globally without consulting announcements:approve, which would
 * matter if a region-scoped author could trigger it. They cannot: creating an
 * employee is restricted to HR_MANAGER and SUPER_ADMIN, and both hold approve
 * already. If hiring is ever opened to another role, this is the line that has
 * to be revisited.
 */

const VISIBLE_FOR_DAYS = 30;

export type NewHireAnnouncementResult = {
  announcementId: string;
  notified: number;
  emailed: number;
  emailFailed: number;
};

export async function postNewHireAnnouncement(opts: {
  /** Employee.id, not the employeeId code. */
  employeeId: string;
  /** Who created the record; becomes the author. */
  actorUserId: string;
  /** Skips the email half. The in-app announcement is still posted. */
  skipEmail?: boolean;
}): Promise<NewHireAnnouncementResult | null> {
  const employee = await db.employee.findUnique({
    where: { id: opts.employeeId },
    select: {
      employeeId: true,
      jobTitle: true,
      startDate: true,
      department: { select: { name: true } },
      manager: { select: { user: { select: { name: true, firstName: true, lastName: true } } } },
      user: {
        select: {
          id: true, name: true, firstName: true, lastName: true,
          region: { select: { name: true } },
        },
      },
    },
  });
  if (!employee) return null;

  const name =
    employee.user.name ||
    [employee.user.firstName, employee.user.lastName].filter(Boolean).join(" ") ||
    employee.employeeId;

  const managerName =
    employee.manager?.user.name ||
    [employee.manager?.user.firstName, employee.manager?.user.lastName]
      .filter(Boolean).join(" ") ||
    null;

  const startDate = employee.startDate.toLocaleDateString("en-CA", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });

  const lines = [
    `${name} is joining Illume as ${employee.jobTitle}.`,
    "",
    `Starting: ${startDate}`,
  ];
  if (employee.department?.name) lines.push(`Team: ${employee.department.name}`);
  if (employee.user.region?.name) lines.push(`Region: ${employee.user.region.name}`);
  if (managerName) lines.push(`Reporting to: ${managerName}`);
  lines.push("", "Please join us in making them welcome.");

  const title = `Welcome to Illume, ${name}`;
  const content = lines.join("\n");

  const expiresAt = new Date(Date.now() + VISIBLE_FOR_DAYS * 24 * 60 * 60 * 1000);

  const announcement = await db.announcement.create({
    data: {
      title,
      content,
      authorId: opts.actorUserId,
      isGlobal: true,
      regionId: null,
      expiresAt,
    },
  });

  // announcementAudience already drops the author; the new joiner is dropped
  // here because they are the subject, not an audience for it.
  const audience = (
    await announcementAudience({
      isGlobal: true,
      regionId: null,
      authorId: opts.actorUserId,
    })
  ).filter((id) => id !== employee.user.id);

  let notified = 0;
  if (audience.length) {
    const { count } = await db.notification.createMany({
      data: audience.map((userId) => ({
        userId,
        title,
        message: content.slice(0, 500),
        type: "ANNOUNCEMENT",
        link: "/dashboard",
      })),
    });
    notified = count;
  }

  let emailed = 0;
  let emailFailed = 0;
  if (!opts.skipEmail && audience.length) {
    const { sendAnnouncementEmail } = await import("@/lib/email");
    const people = await db.user.findMany({
      where: { id: { in: audience } },
      select: { email: true, name: true, firstName: true },
    });
    for (const p of people) {
      // One failure must not cost everyone else their copy.
      try {
        const ok = await sendAnnouncementEmail({
          to: p.email,
          name: p.name || p.firstName || p.email,
          title,
          content,
        });
        if (ok) emailed++;
        else emailFailed++;
      } catch {
        emailFailed++;
      }
    }
  }

  return { announcementId: announcement.id, notified, emailed, emailFailed };
}
