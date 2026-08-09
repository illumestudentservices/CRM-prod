import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";

/// Spec §16 — before creating a Partner / Campaign / Event, search for near-
/// duplicates and warn the user. This single endpoint serves all three by
/// discriminating on `kind`.
const schema = z.object({
  kind: z.enum(["PARTNER", "EVENT", "CAMPAIGN"]),
  name: z.string().min(1),
  country: z.string().optional(),
  city: z.string().optional(),
  date: z.string().datetime().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { role } = session.user;
    if (!(await effectiveHasPermission(role as Role, "recruitment_network", "read"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 422 });
    }
    const { kind, name, country, city, date } = parsed.data;

    if (kind === "PARTNER") {
      const matches = await db.source.findMany({
        where: {
          deletedAt: null,
          name: { contains: name, mode: "insensitive" },
          ...(country && { country: { equals: country, mode: "insensitive" } }),
        },
        select: { id: true, name: true, type: true, country: true, city: true },
        take: 10,
      });
      return NextResponse.json({ matches });
    }

    if (kind === "EVENT") {
      // Match if name is similar AND date is within +/- 14 days (or country/city match strongly)
      const windowDays = 14;
      const eventDate = date ? new Date(date) : null;
      const from = eventDate ? new Date(eventDate.getTime() - windowDays * 86400000) : undefined;
      const to = eventDate ? new Date(eventDate.getTime() + windowDays * 86400000) : undefined;

      const matches = await db.event.findMany({
        where: {
          deletedAt: null,
          name: { contains: name, mode: "insensitive" },
          ...(country && { country: { equals: country, mode: "insensitive" } }),
          ...(city && { city: { equals: city, mode: "insensitive" } }),
          ...(from && to && { date: { gte: from, lte: to } }),
        },
        select: { id: true, name: true, date: true, country: true, city: true, status: true },
        take: 10,
      });
      return NextResponse.json({ matches });
    }

    // CAMPAIGN
    const matches = await db.campaign.findMany({
      where: {
        deletedAt: null,
        name: { contains: name, mode: "insensitive" },
      },
      select: { id: true, name: true, channel: true, startDate: true, endDate: true },
      take: 10,
    });
    return NextResponse.json({ matches });
  } catch (err) {
    console.error("[POST /api/recruitment-network/find-duplicates]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
