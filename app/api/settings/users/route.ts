import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sendSecurityAlertEmail, getSuperAdminEmails } from "@/lib/email";
import { z } from "zod";

const patchSchema = z.object({
  id: z.string(),
  role: z
    .enum([
      "SUPER_ADMIN",
      "HQ_EXECUTIVE",
      "HQ_ANALYTICS",
      "REGIONAL_MANAGER",
      "ICR",
      "INSTITUTION_CLIENT",
      "HR_MANAGER",
      "EMPLOYEE",
    ])
    .optional(),
  isActive: z.boolean().optional(),
  regionId: z.string().nullable().optional(),
});

// User fields safe to expose — never include password hash
const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  regionId: true,
  image: true,
  createdAt: true,
  updatedAt: true,
  mustChangePassword: true,
  loginAttempts: true,
  lockedUntil: true,
  deletedAt: true,
  region: { select: { id: true, name: true } },
} as const;

export async function GET() {
  try {
    const session = await auth();
    if (!session || session.user.role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const users = await db.user.findMany({
      where: { deletedAt: null },
      select: USER_SELECT,
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ users });
  } catch (err) {
    console.error("[GET /api/settings/users]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await auth();
    if (!session || session.user.role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 422 });
    }

    const { id, ...data } = parsed.data;

    // Prevent demoting the last SUPER_ADMIN
    if (data.role && data.role !== "SUPER_ADMIN") {
      const [adminCount, target] = await Promise.all([
        db.user.count({ where: { role: "SUPER_ADMIN", deletedAt: null } }),
        db.user.findUnique({ where: { id }, select: { role: true } }),
      ]);
      if (adminCount <= 1 && target?.role === "SUPER_ADMIN") {
        return NextResponse.json({ error: "Cannot remove the last Super Admin" }, { status: 400 });
      }
    }

    // Fetch previous state for audit/alerts, then update
    const [previous, updated] = await Promise.all([
      db.user.findUnique({
        where: { id },
        select: { name: true, email: true, role: true, isActive: true },
      }),
      db.user.update({
        where: { id },
        data,
        select: USER_SELECT,
      }),
    ]);

    // Fire-and-forget security alerts (no await — don't block the response)
    if (previous) {
      const changedBy = session.user.name ?? session.user.email ?? "Admin";
      const actionUrl = `${process.env.NEXTAUTH_URL ?? ""}/settings/users`;

      getSuperAdminEmails()
        .then((adminEmails) => {
          if (!adminEmails.length) return;
          if (data.role && data.role !== previous.role) {
            return sendSecurityAlertEmail({
              to: adminEmails,
              alertType: "ROLE_CHANGED",
              targetName: previous.name ?? updated.email,
              targetEmail: updated.email,
              changedBy,
              details: { "Previous Role": previous.role, "New Role": data.role },
              actionUrl,
            });
          }
          if (data.isActive === false && previous.isActive !== false) {
            return sendSecurityAlertEmail({
              to: adminEmails,
              alertType: "ACCOUNT_DEACTIVATED",
              targetName: previous.name ?? updated.email,
              targetEmail: updated.email,
              changedBy,
              actionUrl,
            });
          }
          if (data.isActive === true && previous.isActive === false) {
            return sendSecurityAlertEmail({
              to: adminEmails,
              alertType: "ACCOUNT_REACTIVATED",
              targetName: previous.name ?? updated.email,
              targetEmail: updated.email,
              changedBy,
              actionUrl,
            });
          }
        })
        .catch((err) => console.error("[settings/users PATCH] Alert email failed:", err));
    }

    return NextResponse.json({ user: updated });
  } catch (err) {
    console.error("[PATCH /api/settings/users]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
