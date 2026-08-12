import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditOrigin } from "@/lib/activity-logger";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { type AccountStatus } from "@prisma/client";
import { trashRecord } from "@/lib/recycle-bin";
import { institutionIdsForUser } from "@/lib/lead-access";
import type { Role } from "@/lib/permissions";
import { redactFields, checkFieldWrites } from "@/lib/granular-permissions";

/**
 * An INSTITUTION_CLIENT holds `institutions:read`, but that is a *module*
 * grant, not a row grant — it must still be scoped to the institutions they
 * are assigned to. Without this an authenticated client could read any other
 * client's record by id, and the response embeds contracts, engagement logs,
 * documents and the full lead list.
 *
 * Returns 404 rather than 403 so the endpoint doesn't confirm that an id
 * exists to someone not entitled to know.
 */
async function assertInstitutionVisible(
  institutionId: string,
  userId: string,
  role: Role
): Promise<boolean> {
  if (role !== "INSTITUTION_CLIENT") return true;
  const ids = await institutionIdsForUser(userId, role);
  return ids.includes(institutionId);
}

// ─── GET /api/institutions/:id ─────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await effectiveHasPermission(session.user.role, "institutions", "read")))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;

    if (!(await assertInstitutionVisible(id, session.user.id, session.user.role as Role))) {
      return NextResponse.json({ error: "Institution not found" }, { status: 404 });
    }

    const institution = await db.institution.findUnique({
      where: { id },
      include: {
        region: { select: { id: true, name: true } },
        contacts: { orderBy: [{ isPrimary: "desc" }, { name: "asc" }] },
        contracts: { orderBy: { startDate: "desc" } },
        engagementLogs: {
          include: { user: { select: { id: true, name: true, image: true } } },
          orderBy: { date: "desc" },
        },
        deliverables: { orderBy: { createdAt: "desc" } },
        documents: { orderBy: { uploadedAt: "desc" } },
        leads: {
          where: { deletedAt: null },
          include: {
            assignedICR: { select: { id: true, name: true } },
            source: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 100,
        },
        enrollmentTargets: { orderBy: { year: "asc" } },
        users: { include: { user: { select: { id: true, name: true, image: true } } } },
        _count: {
          select: { leads: true, contacts: true, contracts: true, engagementLogs: true },
        },
      },
    });

    if (!institution || institution.deletedAt) {
      return NextResponse.json({ error: "Institution not found" }, { status: 404 });
    }

    // Field-level read control (Phase 10) — commercial terms are withheld from
    // roles that hold institutions:read but not the commercial fields.
    return NextResponse.json(
      await redactFields(session.user.role as Role, "institutions", institution)
    );
  } catch (error) {
    console.error("[GET /api/institutions/:id]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── PATCH /api/institutions/:id ───────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await effectiveHasPermission(session.user.role, "institutions", "write")))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;

    const existing = await db.institution.findUnique({
      where: { id },
    });
    if (!existing || existing.deletedAt) return NextResponse.json({ error: "Institution not found" }, { status: 404 });

    const body = await req.json();
    const {
      name,
      legalName,
      country,
      type,
      website,
      primaryContact,
      accountStatus,
      regionId,
      notes,
      contractValue,
      renewalDate,
      // Legacy — accepted for backwards compatibility with any UI that still
      // sends them, but no longer surfaced. Spec §2 removed the Budget card.
      budgetTotal,
      budgetUsed,
      strategicObjectives,
      overview,
      accountManagerId,
      // Spec §3 / §11 additions
      reportingFrequency,
      serviceScope,
      regionalManagerId,
    } = body;

    // Field-level write control (Phase 10). Rejects the request naming the
    // offending columns rather than dropping them, so a caller who believes
    // they changed the contract value is told they didn't.
    const writeCheck = await checkFieldWrites(
      session.user.role as Role,
      "institutions",
      body as Record<string, unknown>
    );
    if (!writeCheck.ok) {
      return NextResponse.json(
        {
          error: `Your role cannot change: ${writeCheck.rejected.join(", ")}`,
          fields: writeCheck.rejected,
        },
        { status: 403 }
      );
    }

    const updated = await db.institution.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(legalName !== undefined && { legalName: legalName || null }),
        ...(country !== undefined && { country }),
        ...(type !== undefined && { type }),
        ...(website !== undefined && { website }),
        ...(primaryContact !== undefined && { primaryContact }),
        ...(accountStatus !== undefined && {
          accountStatus: accountStatus as AccountStatus,
        }),
        ...(regionId !== undefined && { regionId: regionId || null }),
        ...(notes !== undefined && { notes }),
        ...(contractValue !== undefined && { contractValue: contractValue !== null ? Number(contractValue) : null }),
        ...(renewalDate !== undefined && { renewalDate: renewalDate ? new Date(renewalDate) : null }),
        ...(budgetTotal !== undefined && { budgetTotal: budgetTotal !== null ? Number(budgetTotal) : null }),
        ...(budgetUsed !== undefined && { budgetUsed: budgetUsed !== null ? Number(budgetUsed) : null }),
        ...(strategicObjectives !== undefined && { strategicObjectives }),
        ...(overview !== undefined && { overview }),
        ...(accountManagerId !== undefined && { accountManagerId: accountManagerId || null }),
        ...(reportingFrequency !== undefined && {
          reportingFrequency: reportingFrequency || null,
        }),
        ...(serviceScope !== undefined && {
          serviceScope: Array.isArray(serviceScope) ? serviceScope : [],
        }),
        ...(regionalManagerId !== undefined && {
          regionalManagerId: regionalManagerId || null,
        }),
      },
    });

    await db.auditLog.create({
      data: {
        action: "UPDATE",
        entity: "Institution",
        entityId: updated.id,
        userId: session.user.id,
        changes: { before: existing, after: body },
      
        ...(await auditOrigin()),
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[PATCH /api/institutions/:id]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── DELETE /api/institutions/:id ──────────────────────────────────────────

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await effectiveHasPermission(session.user.role, "institutions", "delete")))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;

    const existing = await db.institution.findUnique({
      where: { id },
    });
    if (!existing || existing.deletedAt) return NextResponse.json({ error: "Institution not found" }, { status: 404 });

    await trashRecord({ entityType: "Institution", entityId: id, userId: session.user.id });

    await db.auditLog.create({
      data: {
        action: "DELETE",
        entity: "Institution",
        entityId: id,
        userId: session.user.id,
        changes: { before: existing },
      
        ...(await auditOrigin()),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/institutions/:id]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
