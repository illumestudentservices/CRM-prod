import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { validatePassword } from "@/lib/password";

const schema = z.object({
  token: z.string().min(1),
  password: z.string().min(1),
});

// GET — validate token (check if valid/expired without consuming it)
export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return NextResponse.json({ error: "Token required" }, { status: 400 });

  try {
    const record = await db.passwordResetToken.findUnique({
      where: { token },
      select: { usedAt: true, expiresAt: true },
    });

    if (!record) return NextResponse.json({ valid: false, reason: "not_found" });
    if (record.usedAt) return NextResponse.json({ valid: false, reason: "used" });
    if (record.expiresAt < new Date()) return NextResponse.json({ valid: false, reason: "expired" });

    return NextResponse.json({ valid: true });
  } catch (err) {
    console.error("[verify-reset-token GET]", err);
    return NextResponse.json({ valid: false, reason: "error" });
  }
}

// POST — set new password using the magic link token
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed" }, { status: 422 });
  }

  const { token, password } = parsed.data;

  // Validate password complexity
  const complexity = validatePassword(password);
  if (!complexity.valid) {
    return NextResponse.json({ error: "Password does not meet requirements", details: complexity.errors }, { status: 422 });
  }

  try {
    const record = await db.passwordResetToken.findUnique({
      where: { token },
      include: { user: { select: { id: true } } },
    });

    if (!record) return NextResponse.json({ error: "Invalid or expired link" }, { status: 400 });
    if (record.usedAt) return NextResponse.json({ error: "This link has already been used" }, { status: 400 });
    if (record.expiresAt < new Date()) return NextResponse.json({ error: "This link has expired" }, { status: 400 });

    const hashed = await bcrypt.hash(password, 12);

    await db.$transaction([
      db.user.update({
        where: { id: record.userId },
        data: {
          password: hashed,
          mustChangePassword: false,
          loginAttempts: 0,
          lockedUntil: null,
        },
      }),
      db.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
    ]);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[verify-reset-token POST]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
