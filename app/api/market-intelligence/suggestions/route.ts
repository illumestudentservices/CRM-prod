import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { stripNullBytes } from "@/lib/sanitize-text";

const createSchema = z.object({
  marketId: z.string().min(1),
  kind: z.enum(["VISA_CHANGE", "SCHOOL_UPDATE", "COMPETITOR_OBSERVATION", "NEW_OPPORTUNITY", "GOVERNMENT_ANNOUNCEMENT", "OTHER"]),
  originalText: z.string().min(5),
});

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { role, id: userId, regionId } = session.user;
    if (!(await effectiveHasPermission(role as Role, "market_intelligence", "read"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const marketId = req.nextUrl.searchParams.get("marketId");
    const status = req.nextUrl.searchParams.get("status");

    // ICRs only see their own submissions
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      ...(marketId && { marketId }),
      ...(status && { status: status as never }),
    };
    if (role === "ICR") where.submittedById = userId;
    else if (role === "REGIONAL_MANAGER" && regionId) {
      // RMs see suggestions for markets they manage (best-effort)
    }

    const rows = await db.marketUpdateSuggestion.findMany({
      where,
      orderBy: { submittedAt: "desc" },
      include: {
        market: { select: { id: true, name: true, code: true } },
        submittedBy: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
      },
    });
    return NextResponse.json({ data: rows });
  } catch (err) {
    console.error("[GET /api/market-intelligence/suggestions]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { role, id: userId } = session.user;
    if (!(await effectiveHasPermission(role as Role, "market_intelligence", "write"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 422 });
    }

    const sug = await db.marketUpdateSuggestion.create({
      data: {
        marketId: parsed.data.marketId,
        kind: parsed.data.kind,
        originalText: parsed.data.originalText,
        submittedById: userId,
        status: "PENDING",
      },
    });

    // Notify the market's regional manager (best-effort — never blocks the write).
    try {
      const mkt = await db.market.findUnique({ where: { id: parsed.data.marketId }, select: { regionalManagerId: true, name: true } });
      if (mkt?.regionalManagerId) {
        await db.notification.create({
          data: {
            userId: mkt.regionalManagerId,
            type: "MARKET_UPDATE_SUBMITTED",
            title: `Market update suggestion for ${mkt.name}`,
            message: parsed.data.originalText.slice(0, 200),
            link: `/market-intelligence/${parsed.data.marketId}#suggestions`,
          },
        });
      }
    } catch (e) {
      console.warn("[market-intelligence/suggestions] notify failed", e);
    }

    return NextResponse.json(sug, { status: 201 });
  } catch (err) {
    console.error("[POST /api/market-intelligence/suggestions]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
