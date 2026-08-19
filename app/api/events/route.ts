import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  type EventType, type EventStatus,
  EventType as EventTypeEnum, EventStatus as EventStatusEnum,
} from "@prisma/client";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { hasCapability } from "@/lib/granular-permissions";
import {
  readJsonBody, assertEnum, assertString, assertDate, assertNumber, handleApiError,
} from "@/lib/api-validation";

// ─── GET /api/events ───────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!await effectiveHasPermission(session.user.role as Role, "events", "read")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") as EventType | null;
    const status = searchParams.get("status") as EventStatus | null;
    const regionId = searchParams.get("regionId");
    const search = searchParams.get("search");

    const events = await db.event.findMany({
      where: {
        deletedAt: null,
        ...(type ? { type } : {}),
        ...(status ? { status } : {}),
        ...(regionId ? { regionId } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { city: { contains: search, mode: "insensitive" } },
                { country: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: {
        region: { select: { id: true, name: true } },
        assignedICR: { select: { id: true, name: true } },
        // Migration 021 dropped EventInstitution — participations is the
        // sole join now.
        participations: {
          include: { institution: { select: { id: true, name: true } } },
        },
        _count: { select: { leads: true, expenses: true } },
        leads: {
          where: { deletedAt: null },
          select: { stage: true },
        },
      },
      orderBy: { date: "desc" },
    });

    const eventsWithStats = events.map((e) => {
      const leadsCount = e._count.leads;
      const enrollmentsCount = e.leads.filter((l) => l.stage === "ENROLLED").length;
      const roi =
        e.totalCost > 0
          ? ((enrollmentsCount * 5000 - e.totalCost) / e.totalCost) * 100
          : null;
      const { leads: _leads, ...rest } = e;
      return { ...rest, leadsCount, enrollmentsCount, roi };
    });

    return NextResponse.json(eventsWithStats);
  } catch (error) {
    console.error("[GET /api/events]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── POST /api/events ──────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!await effectiveHasPermission(session.user.role as Role, "events", "write")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await readJsonBody(req);
    const {
      regionId,
      assignedICRId,
      institutionIds,
      notes,
      // Spec §3 (Recruitment Events) — duplicate-prevention escape hatch.
      // Only SUPER_ADMIN may bypass ("Create New Event (System Administrator only)").
      forceCreate,
    } = body;

    // Validated before Prisma sees any of it: an unrecognised enum used to
    // surface as a 500 from PrismaClientValidationError rather than a 422.
    const name = assertString(body.name, "name", { max: 300 })!;
    const type = assertEnum(body.type, EventTypeEnum, "type")!;
    const eventDate = assertDate(body.date, "date")!;
    const city = assertString(body.city, "city", { max: 200 })!;
    const country = assertString(body.country, "country", { max: 200 })!;
    const status = assertEnum(body.status, EventStatusEnum, "status", { required: false });
    const budget = assertNumber(body.budget, "budget", { required: false, min: 0 });

    // Spec §3 — duplicate check by (Event Name + Date + City + Country) with
    // a ±14-day date window. Returns 409 with "Join Existing" info; only
    // SUPER_ADMIN + forceCreate:true proceeds.
    const dupWindowMs = 14 * 24 * 60 * 60 * 1000;
    const existing = await db.event.findFirst({
      where: {
        deletedAt: null,
        name: { equals: name, mode: "insensitive" },
        city: { equals: city, mode: "insensitive" },
        country: { equals: country, mode: "insensitive" },
        date: {
          gte: new Date(eventDate.getTime() - dupWindowMs),
          lte: new Date(eventDate.getTime() + dupWindowMs),
        },
      },
      select: {
        id: true,
        name: true,
        date: true,
        city: true,
        country: true,
        status: true,
      },
    });

    if (existing && !forceCreate) {
      return NextResponse.json(
        {
          error: "Similar Recruitment Event already exists.",
          existing,
          options: {
            joinExisting: true,
            createNewRequiresAdmin: true,
          },
        },
        { status: 409 }
      );
    }
    // Bypassing duplicate detection is the capability
    // recruitment_network.force_create_duplicate, whose default is SUPER_ADMIN
    // — the same role this line hardcoded. Reading the registry makes the
    // Security screen toggle real instead of decorative.
    if (existing && forceCreate &&
        !(await hasCapability(session.user.role as Role, "recruitment_network.force_create_duplicate"))) {
      return NextResponse.json(
        { error: "Only administrators may create a duplicate event." },
        { status: 403 }
      );
    }

    // Spec §7 (Recruitment Events) — EventParticipation is the authoritative
    // join. The dual-write to the flat EventInstitution join was a cutover
    // aid; readers have been migrated to `participations` (grep confirms), so
    // POST now writes ONLY the rich join. `event_institutions` will be dropped
    // by a future manual migration once we're confident nothing external
    // depends on it.
    const event = await db.event.create({
      data: {
        name,
        type: type as EventType,
        date: eventDate,
        city,
        country,
        status: (status as EventStatus) ?? "PLANNED",
        budget: budget ?? null,
        regionId: (regionId as string) || null,
        assignedICRId: (assignedICRId as string) || null,
        notes: (notes as string) || null,
        createdById: session.user.id,
        participations:
          Array.isArray(institutionIds) && institutionIds.length > 0
            ? {
                create: institutionIds.map((iid: string) => ({
                  institutionId: iid,
                  status: "CONFIRMED" as const,
                })),
              }
            : undefined,
      },
      include: {
        participations: {
          include: { institution: { select: { id: true, name: true } } },
        },
      },
    });

    return NextResponse.json(event, { status: 201 });
  } catch (error) {
    return handleApiError(error, "[POST /api/events]");
  }
}
