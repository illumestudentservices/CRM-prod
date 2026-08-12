import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditOrigin } from "@/lib/activity-logger";
import { type SourceType, SourceType as SourceTypeEnum } from "@prisma/client";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import {
  readJsonBody, assertEnum, assertString, assertNumber, handleApiError,
} from "@/lib/api-validation";

// ─── GET /api/sources ──────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!await effectiveHasPermission(session.user.role as Role, "sources", "read")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") as SourceType | null;
    const regionId = searchParams.get("regionId");
    const search = searchParams.get("search");
    const isActive = searchParams.get("isActive");

    const sources = await db.recruitmentPartner.findMany({
      where: {
        deletedAt: null,
        ...(type ? { type } : {}),
        ...(regionId ? { regionId } : {}),
        ...(isActive !== null ? { isActive: isActive === "true" } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { country: { contains: search, mode: "insensitive" } },
                { contactPerson: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: {
        region: { select: { id: true, name: true } },
        _count: { select: { leads: true } },
        leads: {
          where: { deletedAt: null },
          select: { stage: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Calculate conversion rate
    const sourcesWithStats = sources.map((s) => {
      const totalLeads = s._count.leads;
      const enrolledLeads = s.leads.filter((l) => l.stage === "ENROLLED").length;
      const conversionRate = totalLeads > 0 ? (enrolledLeads / totalLeads) * 100 : 0;
      const { leads: _leads, ...rest } = s;
      return { ...rest, totalLeads, enrolledLeads, conversionRate };
    });

    return NextResponse.json(sourcesWithStats);
  } catch (error) {
    console.error("[GET /api/sources]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── POST /api/sources ─────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!await effectiveHasPermission(session.user.role as Role, "sources", "write")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await readJsonBody(req);
    const { regionId } = body;

    const name = assertString(body.name, "name", { max: 300 })!;
    const type = assertEnum(body.type, SourceTypeEnum, "type")!;
    const country = assertString(body.country, "country", { max: 200 })!;
    const city = assertString(body.city, "city", { required: false, max: 200 });
    const rating = assertNumber(body.rating, "rating", { required: false, min: 1, max: 5, integer: true });
    // Free-text columns still need a type check: an object here reached the
    // driver and came back as a 500 rather than a 422.
    const contactPerson = assertString(body.contactPerson, "contactPerson", { required: false, max: 300 });
    const email = assertString(body.email, "email", { required: false, max: 320 });
    const phone = assertString(body.phone, "phone", { required: false, max: 50 });
    const agreementStatus = assertString(body.agreementStatus, "agreementStatus", { required: false, max: 100 });
    const notes = assertString(body.notes, "notes", { required: false, max: 20_000 });

    const source = await db.recruitmentPartner.create({
      data: {
        name,
        type,
        country,
        city: city ?? null,
        regionId: (regionId as string) || null,
        contactPerson: contactPerson ?? null,
        email: email ?? null,
        phone: phone ?? null,
        agreementStatus: agreementStatus ?? null,
        rating: rating ?? null,
        notes: notes ?? null,
        createdById: session.user.id,
      },
    });

    // Audit log
    await db.auditLog.create({
      data: {
        action: "CREATE",
        entity: "Source",
        entityId: source.id,
        userId: session.user.id,
        changes: body,
      
        ...(await auditOrigin()),
      },
    });

    return NextResponse.json(source, { status: 201 });
  } catch (error) {
    return handleApiError(error, "[POST /api/sources]");
  }
}
