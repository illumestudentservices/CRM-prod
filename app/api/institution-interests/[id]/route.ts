import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { stripNullBytes } from "@/lib/sanitize-text";
import { syncLeadFromInterests } from "@/lib/interest-sync";

const blankToUndefined = (v: unknown) =>
  v === "" || v === null || v === "none" ? undefined : v;

const updateSchema = z.object({
  program: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  intakeYear: z.number().int().min(2020).max(2035).optional(),
  intakeMonth: z.number().int().min(1).max(12).optional(),
  studyLevel: z.enum(["UNDERGRADUATE", "POSTGRADUATE", "PATHWAY", "FOUNDATION"]).optional(),
  assignedICRId: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  eligibilityOutcome: z.preprocess(
    blankToUndefined,
    z.enum(["ELIGIBLE", "PROVISIONALLY_ELIGIBLE", "FURTHER_INFO_REQUIRED", "NOT_ELIGIBLE"]).optional(),
  ),
  academicQualification: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  englishStatus: z.preprocess(
    blankToUndefined,
    z.enum(["IELTS", "TOEFL", "PTE", "DUOLINGO", "MOI", "NATIVE_SPEAKER", "NOT_TAKEN", "EXEMPT"]).optional(),
  ),
});

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { role } = session.user;
    if (!(await effectiveHasPermission(role as Role, "leads", "read"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await ctx.params;
    const interest = await db.institutionInterest.findUnique({
      where: { id },
      include: {
        lead: true,
        institution: { select: { id: true, name: true, country: true, type: true } },
        assignedICR: { select: { id: true, name: true, email: true, image: true } },
        applications: true,
        activities: { orderBy: { createdAt: "desc" }, take: 20 },
        checklistItems: true,
      },
    });
    if (!interest) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(interest);
  } catch (err) {
    console.error("[GET /api/institution-interests/[id]]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { role } = session.user;
    if (!(await effectiveHasPermission(role as Role, "leads", "write"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await ctx.params;

    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 422 });
    }

    const existing = await db.institutionInterest.findUnique({ where: { id }, select: { leadId: true, closedAt: true } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (existing.closedAt) {
      return NextResponse.json({ error: "Cannot edit a closed interest. Reopen it first." }, { status: 409 });
    }

    const patchData: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed.data)) {
      if (v !== undefined) patchData[k] = v;
    }
    if (parsed.data.eligibilityOutcome !== undefined) {
      patchData.eligibilityConfirmedAt = new Date();
    }

    const updated = await db.institutionInterest.update({ where: { id }, data: patchData });
    await syncLeadFromInterests(existing.leadId);
    return NextResponse.json(updated);
  } catch (err) {
    console.error("[PATCH /api/institution-interests/[id]]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { role } = session.user;
    if (!(await effectiveHasPermission(role as Role, "leads", "delete"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await ctx.params;
    const existing = await db.institutionInterest.findUnique({ where: { id }, select: { leadId: true } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await db.institutionInterest.delete({ where: { id } });
    await syncLeadFromInterests(existing.leadId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/institution-interests/[id]]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
