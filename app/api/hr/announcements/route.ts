import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";

const ANNOUNCE_ROLES: Role[] = ["HR_MANAGER", "SUPER_ADMIN", "HQ_EXECUTIVE"];

const createAnnouncementSchema = z.object({
  title: z.string().min(1, "Title is required"),
  content: z.string().min(1, "Content is required"),
  isGlobal: z.boolean().default(true),
  regionId: z.string().min(1).optional().nullable(),
  expiresAt: z.string().transform((v) => new Date(v)).optional().nullable(),
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

  const now = new Date();

  const announcements = await db.announcement.findMany({
    where: {
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      publishedAt: { lte: now },
    },
    include: {
      readReceipts: {
        where: { userId: session.user.id },
        select: { readAt: true },
      },
    },
    orderBy: { publishedAt: "desc" },
    take: 50,
  });

  return NextResponse.json({ announcements });
}

// ─── POST /api/hr/announcements ───────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!ANNOUNCE_ROLES.includes(session.user.role as Role)) {
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

  const announcement = await db.announcement.create({
    data: {
      title: data.title,
      content: data.content,
      authorId: session.user.id,
      isGlobal: data.isGlobal,
      regionId: data.regionId ?? null,
      expiresAt: data.expiresAt ?? null,
    },
  });

  return NextResponse.json({ announcement }, { status: 201 });
}
