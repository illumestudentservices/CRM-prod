import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { sendFullReportEmail } from "@/lib/email";
import type { Role } from "@/lib/permissions";

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const schema = z.object({
  reportId: z.string().min(1),
  to: z.string().email(),
  message: z.string().max(2000).optional(),
  subject: z.string().max(200).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { role, id: userId, regionId } = session.user as {
      role: Role;
      id: string;
      regionId: string | null;
    };

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 });
    }

    const report = await db.monthlyReport.findFirst({
      where: { id: parsed.data.reportId, deletedAt: null },
      include: {
        icr: { select: { name: true, email: true } },
        institution: { select: { name: true } },
        region: { select: { name: true } },
      },
    });

    if (!report) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    const isExec = ["SUPER_ADMIN", "HQ_EXECUTIVE", "HQ_ANALYTICS"].includes(role);
    if (role === "ICR" && report.icrId !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (role === "REGIONAL_MANAGER" && report.regionId !== regionId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!isExec && role !== "ICR" && role !== "REGIONAL_MANAGER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const period = `${MONTH_NAMES[report.reportingMonth]} ${report.reportingYear}`;
    const senderName = (session.user as { name?: string }).name ?? "An Illume user";
    const kpi = report.kpiSummary as {
      totalLeads: number;
      enrolled: number;
      conversionRate: number;
      contactRate: number;
      eventsCount: number;
      totalEventCost: number;
    } | null;

    const reportUrl = `${process.env.NEXTAUTH_URL ?? "https://illumestudentservices.cloud"}/reports/${report.id}`;

    await sendFullReportEmail({
      to: parsed.data.to,
      senderName,
      icrName: report.icr.name ?? report.icr.email,
      institutionName: report.institution.name,
      period,
      regionName: report.region?.name ?? "N/A",
      kpi,
      engagementSummary: report.engagementNotes ?? undefined,
      successHighlight: report.successStories ?? undefined,
      reportUrl,
      message: parsed.data.message,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[email/send-report] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
