import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { logActivity } from "@/lib/activity-logger";
import { sendAccountRequestEmail } from "@/lib/email";
import {
  canRequestAccount,
  canReviewAccountRequest,
  REQUESTABLE_ROLES,
  ACCOUNT_REQUEST_INBOX,
  requestFullName,
} from "@/lib/account-requests";

/**
 * The joiner has no work mailbox yet — creating it is the point of the request —
 * so this must be a personal address for IT to send the new credentials to.
 * Rejecting the company domains turns that from a label into a rule; the form
 * used to placehold "jane@illumestudentservices.ca", which is exactly the wrong
 * answer.
 */
const COMPANY_EMAIL_DOMAINS = ["illumestudentservices.ca", "illumestudentservices.cloud"];

const createSchema = z.object({
  firstName: z.string().min(1, "First name is required").max(80),
  // Optional: plenty of people have no middle name, and requiring one invites junk.
  middleName: z.string().max(80).optional().nullable(),
  lastName: z.string().min(1, "Last name is required").max(80),
  personalEmail: z
    .string()
    .email("A valid personal email address is required")
    .refine(
      (v) => !COMPANY_EMAIL_DOMAINS.some((d) => v.trim().toLowerCase().endsWith(`@${d}`)),
      "Use the joiner's personal email address — their Illume mailbox does not exist yet, and this is where their credentials will be sent."
    ),
  jobTitle: z.string().min(2, "Job title is required").max(120),
  requestedRole: z.enum(REQUESTABLE_ROLES as unknown as [Role, ...Role[]]),
  employmentType: z.enum(["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN"]).default("FULL_TIME"),
  startDate: z.string().min(1, "Start date is required"),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  regionId: z.string().min(1).optional().nullable(),
  departmentId: z.string().min(1).optional().nullable(),
  // Required deliberately: a reviewer approving a login should never have to
  // guess why it was asked for.
  justification: z.string().min(10, "Please explain why this account is needed").max(2000),
});

// ─── GET: the queue ──────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { role, id: userId } = session.user;
  const status = req.nextUrl.searchParams.get("status");

  // Reviewers see everything; a requester sees only what they raised, so one
  // manager cannot read another's hiring plans.
  const where: Record<string, unknown> = canReviewAccountRequest(role)
    ? {}
    : { requestedById: userId };
  if (status) where.status = status;

  const requests = await db.accountRequest.findMany({
    where,
    include: {
      requestedBy: { select: { id: true, name: true, email: true } },
      reviewedBy: { select: { id: true, name: true } },
      region: { select: { id: true, name: true } },
      department: { select: { id: true, name: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
  });

  return NextResponse.json({
    requests,
    canReview: canReviewAccountRequest(role),
    canRequest: canRequestAccount(role),
  });
}

// ─── POST: raise a request ───────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { role, id: userId } = session.user;
  if (!canRequestAccount(role)) {
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
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }
  const data = parsed.data;
  const personalEmail = data.personalEmail.trim().toLowerCase();

  // This used to look the address up in `users` to catch someone already
  // onboarded. That check is now near-useless — a personal address will not match
  // a work login — but it is retained because it still catches the case that
  // matters: a contractor whose personal address WAS used as their login. The
  // message no longer claims an account "exists for that email" in general terms.
  const existing = await db.user.findUnique({
    where: { email: personalEmail },
    select: { id: true, isActive: true, deletedAt: true },
  });
  if (existing && !existing.deletedAt) {
    return NextResponse.json(
      {
        error: existing.isActive
          ? "An active account already signs in with that address. This person appears to be onboarded already."
          : "An account already signs in with that address but is disabled. Ask IT to re-enable it rather than raising a new request.",
      },
      { status: 409 }
    );
  }

  // The real duplicate guard now: the same person queued twice. Matched on the
  // personal address, which is stable across however the name was typed.
  const openDuplicate = await db.accountRequest.findFirst({
    where: { personalEmail, status: "PENDING" },
    select: { id: true, requestedBy: { select: { name: true } } },
  });
  if (openDuplicate) {
    return NextResponse.json(
      {
        error: `There is already a pending request for that person, raised by ${openDuplicate.requestedBy?.name ?? "another manager"}.`,
      },
      { status: 409 }
    );
  }

  const request = await db.accountRequest.create({
    data: {
      firstName: data.firstName.trim(),
      middleName: data.middleName?.trim() || null,
      lastName: data.lastName.trim(),
      personalEmail,
      jobTitle: data.jobTitle.trim(),
      requestedRole: data.requestedRole,
      employmentType: data.employmentType,
      startDate: new Date(data.startDate),
      gender: data.gender ?? null,
      phone: data.phone?.trim() || null,
      regionId: data.regionId ?? null,
      departmentId: data.departmentId ?? null,
      justification: data.justification.trim(),
      requestedById: userId,
    },
    include: {
      requestedBy: { select: { name: true, email: true } },
      region: { select: { name: true } },
      department: { select: { name: true } },
    },
  });

  // In-app notification as well as email: an email can be missed or filtered,
  // and the request should be visible in the product on its own.
  const reviewers = await db.user.findMany({
    where: { role: "SUPER_ADMIN", isActive: true, deletedAt: null },
    select: { id: true },
  });
  if (reviewers.length) {
    await db.notification.createMany({
      data: reviewers.map((r) => ({
        userId: r.id,
        title: "New account request",
        message: `${request.requestedBy?.name ?? "A manager"} requested an account for ${requestFullName(request)} (${request.jobTitle}).`,
        type: "ACCOUNT_REQUEST",
        link: "/hr?tab=account-requests",
      })),
    });
  }

  // Fire-and-forget: a mail failure must not lose a request that is already
  // stored and visible in the queue.
  void sendAccountRequestEmail({
    to: ACCOUNT_REQUEST_INBOX,
    fullName: requestFullName(request),
    personalEmail: request.personalEmail,
    jobTitle: request.jobTitle,
    requestedRole: request.requestedRole,
    employmentType: request.employmentType,
    startDate: request.startDate.toISOString().slice(0, 10),
    region: request.region?.name ?? null,
    department: request.department?.name ?? null,
    phone: request.phone,
    justification: request.justification,
    requestedByName: request.requestedBy?.name ?? "Unknown",
    requestedByEmail: request.requestedBy?.email ?? "",
    reviewUrl: `${process.env.NEXTAUTH_URL ?? ""}/hr?tab=account-requests`,
  });

  void logActivity(userId, "CREATE", "AccountRequest", request.id, {
    personalEmail: request.personalEmail,
    requestedRole: request.requestedRole,
  });

  return NextResponse.json({ request }, { status: 201 });
}
