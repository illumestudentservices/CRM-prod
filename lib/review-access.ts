import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import type { Role } from "@/lib/permissions";

/**
 * Who may read and write a performance review.
 *
 * ★ THE FAULT THIS EXISTS TO CLOSE.
 *
 * Both routes asked one question — does this role hold erp_hr? — and erp_hr is
 * held by SUPER_ADMIN, HR_MANAGER and HQ_EXECUTIVE (read only). No HR_MANAGER
 * account exists at Illume. So one person could write every review for a
 * hundred and one people, a manager could not review their own team, and the
 * person being reviewed got a 403 on their own appraisal.
 *
 * A review the subject cannot read is not a review. The rules now are:
 *
 *   WRITE   erp_hr:write (admins), or the subject's own line manager
 *   READ    erp_hr:read  (admins), or the line manager, or the reviewer who
 *           wrote it, or the subject — but the subject sees it only once it is
 *           COMPLETED
 *
 * ★ WHY THE SUBJECT WAITS FOR COMPLETED.
 *
 * A draft is a manager thinking out loud. Showing it live would mean the
 * employee reading half-finished criticism, and the manager learning to write
 * nothing down until the end — which defeats the record. COMPLETED is the
 * moment the reviewer says it is ready to be read.
 *
 * ★ NOBODY REVIEWS THEMSELVES.
 *
 * Enforced even for an admin. A self-written appraisal is not evidence of
 * anything, and the one case where it looks tempting — a CEO with no manager —
 * is exactly the case where it is worth least.
 */

export const REVIEW_STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Score is a 0–5 scale; the form has always said so, the API never did. */
export const SCORE_MIN = 0;
export const SCORE_MAX = 5;

export type Actor = {
  userId: string;
  role: Role;
  /** The actor's own Employee.id, if they have a record. */
  employeeId: string | null;
};

/** Loads the acting user's employee id alongside their session role. */
export async function actorFor(session: {
  user: { id: string; role: string };
}): Promise<Actor> {
  const emp = await db.employee.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  return {
    userId: session.user.id,
    role: session.user.role as Role,
    employeeId: emp?.id ?? null,
  };
}

export async function isReviewAdmin(actor: Actor, action: "read" | "write" | "delete") {
  return effectiveHasPermission(actor.role, "erp_hr", action);
}

/** True when `actor` is the line manager of `employeeId`. */
export async function managesEmployee(actor: Actor, employeeId: string) {
  if (!actor.employeeId) return false;
  const hit = await db.employee.findFirst({
    where: { id: employeeId, managerId: actor.employeeId },
    select: { id: true },
  });
  return !!hit;
}

/**
 * May this actor write a review about this employee?
 * Returns null when allowed, or an error to return verbatim.
 */
export async function refuseWrite(
  actor: Actor,
  employeeId: string,
): Promise<{ status: number; error: string } | null> {
  if (actor.employeeId && actor.employeeId === employeeId) {
    return {
      status: 422,
      error: "You cannot write your own performance review.",
    };
  }
  if (await isReviewAdmin(actor, "write")) return null;
  if (await managesEmployee(actor, employeeId)) return null;
  return {
    status: 403,
    error: "You can only review the people who report to you.",
  };
}

/** The reviews this actor is allowed to see, as a Prisma `where`. */
export async function visibleReviewWhere(
  actor: Actor,
): Promise<Prisma.PerformanceReviewWhereInput> {
  if (await isReviewAdmin(actor, "read")) return {};

  // No employee record: nothing is about them and nothing reports to them.
  if (!actor.employeeId) return { id: { in: [] } };

  return {
    OR: [
      // Their own, once the reviewer has finished it.
      { employeeId: actor.employeeId, status: "COMPLETED" },
      // Their team's, at any stage.
      { employee: { managerId: actor.employeeId } },
      // Anything they wrote themselves.
      { reviewerId: actor.employeeId },
    ],
  };
}

/** May this actor change or delete this particular review? */
export async function refuseEdit(
  actor: Actor,
  review: { employeeId: string; reviewerId: string | null },
): Promise<{ status: number; error: string } | null> {
  if (await isReviewAdmin(actor, "write")) return null;
  if (actor.employeeId && review.reviewerId === actor.employeeId) return null;
  if (await managesEmployee(actor, review.employeeId)) return null;
  return {
    status: 403,
    error: "You can only change a review you wrote, or one for your own team.",
  };
}

/**
 * The fields a review may expose.
 *
 * ★ select, NOT include.
 *
 * Both routes used `include: { employee: { include: { user: ... } } }`, which
 * returns every scalar on Employee — so the home address, personal phone and
 * emergency contact of the person being reviewed shipped with every row, to
 * every reader, on a screen that needs none of them.
 */
export const REVIEW_SELECT = {
  id: true,
  employeeId: true,
  reviewerId: true,
  period: true,
  score: true,
  strengths: true,
  improvements: true,
  goals: true,
  status: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  employee: {
    select: {
      id: true,
      employeeId: true,
      jobTitle: true,
      user: { select: { id: true, name: true, image: true } },
    },
  },
  reviewer: {
    select: {
      id: true,
      user: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.PerformanceReviewSelect;
