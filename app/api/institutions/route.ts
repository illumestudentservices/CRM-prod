import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditOrigin } from "@/lib/activity-logger";
import { type AccountStatus, AccountStatus as AccountStatusEnum } from "@prisma/client";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import {
  readJsonBody, handleApiError, assertEnum, assertString,
} from "@/lib/api-validation";
import { institutionIdsForUser } from "@/lib/lead-access";
import { redactFields } from "@/lib/granular-permissions";
import { stripNullBytes } from "@/lib/sanitize-text";

// ─── GET /api/institutions ─────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!await effectiveHasPermission(session.user.role as Role, "institutions", "read")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") as AccountStatus | null;
    const country = searchParams.get("country");
    const regionId = searchParams.get("regionId");
    // Strip NUL bytes before the value reaches Prisma `contains` — Postgres
    // rejects \u0000 and it would surface as a 500.
    const search = stripNullBytes(searchParams.get("search"));

    // `institutions:read` is a module grant, not a row grant. An
    // INSTITUTION_CLIENT must only see the institutions they're assigned to,
    // otherwise the list hands them every other client's account.
    const scopedIds = await institutionIdsForUser(
      session.user.id,
      session.user.role as Role
    );
    const clientScope =
      session.user.role === "INSTITUTION_CLIENT" ? { id: { in: scopedIds } } : {};

    const institutions = await db.institution.findMany({
      where: {
        deletedAt: null,
        ...clientScope,
        ...(status ? { accountStatus: status } : {}),
        ...(country ? { country: { contains: country, mode: "insensitive" } } : {}),
        ...(regionId ? { regionId } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { country: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: {
        region: { select: { id: true, name: true } },
        _count: {
          select: { leads: { where: { deletedAt: null } }, contacts: true, contracts: true, users: true },
        },
      },
      orderBy: { name: "asc" },
    });

    // Field-level read control (Phase 10) — same redaction as the detail view,
    // so a withheld column doesn't leak through the list.
    return NextResponse.json(
      await redactFields(session.user.role as Role, "institutions", institutions)
    );
  } catch (error) {
    return handleApiError(error, "[GET /api/institutions]");
  }
}

// ─── POST /api/institutions ────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!await effectiveHasPermission(session.user.role as Role, "institutions", "write")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await readJsonBody(req);
    const {
      name,
      legalName,
      country,
      type,
      website,
      primaryContact,
      accountStatus,
      regionId,
      regionIds,
      reportingFrequency,
      serviceScope,
      regionalManagerId,
      notes,
    } = body;

    assertString(name, "name", { max: 300 });
    assertString(country, "country", { max: 200 });
    assertString(type, "type", { max: 100 });
    assertEnum(accountStatus, AccountStatusEnum, "accountStatus", { required: false });

    // A client can work in several regions (InstitutionRegion), with one primary
    // (the `regionId` column, the headline). The form sends `regionIds` with the
    // primary first; older callers may still send a single `regionId`.
    const regionList: string[] = Array.isArray(regionIds)
      ? regionIds.filter((r): r is string => typeof r === "string" && r.length > 0)
      : regionId
        ? [regionId]
        : [];
    const primaryRegionId = regionList[0] ?? null;

    const institution = await db.$transaction(async (tx) => {
      const created = await tx.institution.create({
        data: {
          name,
          legalName: legalName || null,
          country,
          type,
          website: website || null,
          primaryContact: primaryContact || null,
          accountStatus: (accountStatus as AccountStatus) ?? "PROSPECT",
          regionId: primaryRegionId,
          // Spec §3 (Clients) — reporting cadence + service scope multi-select
          reportingFrequency: reportingFrequency ?? null,
          serviceScope: Array.isArray(serviceScope) ? serviceScope : [],
          regionalManagerId: regionalManagerId || null,
          notes: notes || null,
          createdById: session.user.id,
        },
      });
      if (regionList.length > 0) {
        await tx.institutionRegion.createMany({
          data: regionList.map((rid) => ({ institutionId: created.id, regionId: rid })),
          skipDuplicates: true,
        });
      }
      return created;
    });

    await db.auditLog.create({
      data: {
        action: "CREATE",
        entity: "Institution",
        entityId: institution.id,
        userId: session.user.id,
        changes: body,
      
        ...(await auditOrigin()),
      },
    });

    return NextResponse.json(institution, { status: 201 });
  } catch (error) {
    return handleApiError(error, "[POST /api/institutions]");
  }
}
