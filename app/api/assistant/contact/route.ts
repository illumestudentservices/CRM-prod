import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import type { Role } from "@/lib/permissions";
import { assertNoNulBytes, ApiError } from "@/lib/api-validation";
import { sendSupportRequest } from "@/lib/assistant-escalation";

/**
 * "Send a message to IT support" — the deliberate escalation from the help
 * widget.
 *
 * Searching (/api/assistant) deliberately emails NOBODY now; it used to email
 * the owner on every unanswered keystroke and buried the inbox. This fires only
 * when the user clicks Send, carries whatever extra detail they typed, and tells
 * them whether it went — so a quiet failure cannot masquerade as a sent message.
 */

const schema = z.object({
  query: z.string().min(1, "Enter what you were looking for").max(300),
  detail: z.string().max(2000).optional().nullable(),
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
        { error: parsed.error.issues[0]?.message ?? "Invalid request" },
        { status: 422 }
      );
    }

    const result = await sendSupportRequest({
      query: parsed.data.query,
      detail: parsed.data.detail,
      role: session.user.role as Role,
      userEmail: session.user.email,
      userName: session.user.name,
    });

    if (!result.sent) {
      // 503 when it is a configuration/transport problem, 429 when the abuse
      // cap tripped — either way the widget must NOT tell the user it was sent.
      const status = result.reason === "capped" ? 429 : 503;
      return NextResponse.json({ error: "Could not send your message. Please try again.", reason: result.reason }, { status });
    }

    return NextResponse.json({ data: { sent: true } });
  } catch (err) {
    console.error("[POST /api/assistant/contact]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
