import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { trashRecord, RecycleBinNotFound } from "@/lib/recycle-bin";

const updateSchema = z.object({
  fullName: z.string().min(1).optional(),
  position: z.string().optional().nullable(),
  role: z.enum(["COUNSELLOR", "OWNER", "BRANCH_MANAGER", "SENIOR_COUNSELLOR", "ADVISOR", "OTHER"]).optional(),
  email: z.string().email().optional().nullable(),
  phone: z.string().min(6).optional().nullable(),
  isPrimary: z.boolean().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().optional().nullable(),
  lastEngagementDate: z.string().datetime().optional().nullable(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { role } = session.user;
    if (!(await effectiveHasPermission(role as Role, "recruitment_network", "write"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await ctx.params;

    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 422 });
    }

    const existing = await db.partnerContact.findUnique({ where: { id }, select: { partnerId: true } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (parsed.data.isPrimary === true) {
      await db.partnerContact.updateMany({
        where: { partnerId: existing.partnerId, isPrimary: true, NOT: { id } },
        data: { isPrimary: false },
      });
    }

    const updated = await db.partnerContact.update({
      where: { id },
      data: {
        ...parsed.data,
        lastEngagementDate: parsed.data.lastEngagementDate ? new Date(parsed.data.lastEngagementDate) : parsed.data.lastEngagementDate,
      },
    });
    return NextResponse.json(updated);
  } catch (err) {
    console.error("[PATCH /api/partner-contacts/[id]]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { role } = session.user;
    if (!(await effectiveHasPermission(role as Role, "recruitment_network", "delete"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await ctx.params;
    // Snapshot to recycle bin (60-day retention) then remove. Restore
    // re-INSERTs from the snapshot so engagement history is preserved.
    await trashRecord({ entityType: "PartnerContact", entityId: id, userId: session.user.id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    // No existence check before trashRecord, so an unknown id used to 500.
    if (err instanceof RecycleBinNotFound) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error("[DELETE /api/partner-contacts/[id]]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
