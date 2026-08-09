import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";

const blankToUndefined = (v: unknown) =>
  v === "" || v === null || v === "none" ? undefined : v;

const updateSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  description: z.preprocess(blankToUndefined, z.string().optional()),
  category: z
    .enum([
      "CLIENT_RELATIONSHIP", "SERVICE_DELIVERY", "RECRUITMENT_PERFORMANCE",
      "STAFFING", "CONTRACT", "FINANCE", "COMPLIANCE", "TECHNOLOGY",
      "STUDENT_CASE", "OTHER",
    ])
    .optional(),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  status: z
    .enum(["OPEN", "IN_PROGRESS", "AWAITING_CLIENT", "AWAITING_INTERNAL_ACTION", "RESOLVED", "CLOSED"])
    .optional(),
  ownerId: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  targetResolutionAt: z.preprocess(blankToUndefined, z.string().datetime().optional()),
  resolutionNotes: z.preprocess(blankToUndefined, z.string().optional()),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; issueId: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await effectiveHasPermission(session.user.role as Role, "institutions", "write"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: institutionId, issueId } = await params;

  const existing = await db.clientIssue.findFirst({
    where: { id: issueId, institutionId },
    select: { id: true, ownerId: true, status: true, title: true },
  });
  if (!existing) return NextResponse.json({ error: "Issue not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }
  const d = parsed.data;

  // If status transitions to RESOLVED/CLOSED, stamp resolvedAt.
  const resolvingNow =
    d.status && (d.status === "RESOLVED" || d.status === "CLOSED") &&
    existing.status !== "RESOLVED" && existing.status !== "CLOSED";

  const updated = await db.clientIssue.update({
    where: { id: issueId },
    data: {
      title: d.title,
      description: d.description,
      category: d.category,
      severity: d.severity,
      status: d.status,
      ownerId: d.ownerId,
      targetResolutionAt: d.targetResolutionAt ? new Date(d.targetResolutionAt) : undefined,
      resolutionNotes: d.resolutionNotes,
      ...(resolvingNow ? { resolvedAt: new Date() } : {}),
    },
    include: {
      owner: { select: { id: true, name: true, email: true } },
    },
  });

  // Notify new owner on reassignment.
  if (d.ownerId && d.ownerId !== existing.ownerId) {
    try {
      await db.notification.create({
        data: {
          userId: d.ownerId,
          title: "Issue reassigned to you",
          message: existing.title,
          type: "ISSUE_ASSIGNED",
          link: `/institutions/${institutionId}?tab=issues`,
        },
      });
    } catch {
      /* non-fatal */
    }
  }

  return NextResponse.json({ data: updated });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; issueId: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await effectiveHasPermission(session.user.role as Role, "institutions", "delete"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id: institutionId, issueId } = await params;

  const existing = await db.clientIssue.findFirst({
    where: { id: issueId, institutionId },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Issue not found" }, { status: 404 });

  await db.clientIssue.delete({ where: { id: issueId } });
  return NextResponse.json({ ok: true });
}
