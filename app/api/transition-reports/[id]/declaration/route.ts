import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { canEditContent, canSubmit } from "@/lib/icr-transition";

/**
 * The outgoing ICR's final declaration (spec §24).
 *
 * Separate from the section save route because it is not commentary — it is the
 * ICR asserting that what they have written is complete and accurate, and
 * submission is blocked without it (§33).
 *
 * Only the outgoing ICR can confirm it. An admin can edit content on their
 * behalf, but signing a declaration for someone else would make the assertion
 * meaningless, so this route checks identity rather than role.
 */

const schema = z.object({
  confirmed: z.boolean(),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const role = session.user.role as Role;
    if (!(await effectiveHasPermission(role, "icr_transition", "write"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await ctx.params;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Provide { confirmed: true | false }" }, { status: 422 });
    }

    const report = await db.transitionReport.findUnique({
      where: { id },
      select: {
        id: true, status: true, outgoingIcrId: true, regionalManagerId: true,
        declarationConfirmedAt: true,
        sections: { select: { section: true, narrative: true, completedAt: true } },
      },
    });
    if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });

    if (!canEditContent(report, session.user.id, role)) {
      return NextResponse.json(
        { error: "This report cannot be changed at the moment." },
        { status: 403 }
      );
    }

    // The declaration is personal. Role is not enough.
    if (report.outgoingIcrId !== session.user.id) {
      return NextResponse.json(
        { error: "Only the outgoing ICR can confirm their own declaration." },
        { status: 403 }
      );
    }

    if (parsed.data.confirmed) {
      // Declaring a report complete while sections are empty is the assertion
      // being false on its face, so it is refused with the specific gaps rather
      // than accepted and caught later at submission.
      const gate = canSubmit(report.sections, new Date());
      if (!gate.ok) {
        return NextResponse.json(
          {
            error: "Complete the required sections before confirming the declaration.",
            reasons: gate.errors,
          },
          { status: 422 }
        );
      }
    }

    const updated = await db.transitionReport.update({
      where: { id },
      data: parsed.data.confirmed
        ? { declarationConfirmedAt: new Date(), declarationById: session.user.id }
        : { declarationConfirmedAt: null, declarationById: null },
      select: { id: true, declarationConfirmedAt: true },
    });

    return NextResponse.json({ data: updated });
  } catch (err) {
    console.error("[POST /api/transition-reports/[id]/declaration]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
