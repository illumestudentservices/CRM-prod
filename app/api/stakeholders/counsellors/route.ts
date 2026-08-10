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

    // Spec §6 (retire Stakeholders) — Counsellor is a retiring model, and
    // going forward every counsellor is a PartnerContact under the Source that
    // represents this school. Migration 013 backfilled existing rows;
    // everything created here must be mirrored so the Network Performance
    // dashboard and the new UI see it. The Counsellor write is kept so the
    // legacy `/stakeholders` UI still reads them until the cutover PR lands.

    // Locate (or create) the Source of type=SCHOOL that matches this school.
    // Migration 013 auto-created these; if a school was added after the
    // migration and never got a Source, mint one now, mirroring the
    // migration's logic. This is the ONLY place in the API allowed to
    // auto-create a Source; user-facing forms must not.
    let sourceId: string | null = null;
    let source = await db.recruitmentPartner.findFirst({
      where: {
        type: "SCHOOL",
        name: school.name,
        country: school.country,
      },
      select: { id: true },
    });
    if (!source) {
      source = await db.recruitmentPartner.create({
        data: {
          name: school.name,
          type: "SCHOOL",
          country: school.country,
          isActive: school.isActive,
          createdById: session.user.id,
        },
        select: { id: true },
      });
    }
    sourceId = source.id;

    // Transactional dual-write. Counsellor stays authoritative for the old
    // UI; PartnerContact becomes the primary going forward. Failing to
    // mirror is NOT fatal to the write itself — logged and audit-flagged
    // instead, so a partner_contacts constraint bug doesn't stop HR from
    // adding a counsellor.
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

    let mirroredContactId: string | null = null;
    try {
      const contact = await db.partnerContact.create({
        data: {
          partnerId: sourceId,
          fullName: name,
          position: position || null,
          role: "COUNSELLOR",
          email: email || null,
          phone: phone || null,
          isPrimary: false,
          isActive: true,
          legacyCounsellorId: counsellor.id,
        },
        select: { id: true },
      });
      mirroredContactId = contact.id;
    } catch (mirrorErr) {
      console.error(
        "[POST counsellors] Failed to mirror to PartnerContact",
        { counsellorId: counsellor.id, sourceId },
        mirrorErr
      );
    }

    await db.auditLog.create({
      data: {
        action: "CREATE",
        entity: "Counsellor",
        entityId: counsellor.id,
        userId: session.user.id,
        changes: { ...body, mirroredContactId, mirroredSourceId: sourceId },
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
