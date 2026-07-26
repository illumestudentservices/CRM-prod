import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectiveHasPermission } from "@/lib/effective-permissions";

// ─── Validation schemas ───────────────────────────────────────────────────────

const actionItemSchema = z.object({
  title: z.string().min(1),
  assignee: z.string().optional(),
  dueDate: z.string().optional(),
  completed: z.boolean().default(false),
});

const attendeeSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional().nullable(),
  organization: z.string().optional().nullable(),
  role: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const createActivitySchema = z.object({
  type: z.enum(["SCHOOL_VISIT", "AGENT_MEETING", "STUDENT_EVENT", "FAIR", "PARTNER_MEETING"]),
  title: z.string().min(2, "Title must be at least 2 characters"),
  description: z.string().optional().nullable(),
  date: z.string().min(1, "Date is required"),
  endDate: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  studentsEngaged: z.number().int().min(0).optional().nullable(),
  counsellorsEngaged: z.number().int().min(0).optional().nullable(),
  leadsGenerated: z.number().int().min(0).optional().nullable(),
  applicationsGenerated: z.number().int().min(0).optional().nullable(),
  cost: z.number().min(0).optional().nullable(),
  outcomes: z.string().optional().nullable(),
  followUp: z.string().optional().nullable(),
  actionItems: z.array(actionItemSchema).optional().nullable(),
  topics: z.string().optional().nullable(),
  institutionId: z.preprocess(
    (v) => (!v || v === "none" ? undefined : v),
    z.string().min(1).optional()
  ),
  marketId: z.preprocess(
    (v) => (!v || v === "none" ? undefined : v),
    z.string().min(1).optional()
  ),
  schoolId: z.preprocess(
    (v) => (!v || v === "none" ? undefined : v),
    z.string().min(1).optional()
  ),
  sourceId: z.preprocess(
    (v) => (!v || v === "none" ? undefined : v),
    z.string().min(1).optional()
  ),
  attendees: z.array(attendeeSchema).optional().nullable(),
});

const listQuerySchema = z.object({
  type: z.enum(["SCHOOL_VISIT", "AGENT_MEETING", "STUDENT_EVENT", "FAIR", "PARTNER_MEETING"]).optional(),
  search: z.string().optional(),
});

// ─── GET /api/activities ──────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!(await effectiveHasPermission(session.user.role, "activities", "read"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = req.nextUrl;
    const queryResult = listQuerySchema.safeParse(
      Object.fromEntries(searchParams.entries())
    );

    if (!queryResult.success) {
      return NextResponse.json(
        { error: "Invalid query parameters", details: queryResult.error.flatten() },
        { status: 400 }
      );
    }

    const { type, search } = queryResult.data;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      deletedAt: null,
      ...(type && { type }),
      ...(search && {
        OR: [
          { title: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
          { city: { contains: search, mode: "insensitive" } },
          { country: { contains: search, mode: "insensitive" } },
          { location: { contains: search, mode: "insensitive" } },
        ],
      }),
    };

    const activities = await db.activity.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, image: true } },
        institution: { select: { id: true, name: true } },
        market: { select: { id: true, name: true } },
        school: { select: { id: true, name: true } },
        source: { select: { id: true, name: true } },
        _count: { select: { attendees: true } },
      },
      orderBy: { date: "desc" },
      take: 100,
    });

    return NextResponse.json({ data: activities });
  } catch (error) {
    console.error("[GET /api/activities]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── POST /api/activities ─────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!(await effectiveHasPermission(session.user.role, "activities", "write"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const userId = session.user.id;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = createActivitySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 422 }
      );
    }

    const data = parsed.data;

    // Auto-calculate ROI for fairs
    let roi: number | null = null;
    if (data.type === "FAIR" && data.cost && data.cost > 0 && data.leadsGenerated && data.leadsGenerated > 0) {
      roi = data.leadsGenerated / data.cost;
    }

    const activity = await db.activity.create({
      data: {
        type: data.type,
        title: data.title,
        description: data.description ?? null,
        date: new Date(data.date),
        endDate: data.endDate ? new Date(data.endDate) : null,
        location: data.location ?? null,
        city: data.city ?? null,
        country: data.country ?? null,
        studentsEngaged: data.studentsEngaged ?? null,
        counsellorsEngaged: data.counsellorsEngaged ?? null,
        leadsGenerated: data.leadsGenerated ?? null,
        applicationsGenerated: data.applicationsGenerated ?? null,
        cost: data.cost ?? null,
        roi,
        outcomes: data.outcomes ?? null,
        followUp: data.followUp ?? null,
        actionItems: data.actionItems ?? undefined,
        topics: data.topics ?? null,
        userId,
        institutionId: data.institutionId ?? null,
        marketId: data.marketId ?? null,
        schoolId: data.schoolId ?? null,
        sourceId: data.sourceId ?? null,
        ...(data.attendees && data.attendees.length > 0
          ? {
              attendees: {
                create: data.attendees.map((a) => ({
                  name: a.name,
                  email: a.email ?? null,
                  organization: a.organization ?? null,
                  role: a.role ?? null,
                  notes: a.notes ?? null,
                })),
              },
            }
          : {}),
      },
      include: {
        user: { select: { id: true, name: true, image: true } },
        institution: { select: { id: true, name: true } },
        market: { select: { id: true, name: true } },
        school: { select: { id: true, name: true } },
        source: { select: { id: true, name: true } },
        attendees: true,
        _count: { select: { attendees: true } },
      },
    });

    return NextResponse.json({ data: activity }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/activities]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
