import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import type { Role } from "@/lib/permissions";
import { assertNoNulBytes, ApiError } from "@/lib/api-validation";
import { answer } from "@/lib/assistant-search";

/**
 * In-app help: "where is X", "can I use X", "why can't I see X".
 *
 * Deterministic. No model, no API key, no per-query cost — every answer is a
 * lookup against the feature catalogue and PERMISSION_MATRIX, which is the same
 * data the routes enforce. The permission decision was never something a model
 * needed to make, and a lookup cannot describe a screen that does not exist.
 *
 * Read-only, and answers are scoped to the caller's own permissions inside
 * `answer()`, so this cannot become a way to enumerate the application.
 */

const schema = z.object({
  query: z.string().min(1, "Ask a question").max(300),
});

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    try {
      assertNoNulBytes(body);
    } catch (e) {
      if (e instanceof ApiError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid question" },
        { status: 422 }
      );
    }

    const result = await answer(
      parsed.data.query,
      session.user.role as Role,
      session.user.id
    );

    // What people search for and do not find is the signal that tells you which
    // aliases to add — it is the whole maintenance loop for a catalogue-driven
    // help system. Written to the server log rather than audit_logs, which is
    // the security trail for "who changed what": a few hundred help searches a
    // week would bury the records it exists to preserve.
    //
    // Grep with: pm2 logs illume-crm | grep HELP_MISS
    if (result.kind !== "found") {
      console.info(
        "[HELP_MISS]",
        JSON.stringify({
          query: parsed.data.query.slice(0, 120),
          kind: result.kind,
          role: session.user.role,
          at: new Date().toISOString(),
        })
      );
    }

    return NextResponse.json({ data: result });
  } catch (err) {
    console.error("[POST /api/assistant]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
