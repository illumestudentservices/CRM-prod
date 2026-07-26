import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import type { Role } from "@/lib/permissions";
import type { AgentTier } from "@prisma/client";

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
    console.error("[GET /api/stakeholders/agents]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
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

    const body = await req.json();
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
    const source = await db.source.findUnique({ where: { id: sourceId } });
    if (!source || source.deletedAt) {
      return NextResponse.json(
        { error: "Source not found" },
        { status: 404 }
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
        offers: offers ? parseInt(offers, 10) : 0,
        deposits: deposits ? parseInt(deposits, 10) : 0,
        enrolments: enrolments ? parseInt(enrolments, 10) : 0,
        visaApprovals: visaApprovals ? parseInt(visaApprovals, 10) : 0,
        yieldRate: yieldRate ? parseFloat(yieldRate) : null,
        notes: notes || null,
      },
      update: {
        ...(certificationStatus !== undefined && { certificationStatus }),
        ...(icefMembership !== undefined && { icefMembership }),
        ...(countryCoverage !== undefined && { countryCoverage }),
        ...(tier !== undefined && { tier }),
        ...(contractUrl !== undefined && { contractUrl }),
        ...(contractExpiryDate !== undefined && {
          contractExpiryDate: contractExpiryDate
            ? new Date(contractExpiryDate)
            : null,
        }),
        ...(offers !== undefined && {
          offers: parseInt(offers, 10),
        }),
        ...(deposits !== undefined && {
          deposits: parseInt(deposits, 10),
        }),
        ...(enrolments !== undefined && {
          enrolments: parseInt(enrolments, 10),
        }),
        ...(visaApprovals !== undefined && {
          visaApprovals: parseInt(visaApprovals, 10),
        }),
        ...(yieldRate !== undefined && {
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
      },
    });

    return NextResponse.json(agentProfile, { status: 201 });
  } catch (error) {
    console.error("[POST /api/stakeholders/agents]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
