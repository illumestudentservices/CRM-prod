import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { differenceInDays } from "date-fns";

// ─── GET /api/institutions/:id/contracts ───────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    const institution = await db.institution.findUnique({
      where: { id },
      select: { id: true, deletedAt: true },
    });
    if (!institution || institution.deletedAt) return NextResponse.json({ error: "Institution not found" }, { status: 404 });

    const contracts = await db.contract.findMany({
      where: { institutionId: id },
      orderBy: { startDate: "desc" },
    });

    // Annotate with days until expiry
    const contractsWithDays = contracts.map((c) => ({
      ...c,
      daysUntilExpiry: differenceInDays(new Date(c.endDate), new Date()),
    }));

    return NextResponse.json(contractsWithDays);
  } catch (error) {
    console.error("[GET /api/institutions/:id/contracts]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── POST /api/institutions/:id/contracts ──────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    const institution = await db.institution.findUnique({
      where: { id },
      select: { id: true, name: true, deletedAt: true },
    });
    if (!institution || institution.deletedAt) return NextResponse.json({ error: "Institution not found" }, { status: 404 });

    const body = await req.json();
    const { title, value, startDate, endDate, status, notes } = body;

    if (!title || !startDate || !endDate) {
      return NextResponse.json(
        { error: "Title, start date and end date are required" },
        { status: 400 }
      );
    }

    const contract = await db.contract.create({
      data: {
        institutionId: id,
        title,
        value: value ?? null,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        status: status ?? "ACTIVE",
        notes: notes || null,
        createdById: session.user.id,
      },
    });

    // Check for renewal notifications (< 60 days to expiry)
    const daysUntilExpiry = differenceInDays(new Date(endDate), new Date());
    if (daysUntilExpiry < 60 && daysUntilExpiry > 0) {
      // Create renewal notification
      await db.notification.create({
        data: {
          userId: session.user.id,
          title: "Contract Renewal Due",
          message: `Contract "${title}" for ${institution.name} expires in ${daysUntilExpiry} days.`,
          type: "WARNING",
          link: `/institutions/${id}?tab=contracts`,
        },
      });
    }

    return NextResponse.json(contract, { status: 201 });
  } catch (error) {
    console.error("[POST /api/institutions/:id/contracts]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
