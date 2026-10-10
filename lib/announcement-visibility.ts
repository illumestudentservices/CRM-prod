import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Who an announcement is for.
 *
 * ★ THE FAULT THIS EXISTS TO CLOSE.
 *
 * Announcement has carried isGlobal and regionId since it was written, and the
 * feed never looked at either. You could post "South Asia only", watch it save
 * the region, and it went to all 101 people. Nothing threw and nothing warned:
 * a leaked announcement looks exactly like a global one, so the only way to
 * notice was to be in the wrong region and read something not meant for you.
 *
 * The rule is deliberately simple, because a complicated one here is a
 * confidentiality bug waiting to happen:
 *
 *   - isGlobal           → everyone
 *   - regional           → people whose User.regionId matches
 *   - regional, and you  → you still see your own, so an author in another
 *     have write access     region can check what they posted rather than
 *                           wondering whether it worked
 *
 * Someone with no region set sees global announcements only. That is the safe
 * default: showing them every region's notices would be the same leak by a
 * different route.
 */

/** Rows a given user is allowed to see, as a Prisma `where`. */
export function visibleAnnouncementWhere(user: {
  id: string;
  regionId?: string | null;
}): Prisma.AnnouncementWhereInput {
  const now = new Date();

  const audience: Prisma.AnnouncementWhereInput[] = [{ isGlobal: true }];
  if (user.regionId) {
    audience.push({ isGlobal: false, regionId: user.regionId });
  }
  // Your own posts, whatever region they were aimed at.
  audience.push({ authorId: user.id });

  return {
    AND: [
      { publishedAt: { lte: now } },
      { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      { OR: audience },
    ],
  };
}

/** True when this user should be able to open this one announcement. */
export async function canSeeAnnouncement(
  user: { id: string; regionId?: string | null },
  announcementId: string,
): Promise<boolean> {
  const hit = await db.announcement.findFirst({
    where: { AND: [{ id: announcementId }, visibleAnnouncementWhere(user)] },
    select: { id: true },
  });
  return !!hit;
}

/**
 * The user ids to notify about a newly posted announcement.
 *
 * The author is left out — telling somebody about the thing they just typed is
 * noise, and it is the one notification guaranteed to be useless.
 */
export async function announcementAudience(a: {
  isGlobal: boolean;
  regionId: string | null;
  authorId: string | null;
}): Promise<string[]> {
  const rows = await db.user.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      isServiceAccount: false,
      // Clients are not staff; the feed already returns nothing to them.
      role: { not: "INSTITUTION_CLIENT" },
      ...(a.isGlobal ? {} : { regionId: a.regionId }),
    },
    select: { id: true },
  });
  return rows.map((r) => r.id).filter((id) => id !== a.authorId);
}
