import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { validatePassword } from "@/lib/password";
import { isPasswordReused, recordPasswordInHistory, PASSWORD_REUSED_MESSAGE } from "@/lib/password-history";
import { logActivity } from "@/lib/activity-logger";

const schema = z.object({
  currentPassword: z.string().optional(),
  newPassword: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  const { currentPassword, newPassword } = parsed.data;

  // Validate complexity
  const complexity = validatePassword(newPassword);
  if (!complexity.valid) {
    return NextResponse.json({ error: "Password does not meet requirements", details: complexity.errors }, { status: 422 });
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { password: true, mustChangePassword: true },
  });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  // Require current password unless it's a forced change
  if (!user.mustChangePassword) {
    if (!currentPassword) {
      return NextResponse.json({ error: "Current password is required" }, { status: 400 });
    }
    if (!user.password) {
      return NextResponse.json({ error: "No password set on this account" }, { status: 400 });
    }
    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) {
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
    }
  }

  // Reuse check runs after complexity so an obviously invalid password is
  // rejected without paying for five bcrypt comparisons.
  if (await isPasswordReused(session.user.id, newPassword)) {
    return NextResponse.json({ error: PASSWORD_REUSED_MESSAGE }, { status: 422 });
  }

  const hashed = await bcrypt.hash(newPassword, 12);
  const changedAt = new Date();

  // Atomic: a password that failed to reach its own history would be
  // immediately reusable, defeating the policy on the very next change.
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: session.user.id },
      data: {
        password: hashed,
        mustChangePassword: false,
        passwordChangedAt: changedAt,
        loginAttempts: 0,
        lockedUntil: null,
      },
    });
    await recordPasswordInHistory(session.user.id, hashed, tx);
  });

  void logActivity(session.user.id, "PASSWORD_CHANGED", "USER", session.user.id, {
    forced: user.mustChangePassword,
  });

  return NextResponse.json({ success: true, passwordChangedAt: changedAt.toISOString() });
}
