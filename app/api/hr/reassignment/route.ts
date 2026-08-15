import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity-logger";
import { displayNameOr } from "@/lib/person-name";
import { hasCapability } from "@/lib/granular-permissions";
import type { Role } from "@/lib/permissions";
import {
  canReceiveWorkload,
  reassignWorkload,
  ReassignmentError,
  summariseWorkload,
  userScopeForReassignment,
} from "@/lib/workload-reassignment";

/**
 * Bulk workload reassignment.
 *
 * GET  — what this person still owns (the preview, and the offboarding block check)
 * POST — move it to someone else
 *
 * Gated on the `leads.bulk_reassign` capability, which has existed in
 * lib/granular-permissions.ts since Phase 10 but was never wired to a route.
 * Defaults to SUPER_ADMIN / HQ_EXECUTIVE / REGIONAL_MANAGER and is tunable in
 * Settings → Security without a deploy.
 */

const USER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  role: true,
  isActive: true,
  regionId: true,
  region: { select: { id: true, name: true } },
} as const;

/**
 * Load a user the caller is entitled to touch, or null.
 *
 * The scope is merged through `AND` rather than spread so this query never has
 * to know the fragment's internal shape — the same reason the offboarding
 * candidates route does it that way.
 */
async function scopedUser(id: string, scope: Record<string, unknown>) {
  return db.user.findFirst({
    where: { id, deletedAt: null, AND: [scope] },
    select: USER_SELECT,
  });
}

/** Resolves the caller's capability and region in one place for both handlers. */
async function authorise(sessionRole: string, sessionUserId: string) {
  if (!(await hasCapability(sessionRole as Role, "leads.bulk_reassign"))) {
    return {
      error: NextResponse.json(
        { error: "Your role is not permitted to reassign workloads." },
        { status: 403 }
      ),
    };
  }
  // Region comes from the DB, never the JWT: a session lasts 48h, so a manager
  // moved between regions would otherwise keep acting on the old one until it
  // expired.
  const caller = await db.user.findUnique({
    where: { id: sessionUserId },
    select: { regionId: true },
  });
  const scope = userScopeForReassignment(sessionRole, caller?.regionId);
  if (scope === null) {
    return {
      error: NextResponse.json(
        { error: "You have no region assigned, so there is nobody whose workload you can move." },
        { status: 403 }
      ),
    };
  }
  return { scope };
}

// ─── GET: what does this person still own? ───────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { role, id: sessionUserId } = session.user;
  const gate = await authorise(role, sessionUserId);
  if (gate.error) return gate.error;

  const userId = req.nextUrl.searchParams.get("userId")?.trim();
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const user = await scopedUser(userId, gate.scope);
  // 404 rather than 403 for an out-of-scope id: a 403 would confirm the account
  // exists, which is enough to enumerate staff across regions.
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const summary = await summariseWorkload(user.id);
  return NextResponse.json({
    user: {
      id: user.id,
      name: displayNameOr(user, user.email),
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      region: user.region?.name ?? null,
    },
    summary,
  });
}

// ─── POST: move it ───────────────────────────────────────────────────────────

const postSchema = z.object({
  fromUserId: z.string().min(1),
  toUserId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { role, id: sessionUserId } = session.user;
  const gate = await authorise(role, sessionUserId);
  if (gate.error) return gate.error;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }
  const { fromUserId, toUserId } = parsed.data;

  if (fromUserId === toUserId) {
    return NextResponse.json(
      { error: "Choose a different colleague to receive the workload." },
      { status: 422 }
    );
  }

  // Both ends are scoped. Checking only the source would let a regional manager
  // move their own region's caseload to someone outside it.
  const [from, to] = await Promise.all([
    scopedUser(fromUserId, gate.scope),
    scopedUser(toUserId, gate.scope),
  ]);
  if (!from) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (!to) return NextResponse.json({ error: "Recipient not found" }, { status: 404 });

  // The whole point of this feature is that work should never sit with an
  // account nobody uses, so handing it to another disabled one is refused.
  if (!to.isActive) {
    return NextResponse.json(
      { error: "That account is inactive. Choose someone who can still sign in." },
      { status: 422 }
    );
  }
  if (!canReceiveWorkload(to.role)) {
    return NextResponse.json(
      {
        error: `A ${to.role.replace(/_/g, " ").toLowerCase()} cannot hold a student caseload. Choose an ICR or a regional manager.`,
      },
      { status: 422 }
    );
  }

  let outcome;
  try {
    outcome = await reassignWorkload({ fromUserId: from.id, toUserId: to.id });
  } catch (err) {
    if (err instanceof ReassignmentError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    throw err;
  }

  const fromName = displayNameOr(from, from.email);
  const toName = displayNameOr(to, to.email);

  // Tell the recipient. Inheriting a caseload silently is how students go
  // unworked for a month — the receiving ICR has no other signal that their
  // list grew.
  if (outcome.total > 0) {
    await db.notification.create({
      data: {
        userId: to.id,
        title: "Workload reassigned to you",
        message: `${outcome.total} live record${outcome.total === 1 ? "" : "s"} previously owned by ${fromName} ${outcome.total === 1 ? "is" : "are"} now yours.`,
        type: "WORKLOAD_REASSIGNED",
        link: "/students",
      },
    });
  }

  void logActivity(sessionUserId, "REASSIGN_WORKLOAD", "User", from.id, {
    fromUserId: from.id,
    fromName,
    toUserId: to.id,
    toName,
    moved: outcome.moved,
    total: outcome.total,
    ...(outcome.skipped.length ? { skipped: outcome.skipped } : {}),
  });

  return NextResponse.json({
    moved: outcome.moved,
    total: outcome.total,
    skipped: outcome.skipped,
    from: { id: from.id, name: fromName },
    to: { id: to.id, name: toName },
  });
}
