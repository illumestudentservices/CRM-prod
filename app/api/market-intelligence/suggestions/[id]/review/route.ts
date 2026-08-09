import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";

const schema = z.object({
  decision: z.enum(["APPROVED", "REJECTED", "EDITED"]),
  editedText: z.string().optional(),
  reviewNotes: z.string().optional(),
});

/// Spec §7 — RM approve / reject / edit the ICR's suggestion. Only approved
/// or edited suggestions become part of the Market Intelligence record.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { role, id: userId } = session.user;
    if (!(await effectiveHasPermission(role as Role, "market_intelligence", "approve"))) {
      return NextResponse.json({ error: "Only Regional Managers may review suggestions" }, { status: 403 });
    }
    const { id } = await ctx.params;

    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 422 });
    }

    const sug = await db.marketUpdateSuggestion.findUnique({
      where: { id },
      select: { status: true, marketId: true, kind: true, originalText: true },
    });
    if (!sug) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (sug.status !== "PENDING") return NextResponse.json({ error: "Already reviewed" }, { status: 409 });

    if (parsed.data.decision === "EDITED" && !parsed.data.editedText) {
      return NextResponse.json({ error: "editedText is required when decision is EDITED" }, { status: 422 });
    }

    const finalText = parsed.data.decision === "EDITED" ? parsed.data.editedText! : sug.originalText;

    // If approved or edited, patch the Market's intelligence field for the matching kind.
    if (parsed.data.decision !== "REJECTED") {
      const marketField: Record<string, string> = {
        VISA_CHANGE: "visaTrends",
        SCHOOL_UPDATE: "recruitmentOpportunities",
        COMPETITOR_OBSERVATION: "competitorInstitutions",
        NEW_OPPORTUNITY: "recruitmentOpportunities",
        GOVERNMENT_ANNOUNCEMENT: "overview",
        OTHER: "overview",
      };
      const fieldName = marketField[sug.kind] ?? "overview";
      const market = await db.market.findUnique({ where: { id: sug.marketId }, select: { [fieldName]: true } as never });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const current = (market as any)?.[fieldName];
      const appended = current ? `${current}\n\n[${new Date().toISOString().slice(0, 10)}] ${finalText}` : finalText;
      await db.market.update({ where: { id: sug.marketId }, data: { [fieldName]: appended } as never });
    }

    const updated = await db.marketUpdateSuggestion.update({
      where: { id },
      data: {
        status: parsed.data.decision,
        editedText: parsed.data.editedText,
        reviewedById: userId,
        reviewedAt: new Date(),
        reviewNotes: parsed.data.reviewNotes,
      },
    });
    return NextResponse.json(updated);
  } catch (err) {
    console.error("[POST market-intelligence/suggestions/[id]/review]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
