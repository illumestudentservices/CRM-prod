import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { CampaignStatus as CampaignStatusEnum } from "@prisma/client";
import {
  readJsonBody, assertEnum, assertString, assertDate, assertNumber, handleApiError,
} from "@/lib/api-validation";

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

    const body = await readJsonBody(req);
    const {
      notes,
      sourceId,
      // Spec §12 (Recruitment Network) — new required-for-dedup fields.
      type,
      venue,
      eventOrganizer,
      ownerId,
      // Force-create escape hatch. Only SUPER_ADMIN may bypass duplicate
      // detection per spec ("Create New Campaign (Admin only)").
      forceCreate,
    } = body;

    const name = assertString(body.name, "name", { max: 300 })!;
    const channel = assertString(body.channel, "channel", { max: 200 })!;
    const startAt = assertDate(body.startDate, "startDate")!;
    const endDate = assertDate(body.endDate, "endDate", { required: false });
    const country = assertString(body.country, "country", { required: false, max: 200 });
    const city = assertString(body.city, "city", { required: false, max: 200 });
    const budget = assertNumber(body.budget, "budget", { required: false, min: 0 });
    const actualSpend = assertNumber(body.actualSpend, "actualSpend", { required: false, min: 0 });
    const expectedAttendance = assertNumber(body.expectedAttendance, "expectedAttendance", {
      required: false, min: 0, integer: true,
    });
    const status = assertEnum(body.status, CampaignStatusEnum, "status", { required: false });

    // Spec §2 (Recruitment Network) — pre-create duplicate detection by
    // (name + city + country + start date ± 14 days). Non-admins get 409;
    // SUPER_ADMIN with forceCreate:true proceeds.
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
        endDate: endDate ?? null,
        budget: budget ?? null,
        actualSpend: actualSpend ?? null,
        notes: (notes as string) || null,
        sourceId: (sourceId as string) || null,
        createdById: session.user.id,
        type: (type as string) || null,
        country: country ?? null,
        city: city ?? null,
        venue: (venue as string) || null,
        expectedAttendance: expectedAttendance ?? null,
        eventOrganizer: (eventOrganizer as string) || null,
        ownerId: (ownerId as string) || null,
        // Spec §10 lifecycle default — new campaigns start PLANNED unless
        // the caller explicitly says otherwise.
        status: status || "PLANNED",
      },
    });

    return NextResponse.json(campaign, { status: 201 });
  } catch (error) {
    return handleApiError(error, "[POST /api/campaigns]");
  }
}
