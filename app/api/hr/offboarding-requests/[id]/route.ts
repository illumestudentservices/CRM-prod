import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity-logger";
import { sendOffboardingRequestDecisionEmail } from "@/lib/email";
import { displayNameOr } from "@/lib/person-name";
import { canReviewOffboardingRequest } from "@/lib/offboarding-requests";
import { trashRecord } from "@/lib/recycle-bin";
import { summariseWorkload } from "@/lib/workload-reassignment";

const patchSchema = z
  .object({
    action: z.enum(["APPROVE", "REJECT", "MARK_COMPLETE"]),
    reviewNotes: z.string().max(2000).optional(),
    /**
     * Proceed with marking access revoked even though the leaver still owns
     * live records. See the MARK_COMPLETE branch for why this exists.
     */
    override: z.boolean().optional(),
    overrideReason: z.string().max(2000).optional(),
  })
  .superRefine((d, ctx) => {
    // A rejection with no explanation tells the manager nothing, and here it
    // matters more than on an account request: they may be mid-conversation with
    // someone who has already resigned.
    if (d.action === "REJECT" && (!d.reviewNotes || d.reviewNotes.trim().length < 5)) {
      ctx.addIssue({
        path: ["reviewNotes"],
        code: z.ZodIssueCode.custom,
        message: "A reason is required when declining a departure.",
      });
    }
    // Knowingly orphaning a caseload has to be justified in writing. The point
    // is the record, so a blank or one-word reason is refused.
    if (d.override && (!d.overrideReason || d.overrideReason.trim().length < 10)) {
      ctx.addIssue({
        path: ["overrideReason"],
        code: z.ZodIssueCode.custom,
        message:
          "Explain why access must be revoked before the workload is reassigned (at least 10 characters).",
      });
    }
  });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { role, id: userId } = session.user;
  if (!canReviewOffboardingRequest(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }
  const { action, reviewNotes, override, overrideReason } = parsed.data;

  const request = await db.offboardingRequest.findUnique({
    where: { id },
    include: {
      requestedBy: { select: { id: true, name: true, email: true } },
      employee: {
        select: {
          employeeId: true,
          userId: true,
          user: { select: { firstName: true, lastName: true, email: true } },
        },
      },
    },
  });
  if (!request) return NextResponse.json({ error: "Request not found" }, { status: 404 });

  const employeeName = displayNameOr(request.employee.user, request.employee.user.email);
  const lastDay = request.lastWorkingDay.toISOString().slice(0, 10);

  if (action === "MARK_COMPLETE") {
    if (request.status !== "APPROVED") {
      return NextResponse.json(
        { error: "Only an approved departure can be marked as complete." },
        { status: 400 }
      );
    }
    // Idempotent on purpose: two clicks should not move the timestamp and make
    // the audit trail disagree with itself about when access was cut.
    if (request.completedAt) {
      return NextResponse.json({ request });
    }

    // ── The orphaned-caseload block ──────────────────────────────────────
    //
    // Access cannot be revoked while the leaver still owns live students,
    // tasks or field work: that is precisely the hole this whole feature was
    // built to close. The departure queue used to be able to complete with a
    // full caseload pointing at an account nobody could sign into, and nothing
    // anywhere surfaced it.
    //
    // The override is deliberate-friction plus an audit record, NOT a
    // privilege boundary — REVIEWER_ROLES is already ["SUPER_ADMIN"], so
    // everyone who can reach this branch can also override it. What it buys is
    // that orphaning a caseload becomes an explicit, reasoned, attributable act
    // instead of a silent side effect of clicking the obvious button. That
    // matters more than a role gate here, because the case it exists for is a
    // termination where cutting access today is the correct call.
    const workload = await summariseWorkload(request.employee.userId);
    if (!workload.isClear && !override) {
      return NextResponse.json(
        {
          error:
            "This person still owns live work. Reassign it first, or override with a reason.",
          blocked: "UNREASSIGNED_WORKLOAD",
          workload,
        },
        { status: 409 }
      );
    }

    const now = new Date();
    const updated = await db.offboardingRequest.update({
      where: { id },
      data: { completedAt: now },
    });

    if (!workload.isClear) {
      // Logged as its own action, not folded into the UPDATE row, so the
      // override is greppable in the audit trail rather than buried in a
      // changes blob alongside ordinary completions.
      void logActivity(userId, "OFFBOARDING_REVOKE_OVERRIDE", "OffboardingRequest", id, {
        employeeId: request.employee.employeeId,
        leaverUserId: request.employee.userId,
        reason: overrideReason?.trim(),
        orphanedTotal: workload.total,
        orphaned: Object.fromEntries(workload.buckets.map((b) => [b.key, b.count])),
      });
    }

    void logActivity(userId, "UPDATE", "OffboardingRequest", id, {
      action,
      employeeId: request.employee.employeeId,
      workloadClear: workload.isClear,
      ...(workload.isClear ? {} : { overrode: true, orphanedTotal: workload.total }),
    });
    return NextResponse.json({ request: updated, workload });
  }

  // Compare-and-swap on PENDING: two reviewers acting at once would otherwise
  // both "decide" it, and the second would overwrite the first silently.
  const now = new Date();
  const result = await db.offboardingRequest.updateMany({
    where: { id, status: "PENDING" },
    data: {
      status: action === "APPROVE" ? "APPROVED" : "REJECTED",
      reviewedById: userId,
      reviewedAt: now,
      reviewNotes: reviewNotes?.trim() || null,
    },
  });
  if (result.count === 0) {
    return NextResponse.json(
      { error: "This departure has already been decided. Reload to see the current state." },
      { status: 409 }
    );
  }

  // Tell the requester either way — a manager who does not hear back cannot tell
  // whether the leaver's access is being dealt with.
  if (request.requestedBy?.email) {
    void sendOffboardingRequestDecisionEmail({
      to: request.requestedBy.email,
      requesterName: request.requestedBy.name ?? "there",
      employeeName,
      lastWorkingDay: lastDay,
      approved: action === "APPROVE",
      notes: reviewNotes?.trim() || undefined,
      requestUrl: `${process.env.NEXTAUTH_URL ?? ""}/hr?tab=offboarding`,
    });
  }
  if (request.requestedBy?.id) {
    await db.notification.create({
      data: {
        userId: request.requestedBy.id,
        title: action === "APPROVE" ? "Offboarding approved" : "Offboarding declined",
        message:
          action === "APPROVE"
            ? `The departure you raised for ${employeeName} was approved. IT will revoke their access.`
            : `The departure you raised for ${employeeName} was declined. ${reviewNotes?.trim() ?? ""}`.trim(),
        type: "OFFBOARDING_REQUEST",
        link: "/hr?tab=offboarding",
      },
    });
  }

  void logActivity(userId, action === "APPROVE" ? "APPROVE" : "REJECT", "OffboardingRequest", id, {
    employeeId: request.employee.employeeId,
    reason: request.reason,
    lastWorkingDay: lastDay,
    ...(reviewNotes ? { reviewNotes } : {}),
  });

  const updated = await db.offboardingRequest.findUniqueOrThrow({
    where: { id },
    include: {
      employee: {
        select: {
          id: true,
          employeeId: true,
          jobTitle: true,
          department: { select: { id: true, name: true } },
          user: {
            select: {
              id: true,
              name: true,
              firstName: true,
              lastName: true,
              email: true,
              role: true,
              isActive: true,
              region: { select: { id: true, name: true } },
            },
          },
        },
      },
      requestedBy: { select: { id: true, name: true, email: true } },
      reviewedBy: { select: { id: true, name: true } },
    },
  });
  return NextResponse.json({ request: updated });
}

// ─── DELETE: withdraw a departure you raised ─────────────────────────────────

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { role, id: userId } = session.user;
  const { id } = await params;

  const request = await db.offboardingRequest.findUnique({
    where: { id },
    select: { id: true, requestedById: true, status: true },
  });
  if (!request) return NextResponse.json({ error: "Request not found" }, { status: 404 });

  // A manager may withdraw their own while it is still pending — a resignation
  // does get retracted. Only a reviewer may remove anything already decided.
  const isOwnPending = request.requestedById === userId && request.status === "PENDING";
  if (!isOwnPending && !canReviewOffboardingRequest(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await trashRecord({ entityType: "OffboardingRequest", entityId: id, userId: session.user.id });
  void logActivity(userId, "DELETE", "OffboardingRequest", id, {});
  return NextResponse.json({ deleted: true });
}
