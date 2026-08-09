import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";

const blankToUndefined = (v: unknown) =>
  v === "" || v === null || v === "none" ? undefined : v;

const createSchema = z.object({
  icrId: z.string().min(1),
  institutionId: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  marketId: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  quarter: z.number().int().min(1).max(4),
  year: z.number().int().min(2024).max(2035),
  reportingCurrency: z.string().length(3).default("USD"),
  objectives: z.any().optional(),
});

function scope(role: Role, userId: string, regionId: string | null) {
  switch (role) {
    case "ICR": return { icrId: userId };
    case "REGIONAL_MANAGER": return regionId ? { icr: { regionId } } : {};
    default: return {};
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { role, id: userId, regionId } = session.user;
    if (!(await effectiveHasPermission(role as Role, "recruitment_planning", "read"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const quarter = req.nextUrl.searchParams.get("quarter");
    const year = req.nextUrl.searchParams.get("year");
    const status = req.nextUrl.searchParams.get("status");

    const rows = await db.quarterlyRecruitmentPlan.findMany({
      where: {
        ...scope(role as Role, userId, regionId),
        ...(quarter && { quarter: Number(quarter) }),
        ...(year && { year: Number(year) }),
        ...(status && { status: status as never }),
      },
      orderBy: [{ year: "desc" }, { quarter: "desc" }, { createdAt: "desc" }],
      include: {
        icr: { select: { id: true, name: true, email: true } },
        institution: { select: { id: true, name: true } },
        market: { select: { id: true, name: true, code: true } },
        _count: { select: { plannedTravel: true, plannedEvents: true, plannedFieldActivities: true, budgetItems: true, variationRequests: true } },
      },
    });
    return NextResponse.json({ data: rows });
  } catch (err) {
    console.error("[GET /api/recruitment-planning/plans]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { role, id: userId } = session.user;
    if (!(await effectiveHasPermission(role as Role, "recruitment_planning", "write"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 422 });
    }
    const data = parsed.data;

    // ICRs can only create their own plan
    if (role === "ICR" && data.icrId !== userId) {
      return NextResponse.json({ error: "ICRs may only create their own plan" }, { status: 403 });
    }

    const plan = await db.quarterlyRecruitmentPlan.create({
      data: {
        icrId: data.icrId,
        institutionId: data.institutionId,
        marketId: data.marketId,
        quarter: data.quarter,
        year: data.year,
        reportingCurrency: data.reportingCurrency,
        objectives: data.objectives ?? undefined,
        status: "DRAFT",
      },
    });
    return NextResponse.json(plan, { status: 201 });
  } catch (err) {
    // Unique violation on (icrId, institutionId, quarter, year)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((err as any)?.code === "P2002") {
      return NextResponse.json({ error: "A plan for this ICR/institution/quarter already exists" }, { status: 409 });
    }
    console.error("[POST /api/recruitment-planning/plans]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
