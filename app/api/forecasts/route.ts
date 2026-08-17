import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import type { ForecastStatus } from "@prisma/client";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { assertNoNulBytes, ApiError } from "@/lib/api-validation";
import { FORECAST_SEGMENTS } from "@/lib/forecasting";

/**
 * Forecasts (spec §3, §11).
 *
 * GET  — forecasts the caller may see, scoped by role.
 * POST — open a forecast for a period/institution/ICR/intake.
 */

const createSchema = z.object({
  periodYear: z.number().int().min(2024).max(2100),
  periodMonth: z.number().int().min(1).max(12),
  institutionId: z.string().min(1, "Choose a client institution"),
  marketId: z.string().optional().nullable(),
  icrId: z.string().min(1, "Choose the ICR this forecast belongs to"),
  intakeYear: z.number().int().min(2024).max(2100),
  intakeMonth: z.number().int().min(1).max(12),
  regionalManagerId: z.string().optional().nullable(),
});

/**
 * Row scope.
 *
 * Fails closed. A role holding forecasting:read but with no defined scope sees
 * nothing rather than everything — the `default: {}` pattern is what let an
 * external client read every other client's students.
 */
function scopeFilter(role: Role, userId: string) {
  switch (role) {
    case "SUPER_ADMIN":
    case "HQ_EXECUTIVE":
    case "HQ_ANALYTICS":
    case "VP_GLOBAL_SALES":
      return {};
    case "REGIONAL_MANAGER":
      return { OR: [{ regionalManagerId: userId }, { icrId: userId }] };
    case "ICR":
      return { icrId: userId };
    default:
      return { id: "__no_access__" };
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const role = session.user.role as Role;
    if (!(await effectiveHasPermission(role, "forecasting", "read"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = req.nextUrl;
    const status = searchParams.get("status");
    const institutionId = searchParams.get("institutionId");

    const forecasts = await db.forecast.findMany({
      where: {
        ...scopeFilter(role, session.user.id),
        ...(status && { status: status as ForecastStatus }),
        ...(institutionId && { institutionId }),
      },
      orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }],
      select: {
        id: true, periodYear: true, periodMonth: true, status: true,
        intakeYear: true, intakeMonth: true, confidenceScore: true,
        pipelineMaturity: true, acceptedAt: true,
        institution: { select: { id: true, name: true } },
        market: { select: { id: true, name: true } },
        icr: { select: { id: true, name: true, email: true } },
        regionalManager: { select: { id: true, name: true } },
        segments: {
          select: {
            segment: true,
            icrApplications: true, icrDeposits: true, icrEnrolments: true,
            rmApplications: true, rmDeposits: true, rmEnrolments: true,
          },
        },
      },
    });

    return NextResponse.json({ data: forecasts });
  } catch (err) {
    console.error("[GET /api/forecasts]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const role = session.user.role as Role;
    if (!(await effectiveHasPermission(role, "forecasting", "write"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // Spec §11 has the system open the monthly cycle; a manager may also open
    // one directly. An ICR can only open their own.
    if (role !== "SUPER_ADMIN" && role !== "REGIONAL_MANAGER" && role !== "ICR") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    try {
      assertNoNulBytes(body);
    } catch (e) {
      if (e instanceof ApiError) return NextResponse.json({ error: e.message }, { status: e.status });
      throw e;
    }

    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Validation failed" },
        { status: 422 }
      );
    }
    const d = parsed.data;

    if (role === "ICR" && d.icrId !== session.user.id) {
      return NextResponse.json(
        { error: "You can only open a forecast for yourself." },
        { status: 403 }
      );
    }

    const [icr, institution] = await Promise.all([
      db.user.findFirst({ where: { id: d.icrId, deletedAt: null }, select: { id: true } }),
      db.institution.findFirst({
        where: { id: d.institutionId, deletedAt: null }, select: { id: true },
      }),
    ]);
    if (!icr) return NextResponse.json({ error: "That ICR was not found." }, { status: 422 });
    if (!institution) {
      return NextResponse.json({ error: "That institution was not found." }, { status: 422 });
    }

    // The unique key would reject this anyway, but a 409 naming the existing
    // forecast is more use than a constraint violation.
    const existing = await db.forecast.findFirst({
      where: {
        periodYear: d.periodYear, periodMonth: d.periodMonth,
        institutionId: d.institutionId, icrId: d.icrId,
        intakeYear: d.intakeYear, intakeMonth: d.intakeMonth,
      },
      select: { id: true, status: true },
    });
    if (existing) {
      return NextResponse.json(
        {
          error: "A forecast already exists for that period, institution, ICR and intake.",
          forecastId: existing.id,
        },
        { status: 409 }
      );
    }

    const forecast = await db.forecast.create({
      data: {
        periodYear: d.periodYear,
        periodMonth: d.periodMonth,
        institutionId: d.institutionId,
        marketId: d.marketId || null,
        icrId: d.icrId,
        intakeYear: d.intakeYear,
        intakeMonth: d.intakeMonth,
        regionalManagerId: d.regionalManagerId || null,
        status: "DRAFT",
        createdById: session.user.id,
        // All four segments up front (spec §3), so the ICR sees the full grid
        // and completeness is a query rather than a comparison against a list.
        segments: { create: FORECAST_SEGMENTS.map((segment) => ({ segment })) },
        events: {
          create: {
            fromStatus: null,
            toStatus: "DRAFT",
            actedById: session.user.id,
            comments: "Forecast opened.",
          },
        },
      },
      select: { id: true, status: true, periodYear: true, periodMonth: true },
    });

    return NextResponse.json({ data: forecast }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/forecasts]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
