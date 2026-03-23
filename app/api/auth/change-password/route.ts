import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { validatePassword } from "@/lib/password";

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

  const hashed = await bcrypt.hash(newPassword, 12);
  await db.user.update({
    where: { id: session.user.id },
    data: { password: hashed, mustChangePassword: false, loginAttempts: 0, lockedUntil: null },
  });

  return NextResponse.json({ success: true });
}
