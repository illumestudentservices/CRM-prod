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
    const { name, channel, startDate, endDate, budget, actualSpend, notes, sourceId } = body;

    if (!name || !channel || !startDate) {
      return NextResponse.json(
        { error: "Name, channel and start date are required" },
        { status: 400 }
      );
    }

    const campaign = await db.campaign.create({
      data: {
        name,
        channel,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        budget: budget ?? null,
        actualSpend: actualSpend ?? null,
        notes: notes || null,
        sourceId: sourceId || null,
        createdById: session.user.id,
      },
    });

    return NextResponse.json(campaign, { status: 201 });
  } catch (error) {
    console.error("[POST /api/campaigns]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
