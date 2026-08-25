import { recordPasswordInHistory } from "@/lib/password-history";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import type { Prisma } from "@prisma/client";
import { sendWelcomeEmail, sendSecurityAlertEmail, getSuperAdminEmails } from "@/lib/email";
import { createMagicLink } from "@/lib/magic-link";
import { generateTempPassword } from "@/lib/password";
import { displayName, userNameFields } from "@/lib/person-name";
import { emailIsTaken, normaliseEmail } from "@/lib/email-identity";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createEmployeeSchema = z
  .object({
    email: z.string().email("Invalid email"),
    firstName: z.string().min(1, "First name is required"),
    lastName: z.string().min(1, "Last name is required"),
    // Password is NOT collected here on purpose: the handler generates a
    // secure temp password and emails a magic link so the employee sets
    // their own via /reset-password (which enforces 12-char + 4-class
    // complexity). Accepting one here just risked HR typing something
    // weaker than the reset flow requires, and the value was thrown away
    // anyway.
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
      .default("EMPLOYEE"),
    regionId: z.string().min(1).optional().nullable(),
    jobTitle: z.string().min(1, "Job title is required"),
    departmentId: z.string().min(1).optional().nullable(),
    employmentType: z
      .enum(["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN"])
      .default("FULL_TIME"),
    managerId: z.string().min(1).optional().nullable(),
    startDate: z.string().transform((v) => new Date(v)),
    phone: z.string().optional().nullable(),
    emergencyContact: z.string().optional().nullable(),
    emergencyPhone: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
    photoUrl: z.string().url().optional().nullable(),
    // Drives maternity/paternity eligibility. Optional so an incomplete
    // onboarding is still possible; a null blocks the parental types.
    gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.role !== "SUPER_ADMIN" && !data.managerId) {
      ctx.addIssue({
        path: ["managerId"],
        code: z.ZodIssueCode.custom,
        message: "Manager is required for all roles except Super Admin",
      });
    }
  });

const HR_ROLES: Role[] = ["HR_MANAGER", "SUPER_ADMIN"];

// ─── GET /api/hr/employees ────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Only HR managers and super admins can list all employees
    if (!HR_ROLES.includes(session.user.role as Role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const departmentId = searchParams.get("departmentId");
    const isActiveParam = searchParams.get("isActive");
    const search = searchParams.get("search");
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
    const limit = Math.min(100, parseInt(searchParams.get("limit") ?? "50"));

    const where: Prisma.EmployeeWhereInput = {
      // Default to active employees unless caller requests otherwise
      isActive: isActiveParam !== null ? isActiveParam === "true" : true,
      // Never list someone whose account has been deleted, whatever isActive
      // says on the employee row — the two flags were never kept in step.
      user: { deletedAt: null },
    };
    if (departmentId) where.departmentId = departmentId;
    if (search) {
      where.user = { deletedAt: null, name: { contains: search, mode: "insensitive" } };
    }

    const [employees, total] = await Promise.all([
      db.employee.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
              role: true,
              isActive: true,
            },
          },
          department: { select: { id: true, name: true } },
          manager: {
            include: { user: { select: { id: true, name: true } } },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.employee.count({ where }),
    ]);

    return NextResponse.json({ employees, total, page, limit });
  } catch (err) {
    console.error("[GET /api/hr/employees]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── POST /api/hr/employees ───────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!HR_ROLES.includes(session.user.role as Role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = createEmployeeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 422 }
      );
    }

    const data = parsed.data;

    // Case-insensitive. A case-sensitive check let "mike@" be created alongside
    // an existing "Mike@" — two accounts for one person, and precisely the
    // ambiguity that makes a case-insensitive sign-in lookup unsafe. Migration
    // 036 adds a unique index on lower(email) so the database refuses it too.
    if (await emailIsTaken(data.email)) {
      return NextResponse.json({ error: "Email already in use" }, { status: 409 });
    }

    // Generate a secure temp password — the user will set their own via magic link
    const hashedPassword = await bcrypt.hash(generateTempPassword(), 12);

    const employee = await db.$transaction(async (tx) => {
      // Determine next employee number inside the transaction to prevent race conditions
      const lastEmp = await tx.employee.findFirst({
        orderBy: { createdAt: "desc" },
        select: { employeeId: true },
      });
      const lastNum = lastEmp
        ? parseInt(lastEmp.employeeId.replace(/^[A-Z]+-/, ""), 10) || 0
        : 0;
      const employeeId = `ILL-${String(lastNum + 1).padStart(4, "0")}`;

      const user = await tx.user.create({
        data: {
          // Stored lowercase so what is in the column matches what people type.
          // The welcome email still goes to the address exactly as HR entered it.
          email: normaliseEmail(data.email),
          ...userNameFields(data),
          password: hashedPassword,
          role: data.role as Role,
          regionId: data.regionId ?? null,
          isActive: true,
          mustChangePassword: true,
          // Left null deliberately. The temp password is not the user's own, so
          // the 90-day clock starts when they choose one — otherwise slow
          // onboarding silently eats into their first cycle.
          passwordChangedAt: null,
        },
      });

      // Remember the temp password so it cannot be kept as the real one.
      await recordPasswordInHistory(user.id, hashedPassword, tx);

      const emp = await tx.employee.create({
        data: {
          employeeId,
          userId: user.id,
          jobTitle: data.jobTitle,
          departmentId: data.departmentId ?? null,
          employmentType: data.employmentType,
          managerId: data.managerId ?? null,
          startDate: data.startDate,
          phone: data.phone ?? null,
          emergencyContact: data.emergencyContact ?? null,
          emergencyPhone: data.emergencyPhone ?? null,
          address: data.address ?? null,
          photoUrl: data.photoUrl ?? null,
          gender: data.gender ?? null,
          isActive: true,
        },
        include: {
          user: { select: { id: true, name: true, email: true, role: true } },
          department: { select: { id: true, name: true } },
        },
      });

      // No leave balances are seeded. Entitlement is derived from startDate and
      // the policy in lib/leave-policy.ts, so seeding a flat allocation here
      // would both ignore the joining date and leave a row that expires at year
      // end. Consumption rows are created on first use.

      return emp;
    });

    // Fire-and-forget: generate magic link + send welcome email
    createMagicLink(employee.user.id, 72)
      .then((magicLinkUrl) =>
        sendWelcomeEmail({
          to: data.email,
          name: displayName(data),
          employeeId: employee.employeeId,
          jobTitle: data.jobTitle,
          magicLinkUrl,
        })
      )
      .catch((err) => console.error("[POST /api/hr/employees] Welcome email failed:", err));

    // Security alert to super admins
    getSuperAdminEmails()
      .then((adminEmails) => {
        if (!adminEmails.length) return;
        return sendSecurityAlertEmail({
          to: adminEmails,
          alertType: "USER_CREATED",
          targetName: displayName(data),
          targetEmail: data.email,
          changedBy: session.user.name ?? session.user.email ?? "HR Manager",
          details: {
            "Employee ID": employee.employeeId,
            "Job Title": data.jobTitle,
            Role: data.role,
          },
          actionUrl: `${process.env.NEXTAUTH_URL ?? ""}/hr`,
        });
      })
      .catch((err) => console.error("[POST /api/hr/employees] Alert email failed:", err));

    return NextResponse.json({ employee }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/hr/employees]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
