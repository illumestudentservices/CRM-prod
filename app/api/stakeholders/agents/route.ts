import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditOrigin } from "@/lib/activity-logger";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import type { Role } from "@/lib/permissions";
import type { AgentTier } from "@prisma/client";
import { readJsonBody, handleApiError } from "@/lib/api-validation";

// ─── GET /api/stakeholders/agents ─────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (
      !(await effectiveHasPermission(
        session.user.role as Role,
        "stakeholders",
        "read"
      ))
    )
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const tier = searchParams.get("tier") as AgentTier | null;

    const agents = await db.agentProfile.findMany({
      where: {
        ...(tier ? { tier } : {}),
      },
      include: {
        source: {
          select: {
            id: true,
            name: true,
            type: true,
            country: true,
            email: true,
            phone: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Attach lead count from source
    const agentsWithLeadCount = await Promise.all(
      agents.map(async (agent) => {
        const leadCount = await db.lead.count({
          where: { sourceId: agent.sourceId, deletedAt: null },
        });
        return { ...agent, leadCount };
      })
    );

    return NextResponse.json(agentsWithLeadCount);
  } catch (error) {
    return handleApiError(error, "[GET /api/stakeholders/agents]");
  }
}

// ─── POST /api/stakeholders/agents ────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (
      !(await effectiveHasPermission(
        session.user.role as Role,
        "stakeholders",
        "write"
      ))
    )
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await readJsonBody(req);
    const {
      sourceId,
      certificationStatus,
      icefMembership,
      countryCoverage,
      tier,
      contractUrl,
      contractExpiryDate,
      offers,
      deposits,
      enrolments,
      visaApprovals,
      yieldRate,
      notes,
    } = body;

    if (!sourceId) {
      return NextResponse.json(
        { error: "sourceId is required" },
        { status: 400 }
      );
    }

    // Verify source exists and is an agent
    const source = await db.recruitmentPartner.findUnique({ where: { id: sourceId } });
    if (!source || source.deletedAt) {
      return NextResponse.json(
        { error: "Source not found" },
        { status: 404 }
      );
    }

    // Spec §7 (Recruitment Network) — the tier is auto-calculated by the
    // network-automation cron. Reject manual `tier` writes once the cron has
    // stamped tierCalculatedAt, so a user override can't shadow the daily
    // recompute. First-time creates before the cron has ever run still allow
    // an initial tier so early rows aren't blocked.
    const existing = await db.agentProfile.findUnique({
      where: { sourceId },
      select: { tierCalculatedAt: true },
    });
    const tierIsAutoCalculated = !!existing?.tierCalculatedAt;
    if (tierIsAutoCalculated && tier !== undefined && session.user.role !== "SUPER_ADMIN") {
      return NextResponse.json(
        {
          error:
            "Agent tier is calculated automatically and cannot be set manually.",
        },
        { status: 409 }
      );
    }
    // Spec §9 — Leads / Applications / Offers / Deposits / Enrolments /
    // Yield are derived from student records and must not be entered manually.
    // Refuse if the caller tried to. Legacy admins can force a value.
    const manualMetricAttempt =
      offers !== undefined ||
      deposits !== undefined ||
      enrolments !== undefined ||
      visaApprovals !== undefined ||
      yieldRate !== undefined;
    if (manualMetricAttempt && session.user.role !== "SUPER_ADMIN") {
      return NextResponse.json(
        {
          error:
            "Agent performance metrics (leads, offers, deposits, enrolments, yield) are auto-calculated. Manual writes are not accepted.",
        },
        { status: 409 }
      );
    }

    // Upsert: create or update agent profile
    const agentProfile = await db.agentProfile.upsert({
      where: { sourceId },
      create: {
        sourceId,
        certificationStatus: certificationStatus || null,
        icefMembership: icefMembership ?? false,
        countryCoverage: countryCoverage || [],
        tier: tier || "EMERGING",
        contractUrl: contractUrl || null,
        contractExpiryDate: contractExpiryDate
          ? new Date(contractExpiryDate)
          : null,
        // Metric columns keep their defaults on create. Cron populates them.
        offers: 0,
        deposits: 0,
        enrolments: 0,
        visaApprovals: 0,
        yieldRate: null,
        notes: notes || null,
      },
      update: {
        ...(certificationStatus !== undefined && { certificationStatus }),
        ...(icefMembership !== undefined && { icefMembership }),
        ...(countryCoverage !== undefined && { countryCoverage }),
        // Only accepted for SUPER_ADMIN once cron has stamped tierCalculatedAt.
        ...(tier !== undefined && (!tierIsAutoCalculated || session.user.role === "SUPER_ADMIN")
          ? { tier }
          : {}),
        ...(contractUrl !== undefined && { contractUrl }),
        ...(contractExpiryDate !== undefined && {
          contractExpiryDate: contractExpiryDate
            ? new Date(contractExpiryDate)
            : null,
        }),
        // SUPER_ADMIN escape hatch for manual metric overrides (rare — e.g.
        // legacy import fix). Non-admins can't reach this branch.
        ...(offers !== undefined && session.user.role === "SUPER_ADMIN" && {
          offers: parseInt(offers, 10),
        }),
        ...(deposits !== undefined && session.user.role === "SUPER_ADMIN" && {
          deposits: parseInt(deposits, 10),
        }),
        ...(enrolments !== undefined && session.user.role === "SUPER_ADMIN" && {
          enrolments: parseInt(enrolments, 10),
        }),
        ...(visaApprovals !== undefined && session.user.role === "SUPER_ADMIN" && {
          visaApprovals: parseInt(visaApprovals, 10),
        }),
        ...(yieldRate !== undefined && session.user.role === "SUPER_ADMIN" && {
          yieldRate: parseFloat(yieldRate),
        }),
        ...(notes !== undefined && { notes }),
      },
    });

    await db.auditLog.create({
      data: {
        action: "UPSERT",
        entity: "AgentProfile",
        entityId: agentProfile.id,
        userId: session.user.id,
        changes: body,
      
        ...(await auditOrigin()),
      },
    });

    return NextResponse.json(agentProfile, { status: 201 });
  } catch (error) {
    return handleApiError(error, "[POST /api/stakeholders/agents]");
  }
}
