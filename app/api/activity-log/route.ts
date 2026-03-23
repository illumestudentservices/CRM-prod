import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

// ─── Private IP detection ─────────────────────────────────────────────────────

function isPrivateIP(ip: string): boolean {
  return (
    ip === "::1" ||
    ip === "127.0.0.1" ||
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    ip.startsWith("172.16.") || ip.startsWith("172.17.") || ip.startsWith("172.18.") ||
    ip.startsWith("172.19.") || ip.startsWith("172.20.") || ip.startsWith("172.21.") ||
    ip.startsWith("172.22.") || ip.startsWith("172.23.") || ip.startsWith("172.24.") ||
    ip.startsWith("172.25.") || ip.startsWith("172.26.") || ip.startsWith("172.27.") ||
    ip.startsWith("172.28.") || ip.startsWith("172.29.") || ip.startsWith("172.30.") ||
    ip.startsWith("172.31.") ||
    ip.startsWith("::ffff:127.") ||
    ip.startsWith("::ffff:10.") ||
    ip.startsWith("::ffff:192.168.")
  );
}

interface GeoResult {
  city: string;
  country: string;
  countryCode: string;
  region: string;
}

// ─── Batch geo lookup via ip-api.com (free, server-to-server) ─────────────────

async function lookupGeo(ips: string[]): Promise<Record<string, GeoResult>> {
  if (ips.length === 0) return {};
  try {
    const res = await fetch(
      "http://ip-api.com/batch?fields=status,country,countryCode,regionName,city,query",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ips.map((ip) => ({ query: ip }))),
        // 3s timeout
        signal: AbortSignal.timeout(3000),
      }
    );
    if (!res.ok) return {};
    const results: Array<{
      status: string; query: string;
      city: string; country: string; countryCode: string; regionName: string;
    }> = await res.json();

    const map: Record<string, GeoResult> = {};
    for (const r of results) {
      if (r.status === "success") {
        map[r.query] = {
          city: r.city,
          country: r.country,
          countryCode: r.countryCode,
          region: r.regionName,
        };
      }
    }
    return map;
  } catch {
    return {};
  }
}

// ─── GET /api/activity-log ────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const page   = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const limit  = Math.min(100, Math.max(10, parseInt(searchParams.get("limit") ?? "50")));
  const entity = searchParams.get("entity") || null;
  const action = searchParams.get("action") || null;
  const userId = searchParams.get("userId") || null;
  const search = searchParams.get("search") || null;
  const from   = searchParams.get("from") || null;
  const to     = searchParams.get("to") || null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = {};
  if (entity) where.entity = entity;
  if (action) where.action = action;
  if (userId) where.userId = userId;
  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to   ? { lte: new Date(to + "T23:59:59.999Z") } : {}),
    };
  }
  if (search) {
    where.OR = [
      { user: { name:  { contains: search, mode: "insensitive" } } },
      { user: { email: { contains: search, mode: "insensitive" } } },
      { entity:   { contains: search, mode: "insensitive" } },
      { action:   { contains: search, mode: "insensitive" } },
      { entityId: { contains: search, mode: "insensitive" } },
    ];
  }

  try {
    const [logs, total] = await Promise.all([
      db.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: { select: { id: true, name: true, email: true, role: true } },
        },
      }),
      db.auditLog.count({ where }),
    ]);

    // ── Geo-enrich IPs ──────────────────────────────────────────────────────
    const uniquePublicIPs = [
      ...new Set(
        logs
          .map((l) => l.ipAddress)
          .filter((ip): ip is string => !!ip && !isPrivateIP(ip))
      ),
    ];

    const geoMap = await lookupGeo(uniquePublicIPs);

    const enrichedLogs = logs.map((l) => ({
      ...l,
      geoLocation: l.ipAddress
        ? isPrivateIP(l.ipAddress)
          ? { city: "Local", country: "Private Network", countryCode: "", region: "" }
          : (geoMap[l.ipAddress] ?? null)
        : null,
    }));

    return NextResponse.json({
      logs: enrichedLogs,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("[activity-log GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
