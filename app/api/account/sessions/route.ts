import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

// A browser session lives at most 48h (the absolute JWT ceiling in lib/auth.ts),
// so a row older than that is a dead login and never shown.
const SESSION_MAX_AGE_MS = 48 * 60 * 60 * 1000;

/** Best-effort friendly label from a user-agent string. */
function deviceLabel(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser =
    /Edg\//.test(ua) ? "Edge" :
    /OPR\/|Opera/.test(ua) ? "Opera" :
    /Chrome\//.test(ua) ? "Chrome" :
    /Firefox\//.test(ua) ? "Firefox" :
    /Safari\//.test(ua) ? "Safari" :
    "Browser";
  const os =
    /Windows/.test(ua) ? "Windows" :
    /iPhone|iPad|iOS/.test(ua) ? "iOS" :
    /Mac OS X|Macintosh/.test(ua) ? "macOS" :
    /Android/.test(ua) ? "Android" :
    /Linux/.test(ua) ? "Linux" :
    "";
  return os ? `${browser} on ${os}` : browser;
}

// ─── GET /api/account/sessions — list my logins ──────────────────────────────

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const currentSid = session.user.sid ?? null;
  const cutoff = new Date(Date.now() - SESSION_MAX_AGE_MS);

  // Opportunistic cleanup keeps the table small without a dedicated cron.
  await db.activeSession.deleteMany({ where: { createdAt: { lt: cutoff } } }).catch(() => {});

  const [rows, revoked] = await Promise.all([
    db.activeSession.findMany({
      where: { userId, createdAt: { gte: cutoff } },
      orderBy: { createdAt: "desc" },
      select: { sid: true, userAgent: true, ipAddress: true, createdAt: true, lastSeenAt: true },
    }),
    db.revokedSession.findMany({ where: { userId }, select: { sid: true } }),
  ]);
  const revokedSids = new Set(revoked.map((r) => r.sid));

  // Freshen the current session's last-seen while we're here.
  if (currentSid) {
    await db.activeSession.updateMany({ where: { sid: currentSid, userId }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }

  const data = rows
    .filter((r) => !revokedSids.has(r.sid))
    .map((r) => ({
      id: r.sid,
      label: deviceLabel(r.userAgent),
      ipAddress: r.ipAddress,
      createdAt: r.createdAt,
      lastSeenAt: r.lastSeenAt,
      current: r.sid === currentSid,
    }));

  return NextResponse.json({ data });
}

// ─── DELETE /api/account/sessions — log out a session (or all others) ─────────

const deleteSchema = z.object({
  sid: z.string().min(1).optional(),
  scope: z.literal("others").optional(),
});

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const currentSid = session.user.sid ?? null;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Provide { sid } or { scope: 'others' }" }, { status: 400 });
  }

  // Log out every OTHER device, keeping the current one.
  if (parsed.data.scope === "others") {
    const others = await db.activeSession.findMany({
      where: { userId, ...(currentSid ? { sid: { not: currentSid } } : {}) },
      select: { sid: true },
    });
    if (others.length === 0) return NextResponse.json({ revoked: 0 });
    await db.revokedSession.createMany({
      data: others.map((o) => ({ sid: o.sid, userId })),
      skipDuplicates: true,
    });
    await db.activeSession.deleteMany({ where: { sid: { in: others.map((o) => o.sid) } } });
    return NextResponse.json({ revoked: others.length });
  }

  // Log out a single named session — only if it is one of MINE.
  if (parsed.data.sid) {
    const own = await db.activeSession.findFirst({ where: { sid: parsed.data.sid, userId }, select: { sid: true } });
    if (!own) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    await db.revokedSession.upsert({
      where: { sid: own.sid },
      create: { sid: own.sid, userId },
      update: {},
    });
    await db.activeSession.deleteMany({ where: { sid: own.sid } });
    return NextResponse.json({ revoked: 1 });
  }

  return NextResponse.json({ error: "Provide { sid } or { scope: 'others' }" }, { status: 400 });
}
