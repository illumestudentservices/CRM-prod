import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditOrigin } from "@/lib/activity-logger";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { trashRecord } from "@/lib/recycle-bin";

// ─── GET /api/stakeholders/agents/:id ─────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (!(await effectiveHasPermission(session.user.role, "stakeholders", "read")))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;

    const agent = await db.agentProfile.findUnique({
      where: { id },
      include: {
        source: {
          select: {
            id: true,
            name: true,
            type: true,
            country: true,
            city: true,
            email: true,
            phone: true,
            contactPerson: true,
            rating: true,
          },
        },
      },
    });

    if (!agent) {
      return NextResponse.json(
        { error: "Agent profile not found" },
        { status: 404 }
      );
    }

    // Get lead count and conversion stats
    const leads = await db.lead.findMany({
      where: { sourceId: agent.sourceId, deletedAt: null },
      select: { stage: true },
    });

    const totalLeads = leads.length;
    const enrolledLeads = leads.filter((l) => l.stage === "ENROLLED").length;
    const conversionRate =
      totalLeads > 0 ? (enrolledLeads / totalLeads) * 100 : 0;
    const visaApprovalRate =
      agent.offers > 0
        ? (agent.visaApprovals / agent.offers) * 100
        : 0;

    return NextResponse.json({
      ...agent,
      totalLeads,
      enrolledLeads,
      conversionRate,
      visaApprovalRate,
    });
  } catch (error) {
    console.error("[GET /api/stakeholders/agents/:id]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ─── PATCH /api/stakeholders/agents/:id ───────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (!(await effectiveHasPermission(session.user.role, "stakeholders", "write")))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;

    const existing = await db.agentProfile.findUnique({ where: { id } });
    if (!existing)
      return NextResponse.json(
        { error: "Agent profile not found" },
        { status: 404 }
      );

    const body = await req.json();
    const {
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

    const updated = await db.agentProfile.update({
      where: { id },
      data: {
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
        action: "UPDATE",
        entity: "AgentProfile",
        entityId: updated.id,
        userId: session.user.id,
        changes: { before: existing, after: body },
      
        ...(await auditOrigin()),
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[PATCH /api/stakeholders/agents/:id]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ─── DELETE /api/stakeholders/agents/:id ──────────────────────────────────

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (!(await effectiveHasPermission(session.user.role, "stakeholders", "delete")))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;

    const existing = await db.agentProfile.findUnique({ where: { id } });
    if (!existing)
      return NextResponse.json(
        { error: "Agent profile not found" },
        { status: 404 }
      );

    await trashRecord({ entityType: "AgentProfile", entityId: id, userId: session.user.id });

    await db.auditLog.create({
      data: {
        action: "DELETE",
        entity: "AgentProfile",
        entityId: id,
        userId: session.user.id,
        changes: { before: existing },
      
        ...(await auditOrigin()),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/stakeholders/agents/:id]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
