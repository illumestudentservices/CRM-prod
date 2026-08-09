import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectiveHasPermission } from "@/lib/effective-permissions";

// ─── GET /api/campaigns ────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (!(await effectiveHasPermission(session.user.role, "sources", "read"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const sourceId = searchParams.get("sourceId");
    const search = searchParams.get("search");

    const campaigns = await db.campaign.findMany({
      where: {
        deletedAt: null,
        ...(sourceId ? { sourceId } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { channel: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: {
        source: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(campaigns);
  } catch (error) {
    console.error("[GET /api/campaigns]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── POST /api/campaigns ───────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (!(await effectiveHasPermission(session.user.role, "sources", "write"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json();
    const {
      name,
      channel,
      startDate,
      endDate,
      budget,
      actualSpend,
      notes,
      sourceId,
      // Spec §12 (Recruitment Network) — new required-for-dedup fields.
      type,
      country,
      city,
      venue,
      expectedAttendance,
      eventOrganizer,
      ownerId,
      status,
      // Force-create escape hatch. Only SUPER_ADMIN may bypass duplicate
      // detection per spec ("Create New Campaign (Admin only)").
      forceCreate,
    } = body;

    if (!name || !channel || !startDate) {
      return NextResponse.json(
        { error: "Name, channel and start date are required" },
        { status: 400 }
      );
    }

    // Spec §2 (Recruitment Network) — pre-create duplicate detection by
    // (name + city + country + start date ± 14 days). Non-admins get 409;
    // SUPER_ADMIN with forceCreate:true proceeds.
    const startAt = new Date(startDate);
    const dupWindowMs = 14 * 24 * 60 * 60 * 1000;
    const dupWhere: Record<string, unknown> = {
      deletedAt: null,
      name: { equals: name, mode: "insensitive" as const },
      startDate: {
        gte: new Date(startAt.getTime() - dupWindowMs),
        lte: new Date(startAt.getTime() + dupWindowMs),
      },
    };
    if (city) dupWhere.city = { equals: city, mode: "insensitive" as const };
    if (country) dupWhere.country = { equals: country, mode: "insensitive" as const };

    const existing = await db.campaign.findFirst({
      where: dupWhere,
      select: {
        id: true,
        name: true,
        city: true,
        country: true,
        startDate: true,
        status: true,
        ownerId: true,
      },
    });

    if (existing && !forceCreate) {
      return NextResponse.json(
        {
          error: "Similar campaign already exists.",
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
        { error: "Only administrators may create a duplicate campaign." },
        { status: 403 }
      );
    }

    const campaign = await db.campaign.create({
      data: {
        name,
        channel,
        startDate: startAt,
        endDate: endDate ? new Date(endDate) : null,
        budget: budget ?? null,
        actualSpend: actualSpend ?? null,
        notes: notes || null,
        sourceId: sourceId || null,
        createdById: session.user.id,
        type: type || null,
        country: country || null,
        city: city || null,
        venue: venue || null,
        expectedAttendance: expectedAttendance ?? null,
        eventOrganizer: eventOrganizer || null,
        ownerId: ownerId || null,
        // Spec §10 lifecycle default — new campaigns start PLANNED unless
        // the caller explicitly says otherwise.
        status: status || "PLANNED",
      },
    });

    return NextResponse.json(campaign, { status: 201 });
  } catch (error) {
    console.error("[POST /api/campaigns]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
