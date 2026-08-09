import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { type EventType, type EventStatus } from "@prisma/client";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";

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
        institutions: {
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

    const body = await req.json();
    const {
      name,
      type,
      date,
      city,
      country,
      status,
      budget,
      regionId,
      assignedICRId,
      institutionIds,
      notes,
      // Spec §3 (Recruitment Events) — duplicate-prevention escape hatch.
      // Only SUPER_ADMIN may bypass ("Create New Event (System Administrator only)").
      forceCreate,
    } = body;

    if (!name || !type || !date || !city || !country) {
      return NextResponse.json(
        { error: "Name, type, date, city and country are required" },
        { status: 400 }
      );
    }

    // Spec §3 — duplicate check by (Event Name + Date + City + Country) with
    // a ±14-day date window. Returns 409 with "Join Existing" info; only
    // SUPER_ADMIN + forceCreate:true proceeds.
    const eventDate = new Date(date);
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
    if (existing && forceCreate && session.user.role !== "SUPER_ADMIN") {
      return NextResponse.json(
        { error: "Only administrators may create a duplicate event." },
        { status: 403 }
      );
    }

    const event = await db.event.create({
      data: {
        name,
        type: type as EventType,
        date: new Date(date),
        city,
        country,
        status: (status as EventStatus) ?? "PLANNED",
        budget: budget ?? null,
        regionId: regionId || null,
        assignedICRId: assignedICRId || null,
        notes: notes || null,
        createdById: session.user.id,
        // Link institutions
        institutions:
          Array.isArray(institutionIds) && institutionIds.length > 0
            ? {
                create: institutionIds.map((id: string) => ({
                  institution: { connect: { id } },
                })),
              }
            : undefined,
      },
      include: {
        institutions: {
          include: { institution: { select: { id: true, name: true } } },
        },
      },
    });

    return NextResponse.json(event, { status: 201 });
  } catch (error) {
    console.error("[POST /api/events]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
