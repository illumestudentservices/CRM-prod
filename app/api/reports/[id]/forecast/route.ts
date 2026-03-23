import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";

const confidenceWeights: Record<string, number> = {
  HIGH: 0.8,
  MEDIUM: 0.5,
  LOW: 0.25,
};

const forecastEntrySchema = z.object({
  studentName: z.string().min(1),
  institutionId: z.string().min(1),
  program: z.string().min(1),
  stage: z.enum(["NEW", "CONTACTED", "APPLICATION_SENT", "DOCUMENTS_RECEIVED", "OFFER_ISSUED", "ENROLLED", "DEFERRED", "REJECTED", "LOST"]),
  expectedMonth: z.number().int().min(1).max(12),
  expectedYear: z.number().int().min(2020).max(2035),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  leadId: z.string().min(1).optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { role, id: userId, regionId } = session.user as {
      role: Role;
      id: string;
      regionId: string | null;
    };

    const { id: reportId } = await params;

    const report = await db.monthlyReport.findFirst({
      where: { id: reportId, deletedAt: null },
    });
    if (!report) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    // Access check
    if (
      role === "ICR" && report.icrId !== userId ||
      role === "REGIONAL_MANAGER" && report.regionId !== regionId
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const entries = await db.forecastEntry.findMany({
      where: { reportId },
      orderBy: [{ expectedYear: "asc" }, { expectedMonth: "asc" }],
    });

    // Aggregate weighted totals by month
    const byMonth: Record<string, { month: number; year: number; high: number; medium: number; low: number; total: number }> = {};
    for (const entry of entries) {
      const key = `${entry.expectedYear}-${String(entry.expectedMonth).padStart(2, "0")}`;
      if (!byMonth[key]) {
        byMonth[key] = { month: entry.expectedMonth, year: entry.expectedYear, high: 0, medium: 0, low: 0, total: 0 };
      }
      const prob = entry.weightedProb;
      if (entry.confidence === "HIGH") byMonth[key].high += prob;
      else if (entry.confidence === "MEDIUM") byMonth[key].medium += prob;
      else byMonth[key].low += prob;
      byMonth[key].total += prob;
    }

    const totalWeightedEnrollments = entries.reduce((sum: number, e: { weightedProb: number }) => sum + e.weightedProb, 0);

    return NextResponse.json({
      entries,
      forecast: Object.values(byMonth).sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month),
      totalWeightedEnrollments: parseFloat(totalWeightedEnrollments.toFixed(2)),
    });
  } catch (error) {
    console.error("[reports/id/forecast] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { role, id: userId, regionId } = session.user as {
      role: Role;
      id: string;
      regionId: string | null;
    };

    const { id: reportId } = await params;

    const report = await db.monthlyReport.findFirst({
      where: { id: reportId, deletedAt: null },
    });
    if (!report) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    if (
      role === "ICR" && report.icrId !== userId ||
      role === "REGIONAL_MANAGER" && report.regionId !== regionId
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!["DRAFT", "RETURNED"].includes(report.status) && role === "ICR") {
      return NextResponse.json({ error: "Cannot add forecast entries to a submitted report" }, { status: 400 });
    }

    const body = await req.json();
    const parsed = forecastEntrySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 });
    }

    const weightedProb = confidenceWeights[parsed.data.confidence] ?? 0.5;

    const entry = await db.forecastEntry.create({
      data: {
        reportId,
        leadId: parsed.data.leadId ?? null,
        studentName: parsed.data.studentName,
        institutionId: parsed.data.institutionId,
        program: parsed.data.program,
        stage: parsed.data.stage,
        expectedMonth: parsed.data.expectedMonth,
        expectedYear: parsed.data.expectedYear,
        confidence: parsed.data.confidence,
        weightedProb,
      },
    });

    return NextResponse.json(entry, { status: 201 });
  } catch (error) {
    console.error("[reports/id/forecast] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { role, id: userId } = session.user as { role: Role; id: string; regionId: string | null };

    const { id: reportId } = await params;
    const entryId = req.nextUrl.searchParams.get("entryId");

    if (!entryId) {
      return NextResponse.json({ error: "entryId query param required" }, { status: 400 });
    }

    const report = await db.monthlyReport.findFirst({
      where: { id: reportId, deletedAt: null },
    });
    if (!report) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    if (role === "ICR" && report.icrId !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await db.forecastEntry.delete({ where: { id: entryId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[reports/id/forecast] DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
