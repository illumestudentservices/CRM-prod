import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { handleApiError } from "@/lib/api-validation";
import { loadDirectory } from "@/lib/directory";

/**
 * GET /api/directory — who works here.
 *
 * ★ OPEN TO STAFF, CLOSED TO CLIENTS.
 *
 * Every internal role may read it: a directory nobody can open is the problem
 * this is here to fix. INSTITUTION_CLIENT is the one exclusion, and it is not a
 * detail — those are partner-university accounts, people outside the company
 * with a login. Handing them the full staff list, titles, reporting lines and
 * work addresses would publish Illume's internal structure to its customers.
 *
 * Checked here rather than left to the nav gate. proxy.ts hides the sidebar
 * entry and blocks the page, but an API is reachable without either.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (session.user.role === "INSTITUTION_CLIENT") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const people = await loadDirectory();

    // So the screen can mark "this is you" without a second request, and
    // without the client guessing from a name.
    const me = await db.employee.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    });

    return NextResponse.json({ people, myEmployeeId: me?.id ?? null });
  } catch (error) {
    return handleApiError(error, "[GET /api/directory]");
  }
}
