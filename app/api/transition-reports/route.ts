import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import type { TransitionStatus } from "@prisma/client";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { assertNoNulBytes, ApiError } from "@/lib/api-validation";
import { TRANSITION_SECTIONS, TYPES_WITH_FINAL_WORKING_DAY } from "@/lib/icr-transition";

/**
 * ICR Transition & Handover reports.
 *
 * GET  — reports the caller is entitled to see.
 * POST — a Regional Manager assigns a handover (spec §6).
 */

const TRANSITION_TYPES = [
  "LEAVING_ILLUME",
  "INSTITUTION_REASSIGNMENT",
  "MARKET_REASSIGNMENT",
  "INTERNAL_ROLE_CHANGE",
  "TEMPORARY_COVERAGE",
  "EXTENDED_LEAVE",
  "OTHER",
] as const;

const createSchema = z.object({
  outgoingIcrId: z.string().min(1, "Select the outgoing ICR"),
  institutionId: z.string().min(1, "Select the client institution"),
  regionId: z.string().optional().nullable(),
  marketIds: z.array(z.string().min(1)).optional().default([]),
  incomingIcrId: z.string().optional().nullable(),
  regionalManagerId: z.string().min(1, "A reviewing Regional Manager is required"),
  clientRelationsDirectorId: z.string().optional().nullable(),
  vpGlobalSalesId: z.string().optional().nullable(),
  transitionType: z.enum(TRANSITION_TYPES),
  effectiveTransitionDate: z.string().min(1, "Effective transition date is required"),
  finalWorkingDay: z.string().optional().nullable(),
  reportDueDate: z.string().min(1, "Report due date is required"),
});

/**
 * Row scope.
 *
 * Written to mirror canAccessLead's shape deliberately: named roles see
 * everything, the people attached to a report see that report, and anything
 * unrecognised sees nothing. The `default: {}` pattern is what let an external
 * client read every student in the system, so there is no unscoped fallback
 * here.
 */
function scopeFilter(role: Role, userId: string) {
  switch (role) {
    case "SUPER_ADMIN":
    case "HQ_EXECUTIVE":
      return {};
    case "VP_GLOBAL_SALES":
    case "ACCOUNT_MANAGER":
      // Spec §32: these read FINAL reports; they have no review role and no
      // business seeing drafts in progress.
      return { status: { in: ["FINAL", "ARCHIVED"] as TransitionStatus[] } };
    case "REGIONAL_MANAGER":
      return { OR: [{ regionalManagerId: userId }, { outgoingIcrId: userId }] };
    case "ICR":
      return { OR: [{ outgoingIcrId: userId }, { incomingIcrId: userId }] };
    default:
      return { id: "__no_access__" };
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const role = session.user.role as Role;
    if (!(await effectiveHasPermission(role, "icr_transition", "read"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = req.nextUrl;
    const status = searchParams.get("status");
    const institutionId = searchParams.get("institutionId");

    const reports = await db.transitionReport.findMany({
      where: {
        ...scopeFilter(role, session.user.id),
        ...(status && { status: status as never }),
        ...(institutionId && { institutionId }),
      },
      orderBy: [{ status: "asc" }, { reportDueDate: "asc" }],
      select: {
        id: true,
        status: true,
        transitionType: true,
        effectiveTransitionDate: true,
        reportDueDate: true,
        finalisedAt: true,
        createdAt: true,
        institution: { select: { id: true, name: true, country: true } },
        outgoingIcr: { select: { id: true, name: true, email: true } },
        incomingIcr: { select: { id: true, name: true } },
        regionalManager: { select: { id: true, name: true } },
        region: { select: { id: true, name: true } },
        markets: { select: { market: { select: { id: true, name: true } } } },
        _count: { select: { sections: true } },
      },
    });

    return NextResponse.json({ data: reports });
  } catch (err) {
    console.error("[GET /api/transition-reports]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const role = session.user.role as Role;
    // Spec §6: "Only authorised managers should create Transition Report
    // assignments." write covers RM and SUPER_ADMIN; ICR holds read+write for
    // its own sections, so the role is checked explicitly too.
    if (!(await effectiveHasPermission(role, "icr_transition", "write"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (role !== "SUPER_ADMIN" && role !== "REGIONAL_MANAGER") {
      return NextResponse.json(
        { error: "Only a Regional Manager can assign a Transition Report." },
        { status: 403 }
      );
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
        { error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() },
        { status: 422 }
      );
    }
    const d = parsed.data;

    const effective = new Date(d.effectiveTransitionDate);
    const due = new Date(d.reportDueDate);
    if (Number.isNaN(effective.getTime()) || Number.isNaN(due.getTime())) {
      return NextResponse.json({ error: "Those dates are not valid." }, { status: 422 });
    }
    // A report due after the ICR has already gone is the failure this module
    // exists to prevent, so it is refused rather than warned about.
    if (due > effective) {
      return NextResponse.json(
        { error: "The report is due after the transition takes effect. Bring the due date forward." },
        { status: 422 }
      );
    }

    let finalDay: Date | null = null;
    if (d.finalWorkingDay) {
      finalDay = new Date(d.finalWorkingDay);
      if (Number.isNaN(finalDay.getTime())) {
        return NextResponse.json({ error: "That final working day is not valid." }, { status: 422 });
      }
      if (!TYPES_WITH_FINAL_WORKING_DAY.includes(d.transitionType)) {
        // Not an error: the field is simply meaningless for a reassignment, and
        // storing it would imply the person is leaving.
        finalDay = null;
      }
    }

    if (d.outgoingIcrId === d.incomingIcrId) {
      return NextResponse.json(
        { error: "The incoming and outgoing ICR cannot be the same person." },
        { status: 422 }
      );
    }
    // Spec §32: an ICR "cannot approve own report".
    if (d.outgoingIcrId === d.regionalManagerId) {
      return NextResponse.json(
        { error: "The outgoing ICR cannot also be the reviewing Regional Manager." },
        { status: 422 }
      );
    }

    const [icr, institution] = await Promise.all([
      db.user.findFirst({ where: { id: d.outgoingIcrId, deletedAt: null }, select: { id: true } }),
      db.institution.findFirst({ where: { id: d.institutionId, deletedAt: null }, select: { id: true } }),
    ]);
    if (!icr) return NextResponse.json({ error: "That ICR was not found." }, { status: 422 });
    if (!institution) return NextResponse.json({ error: "That institution was not found." }, { status: 422 });

    // Spec §7 scopes a report to an assignment. Two live reports for the same
    // ICR and institution would make "which handover owns this pipeline?"
    // unanswerable, so the earlier one must be finalised or archived first.
    const existing = await db.transitionReport.findFirst({
      where: {
        outgoingIcrId: d.outgoingIcrId,
        institutionId: d.institutionId,
        status: { notIn: ["FINAL", "ARCHIVED"] },
      },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(
        {
          error: "There is already an open Transition Report for this ICR and institution.",
          reportId: existing.id,
        },
        { status: 409 }
      );
    }

    const report = await db.transitionReport.create({
      data: {
        outgoingIcrId: d.outgoingIcrId,
        institutionId: d.institutionId,
        regionId: d.regionId || null,
        incomingIcrId: d.incomingIcrId || null,
        regionalManagerId: d.regionalManagerId,
        clientRelationsDirectorId: d.clientRelationsDirectorId || null,
        vpGlobalSalesId: d.vpGlobalSalesId || null,
        transitionType: d.transitionType,
        effectiveTransitionDate: effective,
        finalWorkingDay: finalDay,
        reportDueDate: due,
        status: "ASSIGNED",
        createdById: session.user.id,
        markets: d.marketIds.length
          ? { create: d.marketIds.map((marketId) => ({ marketId })) }
          : undefined,
        // Every section is created up front so the ICR sees the full shape of
        // what is expected rather than discovering sections as they go, and so
        // completeness is a query rather than a comparison against a list.
        sections: {
          create: TRANSITION_SECTIONS.map((s) => ({ section: s.key })),
        },
        events: {
          create: {
            fromStatus: null,
            toStatus: "ASSIGNED",
            actedById: session.user.id,
            comments: "Transition report assigned.",
          },
        },
      },
      select: { id: true, status: true, reportDueDate: true },
    });

    return NextResponse.json({ data: report }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/transition-reports]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
