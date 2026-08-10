import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { stripNullBytes } from "@/lib/sanitize-text";
import { effectiveHasPermission } from "@/lib/effective-permissions";

const blankToUndefined = (v: unknown) =>
  v === "" || v === null || v === "none" ? undefined : v;

const createSchema = z.object({
  partnerId: z.string().min(1),
  fullName: z.string().min(1),
  position: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  role: z.enum(["COUNSELLOR", "OWNER", "BRANCH_MANAGER", "SENIOR_COUNSELLOR", "ADVISOR", "OTHER"]).default("OTHER"),
  email: z.preprocess(blankToUndefined, z.string().email().optional()),
  phone: z.preprocess(blankToUndefined, z.string().min(6).optional()),
  isPrimary: z.boolean().default(false),
  notes: z.preprocess(blankToUndefined, z.string().optional()),
});

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { role } = session.user;
    if (!(await effectiveHasPermission(role as Role, "recruitment_network", "read"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const partnerId = req.nextUrl.searchParams.get("partnerId");
    const includeInactive = req.nextUrl.searchParams.get("includeInactive") === "true";

    const contacts = await db.partnerContact.findMany({
      where: {
        ...(partnerId && { partnerId }),
        ...(!includeInactive && { isActive: true }),
      },
      orderBy: [{ isPrimary: "desc" }, { fullName: "asc" }],
      include: {
        partner: { select: { id: true, name: true, type: true, country: true } },
      },
    });
    return NextResponse.json({ data: contacts });
  } catch (err) {
    console.error("[GET /api/partner-contacts]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { role } = session.user;
    if (!(await effectiveHasPermission(role as Role, "recruitment_network", "write"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 422 });
    }
    const data = stripNullBytes(parsed.data);

    const partner = await db.recruitmentPartner.findUnique({ where: { id: data.partnerId }, select: { id: true } });
    if (!partner) return NextResponse.json({ error: "Recruitment partner not found" }, { status: 404 });

    // Enforce one primary per partner — clear any existing primary if this new
    // one is being flagged as primary.
    if (data.isPrimary) {
      await db.partnerContact.updateMany({
        where: { partnerId: data.partnerId, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    const contact = await db.partnerContact.create({
      data: {
        partnerId: data.partnerId,
        fullName: data.fullName,
        position: data.position,
        role: data.role,
        email: data.email,
        phone: data.phone,
        isPrimary: data.isPrimary,
        notes: data.notes,
      },
      include: { partner: { select: { id: true, name: true } } },
    });
    return NextResponse.json(contact, { status: 201 });
  } catch (err) {
    console.error("[POST /api/partner-contacts]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
