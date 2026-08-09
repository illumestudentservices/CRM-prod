import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";

/**
 * Spec §9 (Clients) — Issues & Actions module.
 *
 * Every institution can have N issues. An issue has a title, category
 * (10 spec values), severity (Low/Medium/High/Critical), owner, target
 * resolution date, and status (6 spec values). Owner is notified on assign
 * and reminded before the target date; overdue High/Critical issues escalate.
 */

const blankToUndefined = (v: unknown) =>
  v === "" || v === null || v === "none" ? undefined : v;

const createSchema = z.object({
  title: z.string().min(3, "Title required").max(200),
  description: z.preprocess(blankToUndefined, z.string().optional()),
  category: z.enum([
    "CLIENT_RELATIONSHIP",
    "SERVICE_DELIVERY",
    "RECRUITMENT_PERFORMANCE",
    "STAFFING",
    "CONTRACT",
    "FINANCE",
    "COMPLIANCE",
    "TECHNOLOGY",
    "STUDENT_CASE",
    "OTHER",
  ]),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  ownerId: z.string().min(1, "Owner required"),
  targetResolutionAt: z.preprocess(blankToUndefined, z.string().datetime().optional()),
});

const updateSchema = createSchema.partial().extend({
  status: z
    .enum(["OPEN", "IN_PROGRESS", "AWAITING_CLIENT", "AWAITING_INTERNAL_ACTION", "RESOLVED", "CLOSED"])
    .optional(),
  resolutionNotes: z.preprocess(blankToUndefined, z.string().optional()),
});

// ── GET ──────────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await effectiveHasPermission(session.user.role as Role, "institutions", "read"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: institutionId } = await params;
  const status = req.nextUrl.searchParams.get("status");
  const severity = req.nextUrl.searchParams.get("severity");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { institutionId };
  if (status) where.status = status;
  if (severity) where.severity = severity;

  const issues = await db.clientIssue.findMany({
    where,
    include: {
      owner: { select: { id: true, name: true, email: true, image: true } },
    },
    orderBy: [
      // Open + higher severity first, then oldest target date.
      { status: "asc" },
      { severity: "desc" },
      { targetResolutionAt: "asc" },
      { openedAt: "desc" },
    ],
  });

  return NextResponse.json({ data: issues });
}

// ── POST ─────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await effectiveHasPermission(session.user.role as Role, "institutions", "write"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const userId = session.user.id;
  const { id: institutionId } = await params;

  // Verify the institution exists so a client-side typo doesn't create a
  // ghost issue with an FK-invalid parent.
  const inst = await db.institution.findUnique({
    where: { id: institutionId },
    select: { id: true },
  });
  if (!inst) return NextResponse.json({ error: "Institution not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const d = parsed.data;

  const issue = await db.clientIssue.create({
    data: {
      institutionId,
      title: d.title,
      description: d.description,
      category: d.category,
      severity: d.severity,
      status: "OPEN",
      ownerId: d.ownerId,
      openedAt: new Date(),
      targetResolutionAt: d.targetResolutionAt ? new Date(d.targetResolutionAt) : null,
      createdById: userId,
    },
    include: {
      owner: { select: { id: true, name: true, email: true } },
    },
  });

  // Spec §9 automation — notify the owner when the issue is assigned.
  if (issue.ownerId !== userId) {
    try {
      await db.notification.create({
        data: {
          userId: issue.ownerId,
          title: "New issue assigned",
          message: `${issue.title} — ${issue.category.replace(/_/g, " ").toLowerCase()}`,
          type: "ISSUE_ASSIGNED",
          link: `/institutions/${institutionId}?tab=issues`,
        },
      });
    } catch {
      /* non-fatal */
    }
  }

  return NextResponse.json({ data: issue }, { status: 201 });
}
