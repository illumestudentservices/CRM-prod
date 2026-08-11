import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { type AccountStatus, AccountStatus as AccountStatusEnum } from "@prisma/client";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import {
  readJsonBody, handleApiError, assertEnum, assertString,
} from "@/lib/api-validation";

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
    const search = searchParams.get("search");

    const institutions = await db.institution.findMany({
      where: {
        deletedAt: null,
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
          select: { leads: true, contacts: true, contracts: true, users: true },
        },
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json(institutions);
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
      reportingFrequency,
      serviceScope,
      regionalManagerId,
      notes,
    } = body;

    assertString(name, "name", { max: 300 });
    assertString(country, "country", { max: 200 });
    assertString(type, "type", { max: 100 });
    assertEnum(accountStatus, AccountStatusEnum, "accountStatus", { required: false });

    const institution = await db.institution.create({
      data: {
        name,
        legalName: legalName || null,
        country,
        type,
        website: website || null,
        primaryContact: primaryContact || null,
        accountStatus: (accountStatus as AccountStatus) ?? "PROSPECT",
        regionId: regionId || null,
        // Spec §3 (Clients) — reporting cadence + service scope multi-select
        reportingFrequency: reportingFrequency ?? null,
        serviceScope: Array.isArray(serviceScope) ? serviceScope : [],
        regionalManagerId: regionalManagerId || null,
        notes: notes || null,
        createdById: session.user.id,
      },
    });

    await db.auditLog.create({
      data: {
        action: "CREATE",
        entity: "Institution",
        entityId: institution.id,
        userId: session.user.id,
        changes: body,
      },
    });

    return NextResponse.json(institution, { status: 201 });
  } catch (error) {
    return handleApiError(error, "[POST /api/institutions]");
  }
}
