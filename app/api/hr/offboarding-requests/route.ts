import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { OffboardingReason } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity-logger";
import { sendOffboardingRequestEmail } from "@/lib/email";
import { displayNameOr } from "@/lib/person-name";
import {
  canRequestOffboarding,
  canReviewOffboardingRequest,
  canTargetRole,
  employeeScopeFor,
  OFFBOARDING_REASONS,
  OFFBOARDING_REQUEST_INBOX,
  REVOCATION_STEPS,
} from "@/lib/offboarding-requests";
import { hasCapability } from "@/lib/granular-permissions";
import type { Role } from "@/lib/permissions";
import { summariseWorkload } from "@/lib/workload-reassignment";

/** Shared between the queue and the created-row response. */
const REQUEST_INCLUDE = {
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
} as const;

const createSchema = z.object({
  employeeId: z.string().min(1, "Choose who is leaving"),
  // Cast to the Prisma enum tuple, as the account-request route does for Role:
  // it keeps the single list in lib/ authoritative while giving `data.reason` the
  // exact type Prisma wants, so no cast is needed at the create call.
  reason: z.enum(OFFBOARDING_REASONS as unknown as [OffboardingReason, ...OffboardingReason[]]),
  lastWorkingDay: z.string().min(1, "Last working day is required"),
  // Optional: a dismissal often has no cooperative forwarding address, and
  // demanding one would push people into typing something false.
  forwardingEmail: z
    .string()
    .email("Enter a valid forwarding email, or leave it blank")
    .optional()
    .nullable()
    .or(z.literal("")),
  // Required deliberately. A reviewer about to cut someone's access should never
  // have to guess at the circumstances.
  notes: z.string().min(10, "Please explain the circumstances").max(2000),
});

// ─── GET: the queue ──────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { role, id: userId } = session.user;

  // Not a permitted requester and not a reviewer: no business reading departures
  // at all. Unlike the account-request queue, the mere existence of a row here
  // tells you someone is being dismissed, so this fails closed rather than
  // returning an empty list.
  if (!canRequestOffboarding(role) && !canReviewOffboardingRequest(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const status = req.nextUrl.searchParams.get("status");

  // Reviewers see everything; a requester sees only what they raised, so one
  // manager cannot read another's departures.
  const where: Record<string, unknown> = canReviewOffboardingRequest(role)
    ? {}
    : { requestedById: userId };
  if (status) where.status = status;

  const requests = await db.offboardingRequest.findMany({
    where,
    include: REQUEST_INCLUDE,
    orderBy: [{ status: "asc" }, { lastWorkingDay: "asc" }],
    take: 200,
  });

  // How much live work each leaver still owns, so the queue can show the block
  // on "Mark access revoked" rather than only discovering it on click.
  //
  // Computed ONLY for approved-but-not-yet-revoked rows: that is the single
  // state where the answer changes what the operator can do. Doing it for the
  // whole queue would be seven counting queries per row for pending and
  // long-closed departures that cannot act on the number anyway.
  const needsWorkload = requests.filter((r) => r.status === "APPROVED" && !r.completedAt);
  const workloads = Object.fromEntries(
    await Promise.all(
      needsWorkload.map(
        async (r) => [r.id, await summariseWorkload(r.employee.user.id)] as const
      )
    )
  );

  return NextResponse.json({
    requests,
    workloads,
    canReview: canReviewOffboardingRequest(role),
    canRequest: canRequestOffboarding(role),
    canReassign: await hasCapability(role as Role, "leads.bulk_reassign"),
    revocationSteps: REVOCATION_STEPS,
  });
}

// ─── POST: raise a departure ─────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { role, id: userId } = session.user;
  if (!canRequestOffboarding(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }
  const data = parsed.data;

  // Re-derive the requester's own region from the DB rather than trusting the
  // JWT: a region moved after the token was issued would otherwise keep working
  // against the old scope for up to the session lifetime.
  const requester = await db.user.findUnique({
    where: { id: userId },
    select: { regionId: true },
  });

  const scope = employeeScopeFor(role, requester?.regionId);
  if (scope === null) {
    return NextResponse.json(
      {
        error:
          "You have no region assigned, so there is nobody you can offboard. Ask IT to set your region.",
      },
      { status: 403 }
    );
  }

  // The scope is applied HERE and not only in the picker — filtering a dropdown
  // does nothing against a hand-crafted employeeId.
  const employee = await db.employee.findFirst({
    // Scope merged through AND rather than spread, so it cannot be shadowed by a
    // key above it and does not depend on the scope's internal shape.
    where: { id: data.employeeId, AND: [scope] },
    select: {
      id: true,
      employeeId: true,
      jobTitle: true,
      isActive: true,
      department: { select: { name: true } },
      user: {
        select: {
          id: true,
          name: true,
          firstName: true,
          lastName: true,
          email: true,
          role: true,
          deletedAt: true,
          region: { select: { name: true } },
        },
      },
    },
  });
  // 404 rather than 403 for an employee outside scope: a 403 would confirm the
  // id belongs to a real member of staff in another region.
  if (!employee) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }

  if (!canTargetRole(role, employee.user.role)) {
    return NextResponse.json(
      { error: "A Super Admin's account can only be offboarded by another Super Admin." },
      { status: 403 }
    );
  }

  if (!employee.isActive || employee.user.deletedAt) {
    return NextResponse.json(
      { error: "That employee record is already closed, so there is nothing to offboard." },
      { status: 409 }
    );
  }

  // Same person queued twice — two managers both hearing the news, typically.
  const openDuplicate = await db.offboardingRequest.findFirst({
    where: { employeeId: employee.id, status: "PENDING" },
    select: { id: true, requestedBy: { select: { name: true } } },
  });
  if (openDuplicate) {
    return NextResponse.json(
      {
        error: `There is already a pending departure for that person, raised by ${openDuplicate.requestedBy?.name ?? "another manager"}.`,
      },
      { status: 409 }
    );
  }

  const forwardingEmail = data.forwardingEmail?.trim().toLowerCase() || null;

  const request = await db.offboardingRequest.create({
    data: {
      employeeId: employee.id,
      reason: data.reason,
      lastWorkingDay: new Date(data.lastWorkingDay),
      forwardingEmail,
      notes: data.notes.trim(),
      requestedById: userId,
    },
    include: REQUEST_INCLUDE,
  });

  const employeeName = displayNameOr(employee.user, employee.user.email);

  // In-app as well as email: an email can be missed or filtered, and a departure
  // should be visible in the product on its own.
  const reviewers = await db.user.findMany({
    where: { role: "SUPER_ADMIN", isActive: true, deletedAt: null },
    select: { id: true },
  });
  if (reviewers.length) {
    await db.notification.createMany({
      data: reviewers.map((r) => ({
        userId: r.id,
        title: "New offboarding request",
        message: `${request.requestedBy?.name ?? "A manager"} raised a departure for ${employeeName} (${employee.jobTitle}), last day ${request.lastWorkingDay.toISOString().slice(0, 10)}.`,
        type: "OFFBOARDING_REQUEST",
        link: "/hr?tab=offboarding",
      })),
    });
  }

  // Fire-and-forget: a mail failure must not lose a departure that is already
  // stored and visible in the queue.
  void sendOffboardingRequestEmail({
    to: OFFBOARDING_REQUEST_INBOX,
    employeeName,
    employeeCode: employee.employeeId,
    workEmail: employee.user.email,
    jobTitle: employee.jobTitle,
    role: employee.user.role,
    department: employee.department?.name ?? null,
    region: employee.user.region?.name ?? null,
    reason: request.reason,
    lastWorkingDay: request.lastWorkingDay.toISOString().slice(0, 10),
    forwardingEmail,
    notes: request.notes,
    revocationSteps: REVOCATION_STEPS,
    requestedByName: request.requestedBy?.name ?? "Unknown",
    requestedByEmail: request.requestedBy?.email ?? "",
    reviewUrl: `${process.env.NEXTAUTH_URL ?? ""}/hr?tab=offboarding`,
  });

  void logActivity(userId, "CREATE", "OffboardingRequest", request.id, {
    employeeId: employee.employeeId,
    reason: request.reason,
    lastWorkingDay: request.lastWorkingDay.toISOString().slice(0, 10),
  });

  return NextResponse.json({ request }, { status: 201 });
}
