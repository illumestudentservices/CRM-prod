import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity-logger";
import { sendAccountRequestDecisionEmail } from "@/lib/email";
import { canReviewAccountRequest } from "@/lib/account-requests";

const patchSchema = z
  .object({
    action: z.enum(["APPROVE", "REJECT", "MARK_FULFILLED"]),
    reviewNotes: z.string().max(2000).optional(),
  })
  .superRefine((d, ctx) => {
    // A rejection with no explanation tells the manager nothing and invites the
    // same request again next week.
    if (d.action === "REJECT" && (!d.reviewNotes || d.reviewNotes.trim().length < 5)) {
      ctx.addIssue({
        path: ["reviewNotes"],
        code: z.ZodIssueCode.custom,
        message: "A reason is required when rejecting a request.",
      });
    }
  });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { role, id: userId } = session.user;
  if (!canReviewAccountRequest(role)) {
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
  const { action, reviewNotes } = parsed.data;

  const request = await db.accountRequest.findUnique({
    where: { id },
    include: { requestedBy: { select: { id: true, name: true, email: true } } },
  });
  if (!request) return NextResponse.json({ error: "Request not found" }, { status: 404 });

  if (action === "MARK_FULFILLED") {
    if (request.status !== "APPROVED") {
      return NextResponse.json(
        { error: "Only an approved request can be marked as created." },
        { status: 400 }
      );
    }
    const updated = await db.accountRequest.update({
      where: { id },
      data: { fulfilledAt: new Date() },
    });
    void logActivity(userId, "UPDATE", "AccountRequest", id, { action });
    return NextResponse.json({ request: updated });
  }

  // Compare-and-swap on PENDING: two reviewers acting at once would otherwise
  // both "decide" it, and the second would overwrite the first silently.
  const now = new Date();
  const result = await db.accountRequest.updateMany({
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
      { error: "This request has already been decided. Reload to see the current state." },
      { status: 409 }
    );
  }

  // Tell the requester either way — an approval they never hear about leaves
  // them chasing, and a silent rejection is worse.
  if (request.requestedBy?.email) {
    void sendAccountRequestDecisionEmail({
      to: request.requestedBy.email,
      requesterName: request.requestedBy.name ?? "there",
      candidateName: request.fullName,
      approved: action === "APPROVE",
      notes: reviewNotes?.trim() || undefined,
      requestUrl: `${process.env.NEXTAUTH_URL ?? ""}/hr?tab=account-requests`,
    });
  }
  if (request.requestedBy?.id) {
    await db.notification.create({
      data: {
        userId: request.requestedBy.id,
        title: action === "APPROVE" ? "Account request approved" : "Account request declined",
        message:
          action === "APPROVE"
            ? `Your request for ${request.fullName} was approved. IT will create the account.`
            : `Your request for ${request.fullName} was declined. ${reviewNotes?.trim() ?? ""}`.trim(),
        type: "ACCOUNT_REQUEST",
        link: "/hr?tab=account-requests",
      },
    });
  }

  void logActivity(userId, action === "APPROVE" ? "APPROVE" : "REJECT", "AccountRequest", id, {
    email: request.email,
    requestedRole: request.requestedRole,
    ...(reviewNotes ? { reviewNotes } : {}),
  });

  const updated = await db.accountRequest.findUniqueOrThrow({
    where: { id },
    include: {
      requestedBy: { select: { id: true, name: true, email: true } },
      reviewedBy: { select: { id: true, name: true } },
      region: { select: { id: true, name: true } },
      department: { select: { id: true, name: true } },
    },
  });
  return NextResponse.json({ request: updated });
}

// ─── DELETE: withdraw a request you raised ───────────────────────────────────

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { role, id: userId } = session.user;
  const { id } = await params;

  const request = await db.accountRequest.findUnique({
    where: { id },
    select: { id: true, requestedById: true, status: true },
  });
  if (!request) return NextResponse.json({ error: "Request not found" }, { status: 404 });

  // A manager may withdraw their own request while it is still pending; only a
  // reviewer may remove anything else.
  const isOwnPending = request.requestedById === userId && request.status === "PENDING";
  if (!isOwnPending && !canReviewAccountRequest(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await db.accountRequest.delete({ where: { id } });
  void logActivity(userId, "DELETE", "AccountRequest", id, {});
  return NextResponse.json({ deleted: true });
}
