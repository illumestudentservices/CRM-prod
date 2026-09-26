import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity-logger";
import { notifyAdmins } from "@/lib/admin-alerts";

/**
 * Full staff export, for a super administrator.
 *
 * ★ SERVER-SIDE, NOT THE CLIENT EXPORT BUTTON.
 *
 * The existing button serialises whatever the page already loaded. That is
 * fine for eight columns of a list someone is looking at, but it makes a
 * "bulk export" quietly a function of the UI: filter the table, and the export
 * silently narrows with it. This reads the database directly, so "everyone"
 * means everyone.
 *
 * It also carries far more than the list does — address, emergency contact,
 * phone, manager, leave usage — which is the point of an export and also why
 * it is SUPER_ADMIN only and raises an admin alert. HR_MANAGER can still use
 * the list export; this one hands over the entire staff directory including
 * home addresses, and that should be a deliberate, visible act.
 */

/** Every field, in a sensible reading order. */
const COLUMNS: Array<[header: string, key: string]> = [
  ["Employee ID", "employeeId"],
  ["First Name", "firstName"],
  ["Last Name", "lastName"],
  ["Work Email", "email"],
  ["Job Title", "jobTitle"],
  ["Department", "department"],
  ["Employment Type", "employmentType"],
  ["Role", "role"],
  ["Manager", "manager"],
  ["Manager Email", "managerEmail"],
  ["Region", "region"],
  ["Status", "status"],
  ["Start Date", "startDate"],
  ["End Date", "endDate"],
  ["Gender", "gender"],
  ["Phone", "phone"],
  ["Address", "address"],
  ["Emergency Contact", "emergencyContact"],
  ["Emergency Phone", "emergencyPhone"],
  ["Cost Centre", "costCentre"],
  ["Timesheet Required", "timesheetRequired"],
  ["Timesheet Frequency", "timesheetFrequency"],
  ["Standard Weekly Hours", "standardWorkingHours"],
  ["Annual Leave Used", "annualUsed"],
  ["Sick Leave Used", "sickUsed"],
  ["Created", "createdAt"],
];

/**
 * Excel and Sheets execute a cell beginning with one of these even when the
 * field is quoted — quoting protects the delimiter, not the formula parser.
 * The common case is not an attack: `+44 20…` in a phone column starts with
 * `+`, and Excel turns it into a broken formula. Mirrors csvCell() in
 * components/shared/export-button.tsx; both must stay in step.
 */
const FORMULA_TRIGGERS = /^[=+\-@\t\r]/;

function cell(val: unknown): string {
  if (val === null || val === undefined) return '""';
  let s = String(val);
  if (FORMULA_TRIGGERS.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** ISO date only. A locale string would differ per server and per reader. */
const day = (d: Date | null | undefined) =>
  d ? d.toISOString().slice(0, 10) : "";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // A role literal, not a matrix permission. This is the whole staff directory
  // with home addresses and next of kin; it is not something to make grantable
  // from a settings screen by accident.
  if (session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json(
      { error: "Only a super administrator can export the full staff list" },
      { status: 403 }
    );
  }

  const includeInactive = req.nextUrl.searchParams.get("inactive") === "true";

  const employees = await db.employee.findMany({
    where: includeInactive ? {} : { isActive: true },
    select: {
      employeeId: true, jobTitle: true, employmentType: true,
      startDate: true, endDate: true, gender: true, phone: true,
      address: true, emergencyContact: true, emergencyPhone: true,
      costCentre: true, timesheetRequired: true, timesheetFrequency: true,
      standardWorkingHours: true, isActive: true, createdAt: true,
      user: {
        select: {
          email: true, firstName: true, lastName: true, name: true,
          role: true, region: { select: { name: true } },
        },
      },
      department: { select: { name: true } },
      manager: { select: { user: { select: { name: true, email: true } } } },
      // Leave is reported as DAYS USED, never as a balance. Entitlement here
      // is computed from the start date (lib/leave-policy.ts) and is not a
      // stored number — exporting a "balance" column would invent one.
      leaveBalances: {
        where: { year: new Date().getUTCFullYear() },
        select: { leaveType: true, usedDays: true },
      },
    },
    orderBy: { employeeId: "asc" },
  });

  const rows = employees.map((e) => {
    const used = (t: string) =>
      e.leaveBalances.find((b) => b.leaveType === t)?.usedDays ?? 0;
    // firstName/lastName are nullable on User; fall back to the display name
    // rather than exporting two blanks beside a populated one.
    const first = e.user.firstName ?? (e.user.name ?? "").split(" ")[0] ?? "";
    const last =
      e.user.lastName ?? (e.user.name ?? "").split(" ").slice(1).join(" ");
    return {
      employeeId: e.employeeId,
      firstName: first,
      lastName: last,
      email: e.user.email,
      jobTitle: e.jobTitle,
      department: e.department?.name ?? "",
      employmentType: e.employmentType.replace(/_/g, " "),
      role: e.user.role,
      manager: e.manager?.user.name ?? "",
      managerEmail: e.manager?.user.email ?? "",
      region: e.user.region?.name ?? "",
      status: e.isActive ? "Active" : "Inactive",
      startDate: day(e.startDate),
      endDate: day(e.endDate),
      gender: e.gender ?? "",
      phone: e.phone ?? "",
      address: e.address ?? "",
      emergencyContact: e.emergencyContact ?? "",
      emergencyPhone: e.emergencyPhone ?? "",
      costCentre: e.costCentre ?? "",
      timesheetRequired: e.timesheetRequired ? "Yes" : "No",
      timesheetFrequency: e.timesheetFrequency ?? "",
      standardWorkingHours: e.standardWorkingHours ?? "",
      annualUsed: used("VACATION_PAID"),
      sickUsed: used("SICK"),
      createdAt: day(e.createdAt),
    } as Record<string, unknown>;
  });

  const csv = [
    COLUMNS.map(([h]) => cell(h)).join(","),
    ...rows.map((r) => COLUMNS.map(([, k]) => cell(r[k])).join(",")),
  ].join("\r\n");

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `illume-staff-${stamp}.csv`;

  void logActivity(
    session.user.id, "EXPORT", "Employee", "ALL",
    { rows: rows.length, includeInactive }, req
  );

  // The entire staff directory, including home addresses and next of kin,
  // leaving the system in one file. That belongs on the serious-actions list.
  void notifyAdmins({
    action: "STAFF_DIRECTORY_EXPORTED",
    actorName: session.user.name ?? session.user.email ?? "A super administrator",
    actorEmail: session.user.email ?? "unknown",
    summary: `the full staff list was exported — ${rows.length} employee${rows.length === 1 ? "" : "s"}, including home addresses and emergency contacts.`,
    detail: [
      ["Rows exported", String(rows.length)],
      ["Inactive included", includeInactive ? "Yes" : "No"],
      ["File", filename],
    ],
    link: "/hr",
  });

  return new NextResponse(`\uFEFF${csv}`, {
    headers: {
      // The BOM above is what makes Excel read this as UTF-8. Without it,
      // names from the markets this business recruits in arrive as mojibake.
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // A staff directory must never sit in a shared or browser cache.
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
