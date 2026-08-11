import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { type InteractionType, InteractionType as InteractionTypeEnum } from "@prisma/client";
import {
  readJsonBody, handleApiError, assertEnum, assertDate,
} from "@/lib/api-validation";

// ─── GET /api/institutions/:id/engagement ──────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await effectiveHasPermission(session.user.role, "institutions", "read")))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;

    const institution = await db.institution.findUnique({
      where: { id },
      select: { id: true, deletedAt: true },
    });
    if (!institution || institution.deletedAt) return NextResponse.json({ error: "Institution not found" }, { status: 404 });

    const logs = await db.engagementLog.findMany({
      where: { institutionId: id },
      include: {
        user: { select: { id: true, name: true, image: true } },
      },
      orderBy: { date: "desc" },
    });

    return NextResponse.json(logs);
  } catch (error) {
    return handleApiError(error, "[GET /api/institutions/:id/engagement]");
  }
}

// ─── POST /api/institutions/:id/engagement ─────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await effectiveHasPermission(session.user.role, "institutions", "write")))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;

    const institution = await db.institution.findUnique({
      where: { id },
      select: { id: true, deletedAt: true },
    });
    if (!institution || institution.deletedAt) return NextResponse.json({ error: "Institution not found" }, { status: 404 });

    const body = await readJsonBody(req);
    const { type, date, notes, outcome } = body;

    if (!type || !date) {
      return NextResponse.json({ error: "Type and date are required" }, { status: 400 });
    }

    // Guard before Prisma: an unknown InteractionType used to answer 500.
    assertEnum(type, InteractionTypeEnum, "type");
    const engagementDate = assertDate(date, "date")!;

    const log = await db.engagementLog.create({
      data: {
        institutionId: id,
        userId: session.user.id,
        type: type as InteractionType,
        date: engagementDate,
        notes: notes || null,
        outcome: outcome || null,
      },
      include: {
        user: { select: { id: true, name: true, image: true } },
      },
    });

    return NextResponse.json(log, { status: 201 });
  } catch (error) {
    return handleApiError(error, "[POST /api/institutions/:id/engagement]");
  }
}
