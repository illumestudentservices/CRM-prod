import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { logActivity } from "@/lib/activity-logger";
import {
  visibleAnnouncementWhere,
  announcementAudience,
  authorReach,
} from "@/lib/announcement-visibility";

/**
 * ★ PERMISSION IS ASKED FOR, NOT HARD-CODED.
 *
 * This route used to carry its own list:
 *
 *     const ANNOUNCE_ROLES = ["HR_MANAGER", "SUPER_ADMIN", "HQ_EXECUTIVE"];
 *
 * which disagreed with PERMISSION_MATRIX — that grants VP_GLOBAL_SALES
 * announcements:["read","write"] — and ignored every override set in
 * Settings → Security. Granting the permission there changed nothing and the
 * screen gave no hint why. effectiveHasPermission is the one answer.
 */
const RESOURCE = "announcements" as const;

// A title has to fit a card and a notification line. Without a cap the field
// is @db.Text behind a single-line input, and a pasted paragraph is accepted
// as a "title" and then truncated by CSS in every place it is displayed.
const TITLE_MAX = 200;
const CONTENT_MAX = 20_000;

const createAnnouncementSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(TITLE_MAX),
    content: z.string().trim().min(1, "Content is required").max(CONTENT_MAX),
    isGlobal: z.boolean().default(true),
    regionId: z.string().min(1).optional().nullable(),
    expiresAt: z.coerce.date().optional().nullable(),
    /** Also send it as an email. Off unless asked for — see POST. */
    notifyByEmail: z.boolean().default(false),
  })
  .refine((v) => v.isGlobal || !!v.regionId, {
    message: "Choose a region, or make the announcement company-wide",
    path: ["regionId"],
  });

// ─── GET /api/hr/announcements ────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role === "INSTITUTION_CLIENT") {
    return NextResponse.json({ announcements: [] });
  }

  const me = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, regionId: true },
  });
  if (!me) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db.announcement.findMany({
    where: visibleAnnouncementWhere(me),
    include: {
      author: { select: { id: true, name: true, firstName: true, lastName: true } },
      region: { select: { id: true, name: true } },
      readReceipts: {
        where: { userId: me.id },
        select: { readAt: true },
      },
    },
    orderBy: { publishedAt: "desc" },
    take: 50,
  });

  const canWrite = await effectiveHasPermission(
    session.user.role as Role, RESOURCE, "write",
  );
  const canDelete = await effectiveHasPermission(
    session.user.role as Role, RESOURCE, "delete",
  );
  // "approve" is reach: may this person address the whole company, or only
  // their own region? The form asks so it can offer the right audience
  // rather than offering a choice the POST will refuse.
  const canApprove = await effectiveHasPermission(
    session.user.role as Role, RESOURCE, "approve",
  );

  /**
   * ★ isRead IS SENT, AND readReceipts IS KEPT.
   *
   * Two screens read this payload and they disagreed. The dashboard card
   * checks `readReceipts.length`; the HR tab renders on `isRead`, which
   * nothing ever set — so marking an announcement read wrote the row, the
   * card went quiet, and the HR tab stayed blue forever. Sending both ends
   * the disagreement without breaking either, and `author` is flattened to a
   * name so neither screen has to know about the relation.
   */
  const announcements = rows.map((a) => ({
    ...a,
    isRead: a.readReceipts.length > 0,
    authorName:
      a.author?.name ||
      [a.author?.firstName, a.author?.lastName].filter(Boolean).join(" ") ||
      null,
    regionName: a.region?.name ?? null,
  }));

  return NextResponse.json({
    announcements, canWrite, canDelete, canApprove,
    myRegionId: me.regionId ?? null,
  });
}

// ─── POST /api/hr/announcements ───────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await effectiveHasPermission(session.user.role as Role, RESOURCE, "write"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createAnnouncementSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const data = parsed.data;

  const me = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, regionId: true },
  });
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  /**
   * ★ WRITE SAYS YOU MAY POST. APPROVE SAYS HOW FAR IT GOES.
   *
   * A regional manager holds write and not approve, so they may address their
   * own region and nothing else. Refused rather than quietly rewritten: an
   * author who believes they have just told the whole company, and has not,
   * is worse off than one who gets an error.
   */
  const reach = authorReach(
    await effectiveHasPermission(session.user.role as Role, RESOURCE, "approve"),
    me,
  );
  if (reach.kind === "nowhere") {
    return NextResponse.json({ error: reach.why }, { status: 403 });
  }
  if (reach.kind === "ownRegion") {
    if (data.isGlobal) {
      return NextResponse.json(
        { error: "You can only post to your own region, not to everyone at Illume." },
        { status: 403 },
      );
    }
    if (data.regionId && data.regionId !== reach.regionId) {
      return NextResponse.json(
        { error: "You can only post to your own region." },
        { status: 403 },
      );
    }
  }

  const isGlobal = reach.kind === "ownRegion" ? false : data.isGlobal;
  const regionId = isGlobal
    ? null
    : (reach.kind === "ownRegion" ? reach.regionId : (data.regionId ?? null));

  // regionId now has a foreign key, so a bad one would fail at the database
  // with a 500. Checked here instead, to answer 422 with something a person
  // can act on.
  if (regionId) {
    const region = await db.region.findUnique({ where: { id: regionId }, select: { id: true } });
    if (!region) {
      return NextResponse.json(
        { error: "Validation failed", details: { fieldErrors: { regionId: ["No such region"] } } },
        { status: 422 }
      );
    }
  }

  if (data.expiresAt && data.expiresAt.getTime() <= Date.now()) {
    return NextResponse.json(
      {
        error: "Validation failed",
        details: { fieldErrors: { expiresAt: ["That date has already passed"] } },
      },
      { status: 422 }
    );
  }

  const announcement = await db.announcement.create({
    data: {
      title: data.title,
      content: data.content,
      authorId: session.user.id,
      isGlobal,
      regionId,
      expiresAt: data.expiresAt ?? null,
    },
  });

  void logActivity(session.user.id, "CREATE", "Announcement", announcement.id, {
    route: "hr/announcements",
    isGlobal,
    regionId,
    reach: reach.kind,
  });

  /**
   * ★ POSTING NOW TELLS SOMEBODY.
   *
   * Before this, the only way to learn of an announcement was to happen to
   * open the dashboard, which for staff who have barely signed in means never.
   * An in-app notification goes to the audience every time — it is free and
   * nobody's inbox suffers.
   *
   * Email is OPT-IN and defaults to off. One careless tick should not be able
   * to mail a hundred people, and most announcements do not warrant it.
   *
   * Fire-and-forget: a notification that fails must not fail the post, which
   * is already written.
   */
  void (async () => {
    try {
      const audience = await announcementAudience({
        isGlobal: announcement.isGlobal,
        regionId: announcement.regionId,
        authorId: announcement.authorId,
      });
      if (!audience.length) return;

      await db.notification.createMany({
        data: audience.map((userId) => ({
          userId,
          title: announcement.title,
          message: announcement.content.slice(0, 500),
          type: "ANNOUNCEMENT",
          link: "/dashboard",
        })),
      });

      if (data.notifyByEmail) {
        const { sendAnnouncementEmail } = await import("@/lib/email");
        const people = await db.user.findMany({
          where: { id: { in: audience } },
          select: { email: true, name: true, firstName: true },
        });
        for (const p of people) {
          await sendAnnouncementEmail({
            to: p.email,
            name: p.name || p.firstName || p.email,
            title: announcement.title,
            content: announcement.content,
          });
        }
      }
    } catch (err) {
      console.error("[POST /api/hr/announcements] notifying failed:", err);
    }
  })();

  return NextResponse.json({ announcement }, { status: 201 });
}
