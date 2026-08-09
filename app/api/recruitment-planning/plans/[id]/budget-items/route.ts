import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";

const createSchema = z.object({
  category: z.enum([
    "FLIGHTS", "ACCOMMODATION", "LOCAL_TRANSPORT", "EVENT_REGISTRATION",
    "MARKETING_MATERIALS", "MEALS", "MISCELLANEOUS",
  ]),
  description: z.string().optional(),
  amount: z.number().nonnegative(),
  currency: z.string().length(3),
  exchangeRate: z.number().positive().optional(),
  exchangeRateDate: z.string().datetime().optional(),
  exchangeRateSource: z.string().optional(),
  allocation: z.enum(["SHARED_EVENT", "INSTITUTION_PARTICIPATION", "ICR_TRAVEL", "GENERAL_ACTIVITY", "PLAN"]).default("PLAN"),
});

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await effectiveHasPermission(session.user.role as Role, "recruitment_planning", "read"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await ctx.params;
    const items = await db.recruitmentPlanBudgetItem.findMany({
      where: { planId: id },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ data: items });
  } catch (err) {
    console.error("[GET budget-items]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { role } = session.user;
    if (!(await effectiveHasPermission(role as Role, "recruitment_planning", "write"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await ctx.params;

    const plan = await db.quarterlyRecruitmentPlan.findUnique({
      where: { id },
      select: { status: true, reportingCurrency: true, icrId: true },
    });
    if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    if (["APPROVED", "ACTIVE", "COMPLETED", "CLOSED"].includes(plan.status)) {
      return NextResponse.json({ error: "Plan is locked. Use a Variation Request to change the budget." }, { status: 409 });
    }

    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 422 });
    }
    const data = parsed.data;

    const convertedAmount = data.exchangeRate ? data.amount * data.exchangeRate : undefined;

    const item = await db.recruitmentPlanBudgetItem.create({
      data: {
        planId: id,
        category: data.category,
        description: data.description,
        amount: data.amount,
        currency: data.currency,
        convertedAmount,
        reportingCurrency: plan.reportingCurrency,
        exchangeRate: data.exchangeRate,
        exchangeRateDate: data.exchangeRateDate ? new Date(data.exchangeRateDate) : undefined,
        exchangeRateSource: data.exchangeRateSource,
        allocation: data.allocation,
      },
    });
    return NextResponse.json(item, { status: 201 });
  } catch (err) {
    console.error("[POST budget-items]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
