import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { canRequestAccount, canReviewAccountRequest } from "@/lib/account-requests";

/**
 * A minimal {id, name} list of client universities for the onboarding form's
 * "Reports to" picker. Gated to exactly who can see that form (account-request
 * requesters and reviewers), and returns names only — never the commercial or
 * PII columns the full /api/institutions carries.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = session.user.role;
  if (!(canRequestAccount(role) || canReviewAccountRequest(role))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const institutions = await db.institution.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ institutions });
}
