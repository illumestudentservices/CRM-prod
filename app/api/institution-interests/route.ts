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

const createSchema = z.object({
  leadId: z.string().min(1),
  institutionId: z.string().min(1),
  program: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  intakeYear: z.number().int().min(2020).max(2035),
  intakeMonth: z.number().int().min(1).max(12),
  studyLevel: z.enum(["UNDERGRADUATE", "POSTGRADUATE", "PATHWAY", "FOUNDATION"]),
  assignedICRId: z.preprocess(blankToUndefined, z.string().min(1).optional()),
});

const listSchema = z.object({
  leadId: z.string().optional(),
  institutionId: z.string().optional(),
  stage: z.enum(["NEW_LEAD","CONTACTED","QUALIFIED","APPLICATION_SUBMITTED","AWAITING_DECISION","OFFER_RECEIVED","DEPOSIT_PAID","ENROLLED","LOST","DEFERRED","APPLICATION_REJECTED"]).optional(),
  assignedICRId: z.string().optional(),
  onlyOpen: z.enum(["true", "false"]).default("true"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

function scope(role: Role, userId: string, regionId: string | null) {
  switch (role) {
    case "ICR":
      return { OR: [{ assignedICRId: userId }, { lead: { assignedICRId: userId } }] };
    case "REGIONAL_MANAGER":
      return regionId ? { lead: { regionId } } : {};
    default:
      return {};
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { role, id: userId, regionId } = session.user;
    if (!(await effectiveHasPermission(role as Role, "leads", "read"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = listSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid query", details: parsed.error.flatten() }, { status: 400 });
    }
    const { leadId, institutionId, stage, assignedICRId, onlyOpen, page, limit } = parsed.data;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      ...scope(role as Role, userId, regionId),
      ...(leadId && { leadId }),
      ...(institutionId && { institutionId }),
      ...(stage && { stage }),
      ...(assignedICRId && { assignedICRId }),
      ...(onlyOpen === "true" && { closedAt: null }),
    };

    const [rows, total] = await Promise.all([
      db.institutionInterest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          lead: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, countryOfResidence: true } },
          institution: { select: { id: true, name: true, country: true } },
          assignedICR: { select: { id: true, name: true, email: true, image: true } },
        },
      }),
      db.institutionInterest.count({ where }),
    ]);

    return NextResponse.json({ data: rows, meta: { total, page, limit, pageCount: Math.ceil(total / limit) } });
  } catch (err) {
    console.error("[GET /api/institution-interests]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { role, id: userId } = session.user;
    if (!(await effectiveHasPermission(role as Role, "leads", "write"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 422 });
    }
    const data = stripNullBytes(parsed.data);

    const lead = await db.lead.findFirst({ where: { id: data.leadId, deletedAt: null }, select: { id: true } });
    if (!lead) return NextResponse.json({ error: "Student not found" }, { status: 404 });

    // Partial-unique index enforces one open interest per (lead, institution).
    // Return a clean 409 before Postgres raises its own.
    const conflict = await db.institutionInterest.findFirst({
      where: { leadId: data.leadId, institutionId: data.institutionId, closedAt: null },
      select: { id: true },
    });
    if (conflict) {
      return NextResponse.json(
        { error: "An open interest for this student and institution already exists.", conflictId: conflict.id },
        { status: 409 },
      );
    }

    const interest = await db.institutionInterest.create({
      data: {
        leadId: data.leadId,
        institutionId: data.institutionId,
        program: data.program,
        intakeYear: data.intakeYear,
        intakeMonth: data.intakeMonth,
        studyLevel: data.studyLevel,
        assignedICRId: data.assignedICRId ?? (role === "ICR" ? userId : undefined),
      },
      include: {
        institution: { select: { id: true, name: true, country: true } },
        assignedICR: { select: { id: true, name: true, email: true } },
      },
    });

    await syncLeadFromInterests(data.leadId);

    return NextResponse.json(interest, { status: 201 });
  } catch (err) {
    console.error("[POST /api/institution-interests]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
