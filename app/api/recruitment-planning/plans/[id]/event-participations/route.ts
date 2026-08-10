import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";

/**
 * Spec §4B (Recruitment Planning) — Event Participation entries on a
 * quarterly plan. The plan REFERENCES existing Recruitment Events; it never
 * creates them directly (that's the Recruitment Network module's job).
 *
 * If the ICR knows of an event that doesn't exist yet, they use the
 * "Propose New Event" flow which POSTs a Proposed Event to
 * /api/events (with status=PLANNED) and then this route links it.
 */

const blankToUndefined = (v: unknown) =>
  v === "" || v === null || v === "none" ? undefined : v;

const createSchema = z.object({
  eventId: z.string().min(1, "eventId is required"),
  institutionRepresentedId: z.string().min(1, "institutionRepresentedId is required"),
  purpose: z.preprocess(blankToUndefined, z.string().optional()),
  estimatedCost: z.preprocess(blankToUndefined, z.number().optional()),
  estimatedCurrency: z.preprocess(blankToUndefined, z.string().optional()),
  expectedLeads: z.preprocess(blankToUndefined, z.number().int().optional()),
  expectedApplications: z.preprocess(blankToUndefined, z.number().int().optional()),
  expectedEnrolments: z.preprocess(blankToUndefined, z.number().int().optional()),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await effectiveHasPermission(session.user.role as Role, "recruitment_planning", "write"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id: planId } = await ctx.params;

    const plan = await db.quarterlyRecruitmentPlan.findUnique({
      where: { id: planId },
      select: { id: true, status: true, icrId: true },
    });
    if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

    // Spec §5 — plan is read-only once approved; changes go through
    // Variation Requests. Refuse to add an event participation directly.
    if (!["DRAFT", "RETURNED"].includes(plan.status)) {
      return NextResponse.json(
        {
          error:
            "This plan is locked. Submit a Variation Request (Add Recruitment Event) instead.",
        },
        { status: 409 }
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 422 }
      );
    }
    const d = parsed.data;

    // Verify the referenced event and institution exist so we don't create
    // orphaned rows that would confuse the plan detail render.
    const [event, inst] = await Promise.all([
      db.event.findUnique({ where: { id: d.eventId }, select: { id: true } }),
      db.institution.findUnique({
        where: { id: d.institutionRepresentedId },
        select: { id: true },
      }),
    ]);
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 422 });
    if (!inst) return NextResponse.json({ error: "Institution not found" }, { status: 422 });

    const created = await db.plannedEventParticipation.create({
      data: {
        planId,
        eventId: d.eventId,
        institutionRepresentedId: d.institutionRepresentedId,
        purpose: d.purpose,
        estimatedCost: d.estimatedCost,
        estimatedCurrency: d.estimatedCurrency ?? "USD",
        expectedLeads: d.expectedLeads,
        expectedApplications: d.expectedApplications,
        expectedEnrolments: d.expectedEnrolments,
      },
      include: {
        event: { select: { id: true, name: true, date: true, city: true, country: true } },
        institutionRepresented: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({ data: created }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/recruitment-planning/plans/[id]/event-participations]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
