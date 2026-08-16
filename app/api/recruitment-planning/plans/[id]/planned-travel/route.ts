import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";

/**
 * Planned travel on a quarterly plan.
 *
 * PlannedTravel is displayed on the plan and is wired into activation — when a
 * plan reaches APPROVED, each row materialises a real TravelRequest and stamps
 * the FK back. There was no way to CREATE one, so that activation path had
 * never run on real data and the planning module could not replace the travel
 * spreadsheet it was built for.
 *
 * Mirrors the budget-items route: same permission, same plan-lock rule.
 */

const createSchema = z.object({
  destination: z.string().min(1, "Destination is required").max(200),
  country: z.string().min(1, "Country is required").max(200),
  city: z.string().max(200).optional().nullable(),
  plannedStart: z.string().min(1, "Start date is required"),
  plannedEnd: z.string().min(1, "End date is required"),
  purpose: z.string().min(1, "Purpose is required").max(2000),
  linkedEventId: z.preprocess(
    (v) => (!v || v === "none" ? undefined : v),
    z.string().min(1).optional()
  ),
  estimatedCost: z.number().nonnegative().optional().nullable(),
  estimatedCurrency: z.string().length(3).optional().nullable(),
});

/** Shared plan lookup + lock check. */
async function loadWritablePlan(id: string) {
  const plan = await db.quarterlyRecruitmentPlan.findUnique({
    where: { id },
    select: { status: true, reportingCurrency: true },
  });
  if (!plan) {
    return { error: NextResponse.json({ error: "Plan not found" }, { status: 404 }) };
  }
  // Once approved the plan is the agreed commitment; changes go through a
  // Variation Request so the change itself is reviewable.
  if (["APPROVED", "ACTIVE", "COMPLETED", "CLOSED"].includes(plan.status)) {
    return {
      error: NextResponse.json(
        { error: "Plan is locked. Use a Variation Request to change planned travel." },
        { status: 409 }
      ),
    };
  }
  return { plan };
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await effectiveHasPermission(session.user.role as Role, "recruitment_planning", "read"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await ctx.params;
    const rows = await db.plannedTravel.findMany({
      where: { planId: id },
      orderBy: { plannedStart: "asc" },
      include: { linkedEvent: { select: { id: true, name: true } } },
    });
    return NextResponse.json({ data: rows });
  } catch (err) {
    console.error("[GET planned-travel]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await effectiveHasPermission(session.user.role as Role, "recruitment_planning", "write"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await ctx.params;

    const gate = await loadWritablePlan(id);
    if (gate.error) return gate.error;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() },
        { status: 422 }
      );
    }
    const d = parsed.data;

    const start = new Date(d.plannedStart);
    const end = new Date(d.plannedEnd);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return NextResponse.json({ error: "Those dates are not valid." }, { status: 422 });
    }
    // A trip that ends before it starts produces a negative duration everywhere
    // downstream, including the TravelRequest created at activation.
    if (end < start) {
      return NextResponse.json(
        { error: "The return date cannot be before the departure date." },
        { status: 422 }
      );
    }

    if (d.linkedEventId) {
      const ev = await db.event.findFirst({
        where: { id: d.linkedEventId, deletedAt: null },
        select: { id: true },
      });
      if (!ev) return NextResponse.json({ error: "That event was not found." }, { status: 422 });
    }

    const created = await db.plannedTravel.create({
      data: {
        planId: id,
        destination: d.destination.trim(),
        country: d.country.trim(),
        city: d.city?.trim() || null,
        plannedStart: start,
        plannedEnd: end,
        purpose: d.purpose.trim(),
        linkedEventId: d.linkedEventId || null,
        estimatedCost: d.estimatedCost ?? null,
        // Falls back to the plan's own reporting currency rather than a
        // hardcoded USD, so a plan reported in MYR does not silently mix units.
        estimatedCurrency: d.estimatedCurrency ?? gate.plan!.reportingCurrency ?? "USD",
      },
      include: { linkedEvent: { select: { id: true, name: true } } },
    });

    return NextResponse.json({ data: created }, { status: 201 });
  } catch (err) {
    console.error("[POST planned-travel]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await effectiveHasPermission(session.user.role as Role, "recruitment_planning", "write"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await ctx.params;
    const rowId = req.nextUrl.searchParams.get("rowId");
    if (!rowId) return NextResponse.json({ error: "rowId is required" }, { status: 400 });

    const gate = await loadWritablePlan(id);
    if (gate.error) return gate.error;

    // Scoped to the plan in the path so a valid id from another plan cannot be
    // removed by pairing it with a plan the caller can write.
    const row = await db.plannedTravel.findFirst({
      where: { id: rowId, planId: id },
      select: { id: true, activatedAt: true },
    });
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (row.activatedAt) {
      return NextResponse.json(
        { error: "This travel has already been activated into a real trip and cannot be removed here." },
        { status: 409 }
      );
    }

    await db.plannedTravel.delete({ where: { id: rowId } });
    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error("[DELETE planned-travel]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
