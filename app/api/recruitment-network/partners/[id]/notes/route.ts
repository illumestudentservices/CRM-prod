import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import type { Role } from "@/lib/permissions";
import { logActivity } from "@/lib/activity-logger";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Notes thread for a recruitment partner (agent/school).
 *
 * Partners are an org-wide shared network — unlike a lead, which belongs to one
 * ICR — so access is the module permission alone (recruitment_network), with no
 * per-record ownership check. The same resource gates the contacts panel on this
 * page (app/api/partner-contacts/route.ts).
 */

const noteSchema = z.object({
  content: z.string().trim().min(1, "Note content is required").max(5000),
});

async function livePartner(id: string) {
  return db.recruitmentPartner.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });
}

// ─── GET /api/recruitment-network/partners/:id/notes ──────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await effectiveHasPermission(session.user.role as Role, "recruitment_network", "read"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    if (!(await livePartner(id))) {
      return NextResponse.json({ error: "Partner not found" }, { status: 404 });
    }

    const notes = await db.partnerNote.findMany({
      where: { partnerId: id },
      orderBy: { createdAt: "desc" },
    });

    const authorIds = [...new Set(notes.map((n) => n.authorId))];
    const authors =
      authorIds.length > 0
        ? await db.user.findMany({
            where: { id: { in: authorIds } },
            select: { id: true, name: true, image: true },
          })
        : [];
    const authorMap = Object.fromEntries(authors.map((a) => [a.id, a]));

    return NextResponse.json(notes.map((n) => ({ ...n, author: authorMap[n.authorId] ?? null })));
  } catch (error) {
    console.error("[GET /api/recruitment-network/partners/:id/notes]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── POST /api/recruitment-network/partners/:id/notes ─────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await effectiveHasPermission(session.user.role as Role, "recruitment_network", "write"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Per-user throttle so one account cannot spam a partner's note thread.
    if (!rateLimit(`partner-note:${session.user.id}`, 40, 10 * 60 * 1000)) {
      return NextResponse.json({ error: "Too many notes in a short time. Please wait a few minutes." }, { status: 429 });
    }

    const { id } = await params;
    if (!(await livePartner(id))) {
      return NextResponse.json({ error: "Partner not found" }, { status: 404 });
    }

    const parsed = noteSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 }
      );
    }

    const note = await db.partnerNote.create({
      data: { partnerId: id, content: parsed.data.content, authorId: session.user.id },
    });

    void logActivity(session.user.id, "CREATE", "PartnerNote", note.id, {
      route: "recruitment-network/partners/[id]/notes",
      partnerId: id,
    });

    const author = {
      id: session.user.id,
      name: session.user.name ?? null,
      image: session.user.image ?? null,
    };
    return NextResponse.json({ ...note, author }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/recruitment-network/partners/:id/notes]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
