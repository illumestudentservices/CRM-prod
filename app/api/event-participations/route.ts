import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";

const blankToUndefined = (v: unknown) =>
  v === "" || v === null || v === "none" ? undefined : v;

const createSchema = z.object({
  eventId: z.string().min(1),
  institutionId: z.string().min(1),
  assignedICRId: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  status: z.enum(["INVITED", "CONFIRMED", "DECLINED", "ATTENDED", "NO_SHOW"]).default("CONFIRMED"),
  participationCost: z.number().nonnegative().optional(),
  participationCostCurrency: z.string().length(3).optional(),
});

const updateSchema = z.object({
  assignedICRId: z.preprocess(blankToUndefined, z.string().min(1).optional().nullable()),
  status: z.enum(["INVITED", "CONFIRMED", "DECLINED", "ATTENDED", "NO_SHOW"]).optional(),
  attendanceConfirmed: z.boolean().optional(),
  activitySummary: z.string().optional().nullable(),
  institutionOutcomeNotes: z.string().optional().nullable(),
  participationCost: z.number().nonnegative().optional().nullable(),
  participationCostCurrency: z.string().length(3).optional().nullable(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { role } = session.user;
    if (!(await effectiveHasPermission(role as Role, "recruitment_network", "read"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const eventId = req.nextUrl.searchParams.get("eventId");
    const institutionId = req.nextUrl.searchParams.get("institutionId");
    const assignedICRId = req.nextUrl.searchParams.get("assignedICRId");

    const rows = await db.eventParticipation.findMany({
      where: {
        ...(eventId && { eventId }),
        ...(institutionId && { institutionId }),
        ...(assignedICRId && { assignedICRId }),
      },
      orderBy: { createdAt: "desc" },
      include: {
        event: { select: { id: true, name: true, date: true, city: true, country: true, status: true } },
        institution: { select: { id: true, name: true, country: true } },
        assignedICR: { select: { id: true, name: true, email: true, image: true } },
      },
    });
    return NextResponse.json({ data: rows });
  } catch (err) {
    console.error("[GET /api/event-participations]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { role, id: userId } = session.user;
    if (!(await effectiveHasPermission(role as Role, "recruitment_network", "write"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 422 });
    }
    const data = parsed.data;

    const event = await db.event.findFirst({ where: { id: data.eventId, deletedAt: null }, select: { id: true } });
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    // The @@unique on (eventId, institutionId) handles the DB side; return
    // a clean 409 first to give the UI a useful error.
    const existing = await db.eventParticipation.findUnique({
      where: { eventId_institutionId: { eventId: data.eventId, institutionId: data.institutionId } },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({ error: "This institution already participates in this event.", existingId: existing.id }, { status: 409 });
    }

    const participation = await db.eventParticipation.create({
      data: {
        eventId: data.eventId,
        institutionId: data.institutionId,
        assignedICRId: data.assignedICRId ?? (role === "ICR" ? userId : undefined),
        status: data.status,
        participationCost: data.participationCost,
        participationCostCurrency: data.participationCostCurrency,
      },
      include: {
        institution: { select: { id: true, name: true } },
        assignedICR: { select: { id: true, name: true } },
      },
    });

    // Also insert into legacy EventInstitution join if it doesn't already exist,
    // so old readers of that table see the new participation.
    await db.eventInstitution.upsert({
      where: { eventId_institutionId: { eventId: data.eventId, institutionId: data.institutionId } },
      create: { eventId: data.eventId, institutionId: data.institutionId },
      update: {},
    });

    return NextResponse.json(participation, { status: 201 });
  } catch (err) {
    console.error("[POST /api/event-participations]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { role } = session.user;
    if (!(await effectiveHasPermission(role as Role, "recruitment_network", "write"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 422 });
    }

    const updated = await db.eventParticipation.update({
      where: { id },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: parsed.data as any,
    });
    return NextResponse.json(updated);
  } catch (err) {
    console.error("[PATCH /api/event-participations]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
