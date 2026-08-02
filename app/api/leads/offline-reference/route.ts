import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";

/**
 * The dropdown data the capture form needs, for downloading before an event.
 *
 * Without this the offline form has empty Source, Institution and Event lists —
 * and Lead source is one of the fields the NEW_LEAD gate requires, so every
 * lead captured at the booth would be stranded at the first stage. Downloading
 * it in advance is what makes "capture everything offline" actually true rather
 * than nominally true.
 *
 * Kept deliberately small: ids and display names only. This lands on a personal
 * phone and stays there for the length of an event, so there is no reason for it
 * to carry contact details, contract values or anything else about a client.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { role, id: userId, regionId } = session.user;

    // Same permission as capturing: if you cannot create a lead, there is no
    // reason to hold the lists needed to create one.
    if (!(await effectiveHasPermission(role as Role, "leads", "write"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // An ICR sees their own region's events; anyone broader sees all. Matches
    // how the leads list already scopes, so the phone cannot become a way to
    // read past your own region.
    const eventScope =
      role === "ICR"
        ? { OR: [{ assignedICRId: userId }, ...(regionId ? [{ regionId }] : [])] }
        : role === "REGIONAL_MANAGER" && regionId
          ? { regionId }
          : {};

    // Events from the recent past and near future. A fair being staffed today
    // is the point; one from two years ago is noise on a phone screen.
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - 30);
    const windowEnd = new Date();
    windowEnd.setDate(windowEnd.getDate() + 120);

    const [sources, institutions, icrUsers, events, regions] = await Promise.all([
      db.source.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      db.institution.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      db.user.findMany({
        where: { deletedAt: null, isActive: true, role: "ICR" },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      db.event.findMany({
        where: {
          deletedAt: null,
          date: { gte: windowStart, lte: windowEnd },
          ...eventScope,
        },
        select: { id: true, name: true, date: true, city: true, country: true },
        orderBy: { date: "desc" },
      }),
      db.region.findMany({
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    ]);

    return NextResponse.json({
      // Read by the device to show "lists last refreshed on ...", so an ICR can
      // tell at a glance whether they are carrying stale data to an event.
      generatedAt: new Date().toISOString(),
      sources,
      institutions,
      icrUsers,
      events,
      regions,
    });
  } catch (error) {
    console.error("[GET /api/leads/offline-reference]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
