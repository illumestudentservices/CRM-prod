import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { displayName } from "@/lib/person-name";

/// Spec §2 — before creating a new Student Profile, search for matches.
///
/// Match strategy (spec-compliant):
///   * Exact email → strongest signal
///   * Exact phone → strong signal
///   * (firstName + lastName) case-insensitive → weak
///   * Combined weak matches (name + partial phone) → moderate
///
/// Each match carries a confidence label so the UI can present clearly:
///   HIGH   - single strong match (email or phone exact)
///   MEDIUM - name + country match
///   LOW    - name-only match
const schema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  countryOfResidence: z.string().optional(),
});

interface MatchResult {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  countryOfResidence: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  matchedOn: string[];
  interestCount: number;
  currentOwner: { id: string; name: string | null } | null;
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { role } = session.user;
    if (!(await effectiveHasPermission(role as Role, "leads", "read"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 422 });
    }
    const { firstName, lastName, email, phone, countryOfResidence } = parsed.data;

    if (!email && !phone && !firstName) {
      return NextResponse.json({ matches: [] });
    }

    // Build an OR of candidate signals — never match on an empty string.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orConditions: any[] = [];
    if (email && email.length > 3) orConditions.push({ email: { equals: email, mode: "insensitive" } });
    if (phone && phone.length > 5) orConditions.push({ phone: { equals: phone } });
    if (firstName && lastName) {
      orConditions.push({
        AND: [
          { firstName: { equals: firstName, mode: "insensitive" } },
          { lastName: { equals: lastName, mode: "insensitive" } },
        ],
      });
    }
    if (orConditions.length === 0) return NextResponse.json({ matches: [] });

    const candidates = await db.lead.findMany({
      where: { deletedAt: null, OR: orConditions },
      select: {
        id: true, firstName: true, lastName: true, email: true, phone: true,
        countryOfResidence: true,
        assignedICR: { select: { id: true, name: true } },
        _count: { select: { institutionInterests: true } },
      },
      take: 25,
    });

    const results: MatchResult[] = candidates.map((c) => {
      const matched: string[] = [];
      let confidence: "HIGH" | "MEDIUM" | "LOW" = "LOW";
      if (email && c.email?.toLowerCase() === email.toLowerCase()) { matched.push("email"); confidence = "HIGH"; }
      if (phone && c.phone === phone) { matched.push("phone"); confidence = "HIGH"; }
      if (firstName && lastName && c.firstName.toLowerCase() === firstName.toLowerCase() && c.lastName.toLowerCase() === lastName.toLowerCase()) {
        matched.push("name");
        if (confidence !== "HIGH") {
          confidence = countryOfResidence && c.countryOfResidence.toLowerCase() === countryOfResidence.toLowerCase()
            ? "MEDIUM" : "LOW";
          if (countryOfResidence && c.countryOfResidence.toLowerCase() === countryOfResidence.toLowerCase()) matched.push("country");
        }
      }
      return {
        id: c.id,
        displayName: displayName({ firstName: c.firstName, lastName: c.lastName }),
        email: c.email,
        phone: c.phone,
        countryOfResidence: c.countryOfResidence,
        confidence,
        matchedOn: matched,
        interestCount: c._count.institutionInterests,
        currentOwner: c.assignedICR,
      };
    });

    // Rank HIGH before MEDIUM before LOW
    const order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    results.sort((a, b) => order[a.confidence] - order[b.confidence]);

    return NextResponse.json({ matches: results });
  } catch (err) {
    console.error("[POST /api/leads/find-matches]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
