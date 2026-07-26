import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import type { Role } from "@/lib/permissions";

// ─── GET /api/stakeholders/counsellors ────────────────────────────────────

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
    const schoolId = searchParams.get("schoolId");

    const counsellors = await db.counsellor.findMany({
      where: {
        isActive: true,
        ...(schoolId ? { schoolId } : {}),
      },
      include: {
        school: { select: { id: true, name: true, country: true } },
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json(counsellors);
  } catch (error) {
    console.error("[GET /api/stakeholders/counsellors]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ─── POST /api/stakeholders/counsellors ───────────────────────────────────

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

    const body = await req.json();
    const {
      name,
      email,
      phone,
      position,
      influenceScore,
      institutionAffinity,
      schoolId,
    } = body;

    if (!name || !schoolId) {
      return NextResponse.json(
        { error: "Name and schoolId are required" },
        { status: 400 }
      );
    }

    // Verify school exists
    const school = await db.school.findUnique({ where: { id: schoolId } });
    if (!school || school.deletedAt) {
      return NextResponse.json({ error: "School not found" }, { status: 404 });
    }

    const counsellor = await db.counsellor.create({
      data: {
        name,
        email: email || null,
        phone: phone || null,
        position: position || null,
        influenceScore: influenceScore ? parseInt(influenceScore, 10) : null,
        institutionAffinity: institutionAffinity || null,
        schoolId,
      },
    });

    await db.auditLog.create({
      data: {
        action: "CREATE",
        entity: "Counsellor",
        entityId: counsellor.id,
        userId: session.user.id,
        changes: body,
      },
    });

    return NextResponse.json(counsellor, { status: 201 });
  } catch (error) {
    console.error("[POST /api/stakeholders/counsellors]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
