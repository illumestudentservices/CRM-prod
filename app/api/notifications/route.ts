import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity-logger";

// Accept { id }, { all: true } or neither; the handler decides. The previous
// z.union with z.undefined() REJECTED { all: true } (400), so "mark all read"
// never persisted — the client hid the error and the badge came back on reload.
const markReadSchema = z.object({
  id: z.string().min(1).optional(),
  all: z.literal(true).optional(),
});

const deleteSchema = z.object({
  id: z.string().min(1).optional(),
  scope: z.enum(["read", "all"]).optional(),
});

// ─── GET /api/notifications ───────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const { searchParams } = req.nextUrl;
    const unreadOnly = searchParams.get("unreadOnly") === "true";
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "20", 10) || 20, 1), 50);
    const offset = Math.max(parseInt(searchParams.get("offset") ?? "0", 10) || 0, 0);
    const where = { userId, ...(unreadOnly && { isRead: false }) };

    const [notifications, unreadCount, total] = await Promise.all([
      db.notification.findMany({
        where,
        orderBy: [
          { isRead: "asc" },      // unread first
          { createdAt: "desc" },
        ],
        skip: offset,
        take: limit,
        select: {
          id: true,
          title: true,
          message: true,
          type: true,
          link: true,
          isRead: true,
          createdAt: true,
        },
      }),
      db.notification.count({ where: { userId, isRead: false } }),
      db.notification.count({ where }),
    ]);

    return NextResponse.json({
      data: notifications,
      meta: { unreadCount, total, hasMore: offset + notifications.length < total },
    });
  } catch (error) {
    console.error("[GET /api/notifications]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── PATCH /api/notifications — mark as read ─────────────────────────────────

export async function PATCH(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = markReadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Provide either { id } or { all: true }" },
        { status: 400 }
      );
    }

    if (parsed.data.all === true) {
      // Mark all as read
      const result = await db.notification.updateMany({
        where: { userId, isRead: false },
        data: { isRead: true },
      });

      return NextResponse.json({ updated: result.count });
    } else if (parsed.data.id) {
      // Mark single notification as read — must belong to this user
      const notification = await db.notification.findFirst({
        where: { id: parsed.data.id, userId },
      });

      if (!notification) {
        return NextResponse.json({ error: "Notification not found" }, { status: 404 });
      }

      const updated = await db.notification.update({
        where: { id: parsed.data.id },
        data: { isRead: true },
        select: { id: true, isRead: true },
      });
      void logActivity(userId, "UPDATE", "Notification", updated.id, { route: "notifications" });

      return NextResponse.json({ data: updated });
    }

    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  } catch (error) {
    console.error("[PATCH /api/notifications]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── DELETE /api/notifications ────────────────────────────────────────────────
// { id } removes one; { scope: "read" } clears the read ones; { scope: "all" }
// clears everything — all scoped to the signed-in user.
export async function DELETE(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
    const parsed = deleteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Provide { id } or { scope: 'read' | 'all' }" }, { status: 400 });
    }

    if (parsed.data.id) {
      const result = await db.notification.deleteMany({ where: { id: parsed.data.id, userId } });
      if (result.count === 0) return NextResponse.json({ error: "Notification not found" }, { status: 404 });
      return NextResponse.json({ deleted: result.count });
    }
    if (parsed.data.scope === "read") {
      const result = await db.notification.deleteMany({ where: { userId, isRead: true } });
      return NextResponse.json({ deleted: result.count });
    }
    if (parsed.data.scope === "all") {
      const result = await db.notification.deleteMany({ where: { userId } });
      return NextResponse.json({ deleted: result.count });
    }
    return NextResponse.json({ error: "Provide { id } or { scope: 'read' | 'all' }" }, { status: 400 });
  } catch (error) {
    console.error("[DELETE /api/notifications]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
