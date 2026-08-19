import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { notFound, redirect } from "next/navigation";
import { deriveLeaveBalances } from "@/lib/leave-policy";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { getInitials } from "@/lib/utils";
import { ArrowLeft, Mail, Phone, Building2, Calendar } from "lucide-react";
import Link from "next/link";
import { EditEmployeeTrigger } from "./_components/edit-employee-trigger";
import { EmployeeTabsClient } from "./_components/employee-tabs-client";
import { ACTIVE_EMPLOYEE } from "@/lib/hr-scope";

export default async function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session) redirect("/login");

  const employee = await db.employee.findUnique({
    where: { id },
    include: {
      user: { include: { region: true } },
      department: true,
      manager: { include: { user: true } },
      directReports: { include: { user: true } },
      leaveBalances: { where: { year: new Date().getFullYear() } },
      trainingRecords: { orderBy: { createdAt: "desc" }, take: 10 },
      documents: { orderBy: { uploadedAt: "desc" } },
      assetAssignments: {
        where: { returnedAt: null },
        include: { asset: true },
      },
      worklogs: { orderBy: { date: "desc" }, take: 14 },
      performanceReviews: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!employee) notFound();

  const { role, id: currentUserId } = session.user;
  const [departments, managers, regions] = await Promise.all([
    db.department.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.employee.findMany({
      select: { id: true, user: { select: { name: true } } },
      where: ACTIVE_EMPLOYEE,
      orderBy: { user: { name: "asc" } },
    }),
    db.region.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const isHR = role === "HR_MANAGER" || role === "SUPER_ADMIN";
  const isSuperAdmin = role === "SUPER_ADMIN";
  const isOwnProfile = employee.userId === currentUserId;
  if (!isHR && !isOwnProfile) redirect("/hr");

  const EMPLOYMENT_LABELS: Record<string, string> = {
    FULL_TIME: "Full-time", PART_TIME: "Part-time", CONTRACT: "Contract", INTERN: "Intern",
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/hr"><ArrowLeft className="h-4 w-4 mr-1" /> Back to HR</Link>
        </Button>
      </div>

      <div className="flex items-start gap-6 p-6 bg-white dark:bg-slate-900 rounded-xl border shadow-sm">
        <Avatar className="h-20 w-20">
          <AvatarImage src={employee.photoUrl ?? undefined} />
          <AvatarFallback className="text-2xl bg-[#1E3A5F] text-white">
            {getInitials(employee.user.name)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">{employee.user.name}</h1>
              <p className="text-muted-foreground">{employee.jobTitle}</p>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="secondary" className="font-mono">{employee.employeeId}</Badge>
                <Badge variant={employee.isActive ? "success" : "secondary"}>
                  {employee.isActive ? "Active" : "Inactive"}
                </Badge>
                <Badge variant="outline">{EMPLOYMENT_LABELS[employee.employmentType] ?? employee.employmentType}</Badge>
              </div>
            </div>
            {(isHR || isOwnProfile) && (
              <EditEmployeeTrigger
                employeeId={employee.id}
                initial={{
                  jobTitle: employee.jobTitle,
                  employmentType: employee.employmentType,
                  startDate: employee.startDate.toISOString(),
                  phone: employee.phone,
                  emergencyContact: employee.emergencyContact,
                  emergencyPhone: employee.emergencyPhone,
                  address: employee.address,
                  isActive: employee.isActive,
                  departmentId: employee.departmentId,
                  managerId: employee.managerId,
                  // Gender was missing here, and its absence did not merely hide
                  // the value — it deleted it. The form falls back to the "none"
                  // sentinel when `initial.gender` is undefined, and on save it
                  // sends `gender: null` for "none". So opening this dialog and
                  // changing anything at all silently wiped a gender that had
                  // been set correctly at onboarding, and the field read as blank
                  // every time it was reopened. Exactly the failure the timesheet
                  // note below describes, on the field that decides maternity and
                  // paternity eligibility.
                  gender: employee.gender,
                  firstName: employee.user.firstName,
                  lastName: employee.user.lastName,
                  email: employee.user.email,
                  role: employee.user.role,
                  regionId: employee.user.regionId ?? null,
                  // Timesheet configuration (migration 028). Passed through so
                  // the form opens showing the current settings — without these
                  // the toggle would read as "off" for someone already enabled,
                  // and saving would quietly switch them off.
                  timesheetRequired: employee.timesheetRequired,
                  timesheetFrequency: employee.timesheetFrequency,
                  standardWorkingHours: employee.standardWorkingHours,
                  timesheetApproverId: employee.timesheetApproverId,
                  costCentre: employee.costCentre,
                }}
                departments={departments}
                managers={managers}
                regions={regions}
                isHR={isHR}
                isSuperAdmin={isSuperAdmin}
              />
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Mail className="h-4 w-4" />
              <span>{employee.user.email}</span>
            </div>
            {employee.phone && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Phone className="h-4 w-4" />
                <span>{employee.phone}</span>
              </div>
            )}
            {employee.department && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Building2 className="h-4 w-4" />
                <span>{employee.department.name}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span>Since {formatDate(employee.startDate)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <EmployeeTabsClient
        employeeId={employee.id}
        profile={{
          name: employee.user.name,
          email: employee.user.email,
          phone: employee.phone,
          regionName: employee.user.region?.name ?? null,
          address: employee.address,
          emergencyContact: employee.emergencyContact,
          emergencyPhone: employee.emergencyPhone,
          managerName: employee.manager?.user.name ?? null,
          directReports: employee.directReports,
        }}
        leaveBalances={deriveLeaveBalances(employee.startDate, employee.leaveBalances, employee.gender)}
        isOwnProfile={isOwnProfile}
        worklogs={employee.worklogs}
        isHR={isHR}
        trainingRecords={employee.trainingRecords}
        assetAssignments={employee.assetAssignments}
        documents={employee.documents}
        performanceReviews={employee.performanceReviews}
      />
    </div>
  );
}
