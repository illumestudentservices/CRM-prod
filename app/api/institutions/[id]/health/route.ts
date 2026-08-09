import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";

/**
 * Spec §11 (Clients) — Account Health.
 *
 * Health is a traffic-light on Institution (GREEN / AMBER / RED / GREY).
 * When set to AMBER or RED, an AccountIntervention record MUST be created
 * with reason + corrective action + action owner + review date.
 *
 * PATCH /api/institutions/[id]/health
 *   - Updates institution.accountHealth in the same request as the
 *     intervention insertion (transactional). Refuses AMBER/RED without a
 *     full intervention payload.
 * GET returns the current health + any un-resolved interventions.
 */

const blankToUndefined = (v: unknown) =>
  v === "" || v === null || v === "none" ? undefined : v;

const updateSchema = z.object({
  health: z.enum(["GREEN", "AMBER", "RED", "GREY"]),
  intervention: z
    .object({
      reason: z.string().min(3),
      correctiveAction: z.string().min(3),
      actionOwnerId: z.string().min(1),
      reviewDate: z.string().datetime(),
    })
    .optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await effectiveHasPermission(session.user.role as Role, "institutions", "read"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;

  const inst = await db.institution.findUnique({
    where: { id },
    select: { id: true, accountHealth: true },
  });
  if (!inst) return NextResponse.json({ error: "Institution not found" }, { status: 404 });

  const openInterventions = await db.accountIntervention.findMany({
    where: { institutionId: id, resolvedAt: null },
    include: { actionOwner: { select: { id: true, name: true, email: true } } },
    orderBy: { reviewDate: "asc" },
  });

  return NextResponse.json({
    data: {
      health: inst.accountHealth,
      openInterventions,
    },
  });
}

export async function PATCH(
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

  // Spec §11 hard requirement: AMBER/RED require a matching intervention.
  const needsIntervention = d.health === "AMBER" || d.health === "RED";
  if (needsIntervention && !d.intervention) {
    return NextResponse.json(
      {
        error:
          "Setting Amber or Red requires reason, corrective action, action owner, and review date.",
      },
      { status: 422 }
    );
  }

  const inst = await db.institution.findUnique({
    where: { id: institutionId },
    select: { id: true },
  });
  if (!inst) return NextResponse.json({ error: "Institution not found" }, { status: 404 });

  // Transaction: flip the health + create the intervention together.
  const result = await db.$transaction(async (tx) => {
    const updated = await tx.institution.update({
      where: { id: institutionId },
      data: { accountHealth: d.health },
      select: { id: true, accountHealth: true },
    });

    let intervention = null;
    if (d.intervention && needsIntervention) {
      intervention = await tx.accountIntervention.create({
        data: {
          institutionId,
          health: d.health,
          reason: d.intervention.reason,
          correctiveAction: d.intervention.correctiveAction,
          actionOwnerId: d.intervention.actionOwnerId,
          reviewDate: new Date(d.intervention.reviewDate),
          createdById: userId,
        },
      });

      // Notify the action owner if it's someone else.
      if (intervention.actionOwnerId !== userId) {
        try {
          await tx.notification.create({
            data: {
              userId: intervention.actionOwnerId,
              title: `Account health set to ${d.health}`,
              message: intervention.reason.slice(0, 140),
              type: "ACCOUNT_HEALTH",
              link: `/institutions/${institutionId}?tab=health`,
            },
          });
        } catch {
          /* non-fatal */
        }
      }
    }

    return { institution: updated, intervention };
  });

  return NextResponse.json({ data: result });
}
