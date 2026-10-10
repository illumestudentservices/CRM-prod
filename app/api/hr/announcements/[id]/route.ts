import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { logActivity } from "@/lib/activity-logger";
import { visibleAnnouncementWhere } from "@/lib/announcement-visibility";

/**
 * Correcting and withdrawing an announcement.
 *
 * ★ NEITHER OF THESE EXISTED.
 *
 * You could post, and that was all. A typo in something sent to the whole
 * company was permanent; an announcement posted by mistake stayed up until its
 * expiry date, and the form had no expiry field, so in practice it stayed up
 * for good. The only remedy was a database edit.
 *
 * ★ WHO MAY CHANGE ONE.
 *
 * Editing needs announcements:write AND authorship — you may fix your own
 * wording. Deleting needs announcements:delete, which only SUPER_ADMIN holds,
 * because withdrawing a company-wide notice that people have already read and
 * acted on is a different act from fixing a typo in it. A super admin may do
 * both to anybody's.
 */
const RESOURCE = "announcements" as const;

const TITLE_MAX = 200;
const CONTENT_MAX = 20_000;

const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(TITLE_MAX).optional(),
    content: z.string().trim().min(1).max(CONTENT_MAX).optional(),
    isGlobal: z.boolean().optional(),
    regionId: z.string().min(1).nullable().optional(),
    expiresAt: z.coerce.date().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });

// ─── GET /api/hr/announcements/[id] ──────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const me = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, regionId: true },
  });
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Scoped, not just findUnique: a regional announcement must not be readable
  // by id simply because somebody has the id.
  const announcement = await db.announcement.findFirst({
    where: { AND: [{ id }, visibleAnnouncementWhere(me)] },
    include: {
      author: { select: { id: true, name: true, firstName: true, lastName: true } },
      region: { select: { id: true, name: true } },
    },
  });
  if (!announcement) {
    return NextResponse.json({ error: "Announcement not found" }, { status: 404 });
  }
  return NextResponse.json({ announcement });
}

// ─── PATCH /api/hr/announcements/[id] ────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const role = session.user.role as Role;

  if (!(await effectiveHasPermission(role, RESOURCE, "write"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const existing = await db.announcement.findUnique({
    where: { id },
    select: { id: true, authorId: true, isGlobal: true, regionId: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Announcement not found" }, { status: 404 });
  }

  const isOwner = existing.authorId === session.user.id;
  const isAdmin = await effectiveHasPermission(role, RESOURCE, "delete");
  if (!isOwner && !isAdmin) {
    return NextResponse.json(
      { error: "You can only edit announcements you posted" },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }
  const data = parsed.data;

  // The two fields decide each other, so they are resolved together against
  // what the row already holds — patching isGlobal alone must not leave a
  // company-wide announcement still pinned to a region.
  const isGlobal = data.isGlobal ?? existing.isGlobal;
  const regionId = isGlobal ? null : (data.regionId ?? existing.regionId);

  if (!isGlobal && !regionId) {
    return NextResponse.json(
      {
        error: "Validation failed",
        details: { fieldErrors: { regionId: ["Choose a region, or make it company-wide"] } },
      },
      { status: 422 }
    );
  }
  if (regionId) {
    const region = await db.region.findUnique({ where: { id: regionId }, select: { id: true } });
    if (!region) {
      return NextResponse.json(
        { error: "Validation failed", details: { fieldErrors: { regionId: ["No such region"] } } },
        { status: 422 }
      );
    }
  }

  const announcement = await db.announcement.update({
    where: { id },
    data: {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.content !== undefined ? { content: data.content } : {}),
      isGlobal,
      regionId,
      ...(data.expiresAt !== undefined ? { expiresAt: data.expiresAt } : {}),
    },
  });

  void logActivity(session.user.id, "UPDATE", "Announcement", id, {
    route: "hr/announcements/[id]",
    fields: Object.keys(data),
  });

  return NextResponse.json({ announcement });
}

// ─── DELETE /api/hr/announcements/[id] ───────────────────────────────────────

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const role = session.user.role as Role;

  if (!(await effectiveHasPermission(role, RESOURCE, "delete"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const existing = await db.announcement.findUnique({
    where: { id },
    select: { id: true, title: true, isGlobal: true, regionId: true, authorId: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Announcement not found" }, { status: 404 });
  }

  // The read receipts go with it by cascade. The activity log keeps what was
  // said and who withdrew it, which is the part worth keeping.
  await db.announcement.delete({ where: { id } });

  void logActivity(session.user.id, "DELETE", "Announcement", id, {
    route: "hr/announcements/[id]",
    title: existing.title,
    isGlobal: existing.isGlobal,
    regionId: existing.regionId,
    originalAuthorId: existing.authorId,
  });

  return NextResponse.json({ success: true });
}
