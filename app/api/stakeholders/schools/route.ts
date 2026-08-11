import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import type { Role } from "@/lib/permissions";
import { SchoolType as SchoolTypeEnum, RelationshipStatus as RelationshipStatusEnum } from "@prisma/client";
import {
  readJsonBody, handleApiError, assertEnum, assertString, assertNumber,
} from "@/lib/api-validation";

// ─── GET /api/stakeholders/schools ────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (
      !(await effectiveHasPermission(
        session.user.role as Role,
        "stakeholders",
        "read"
      ))
    )
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search");
    const marketId = searchParams.get("marketId");

    const schools = await db.school.findMany({
      where: {
        deletedAt: null,
        ...(marketId ? { marketId } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { country: { contains: search, mode: "insensitive" } },
                { city: { contains: search, mode: "insensitive" } },
                { principalName: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: {
        market: { select: { id: true, name: true } },
        _count: { select: { counsellors: true, activities: true } },
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json(schools);
  } catch (error) {
    return handleApiError(error, "[GET /api/stakeholders/schools]");
  }
}

// ─── POST /api/stakeholders/schools ───────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (
      !(await effectiveHasPermission(
        session.user.role as Role,
        "stakeholders",
        "write"
      ))
    )
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await readJsonBody(req);
    const {
      name,
      country,
      city,
      address,
      website,
      type,
      principalName,
      principalEmail,
      phone,
      relationshipStatus,
      studentVolume,
      marketId,
      notes,
    } = body;

    assertString(name, "name", { max: 300 });
    assertString(country, "country", { max: 200 });
    assertEnum(type, SchoolTypeEnum, "type", { required: false });
    assertEnum(relationshipStatus, RelationshipStatusEnum, "relationshipStatus", { required: false });
    assertNumber(studentVolume, "studentVolume", { required: false, min: 0, integer: true });

    const school = await db.school.create({
      data: {
        name,
        country,
        city: city || null,
        address: address || null,
        website: website || null,
        type: type || "PUBLIC",
        principalName: principalName || null,
        principalEmail: principalEmail || null,
        phone: phone || null,
        relationshipStatus: relationshipStatus || "NEW",
        studentVolume: studentVolume ? parseInt(studentVolume, 10) : null,
        marketId: marketId || null,
        notes: notes || null,
        createdById: session.user.id,
      },
    });

    await db.auditLog.create({
      data: {
        action: "CREATE",
        entity: "School",
        entityId: school.id,
        userId: session.user.id,
        changes: body,
      },
    });

    return NextResponse.json(school, { status: 201 });
  } catch (error) {
    return handleApiError(error, "[POST /api/stakeholders/schools]");
  }
}
