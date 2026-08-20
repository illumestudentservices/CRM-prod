"use client";

import * as React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatCard } from "@/components/shared/stat-card";
import { cn } from "@/lib/utils";
import { EmployeeTable } from "./employee-table";
import { LeaveManager } from "./leave-manager";
import { AttendanceTracker } from "./attendance-tracker";
import { TaskBoard } from "./task-board";
import { Announcements } from "./announcements";
import { KnowledgeBaseView } from "./knowledge-base";
import { HolidayManager } from "./holiday-manager";
import { AssetManager } from "./asset-manager";
import { LeaveBalances } from "./leave-balances";
import { PerformanceReviews } from "./performance-reviews";
import { SuccessionPlanning } from "./succession-planning";
import { AccountRequests } from "./account-requests";
import { OffboardingRequests } from "./offboarding-requests";
import { TimesheetsPanel } from "./timesheets-panel";

interface HRTabsClientProps {
  /** The viewer's own employee record, if they have one. Null for accounts with none. */
  myEmployeeId: string | null;
  myLeaveBalances: { leaveType: string; totalDays: number; availableDays: number }[];
  isHR: boolean;
  isSuperAdmin: boolean;
  /** Regional and HR managers raise requests; Super Admins review them. */
  canSeeAccountRequests: boolean;
  /**
   * Same roles as account requests, but a separate prop rather than reusing that
   * flag — the two gates are independent by design, so widening one later must
   * not silently widen the other.
   */
  canSeeOffboarding: boolean;
  userId: string;
  totalEmployees: number;
  onLeaveToday: number;
  openTasks: number;
  pendingLeave: number;
}

export function HRTabsClient({
  myEmployeeId,
  myLeaveBalances,
  isHR,
  isSuperAdmin,
  canSeeAccountRequests,
  canSeeOffboarding,
  userId,
  totalEmployees,
  onLeaveToday,
  openTasks,
  pendingLeave,
}: HRTabsClientProps) {
  // "employees" only renders for HR now, so defaulting everyone to it would
  // open this page on a tab that does not exist for them — an empty panel under
  // a trigger that isn't there. Non-HR staff come here for their own leave, so
  // that is where they land.
  const [activeTab, setActiveTab] = React.useState(isHR ? "employees" : "leave");

  // Notification emails link to /hr?tab=account-requests and /hr?tab=offboarding,
  // so honour that rather than dropping the reviewer on the Employees tab and
  // making them hunt.
  React.useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (tab) setActiveTab(tab);
  }, []);

  const statCards = [
    { title: "Total Employees", value: totalEmployees, icon: "Users" as const,       iconColor: "text-[#1E3A5F] dark:text-sky-300",  iconBg: "bg-[#1E3A5F]/10 dark:bg-sky-500/15", tab: "employees" },
    { title: "On Leave Today",  value: onLeaveToday,   icon: "CalendarOff" as const, iconColor: "text-amber-600 dark:text-amber-300",  iconBg: "bg-amber-50 dark:bg-amber-500/15",     tab: "leave" },
    { title: "Open Tasks",      value: openTasks,      icon: "CheckSquare" as const, iconColor: "text-blue-600 dark:text-blue-300",   iconBg: "bg-blue-50 dark:bg-blue-500/15",      tab: "tasks" },
    { title: "Pending Leave",   value: pendingLeave,   icon: "Clock" as const,       iconColor: "text-violet-600 dark:text-violet-300", iconBg: "bg-violet-50 dark:bg-violet-500/15",    tab: "leave" },
  ];

  return (
    <div className="space-y-4">
      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {statCards.map((card, i) => (
          <StatCard
            key={`${card.title}-${i}`}
            title={card.title}
            value={card.value}
            icon={card.icon}
            iconColor={card.iconColor}
            iconBg={card.iconBg}
            className={cn(
              "cursor-pointer transition-all",
              activeTab === card.tab && "ring-2 ring-[#1E3A5F] ring-offset-1"
            )}
            onClick={() => setActiveTab(card.tab)}
          />
        ))}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap h-auto gap-1">
          {isHR && <TabsTrigger value="employees">Employees</TabsTrigger>}
          <TabsTrigger value="leave">Leave Management</TabsTrigger>
          <TabsTrigger value="holidays">Holidays</TabsTrigger>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="announcements">Announcements</TabsTrigger>
          {/*
            Employees, Assets, Performance Reviews and Succession Planning all
            read HR-only endpoints — those routes accept HR_MANAGER and
            SUPER_ADMIN and answer 403 to everyone else. Rendering the tabs for
            every role meant a Regional Manager opening HR & ERP got a row of
            panels that each failed to load: measured at 70 rejected requests
            across five sweeps. PERMISSION_MATRIX already says this, giving
            REGIONAL_MANAGER `erp: ["read"]` but `erp_hr: []` — the tabs simply
            were not reading it. The self-service tabs below stay visible,
            because those routes branch on isHR and serve everyone their own row.
          */}
          {isHR && <TabsTrigger value="assets">Assets</TabsTrigger>}
          <TabsTrigger value="knowledge">Knowledge Base</TabsTrigger>
          {isHR && <TabsTrigger value="performance-reviews">Performance Reviews</TabsTrigger>}
          {isHR && <TabsTrigger value="succession-planning">Succession Planning</TabsTrigger>}
          {canSeeAccountRequests && (
            <TabsTrigger value="account-requests">Account Requests</TabsTrigger>
          )}
          {/* Sits beside Account Requests: joiners and leavers are the same job,
              and pairing them is what stops a departure being forgotten. */}
          {canSeeOffboarding && (
            <TabsTrigger value="offboarding">Offboarding</TabsTrigger>
          )}
          <TabsTrigger value="timesheets">Timesheets</TabsTrigger>
          {isHR && <TabsTrigger value="leave-balances">Leave Balances</TabsTrigger>}
        </TabsList>
        {isHR && (
          <TabsContent value="employees" className="mt-4">
            <EmployeeTable isHR={isHR} isSuperAdmin={isSuperAdmin} />
          </TabsContent>
        )}
        <TabsContent value="leave" className="mt-4">
          <LeaveManager
            isHR={isHR}
            userId={userId}
            myEmployeeId={myEmployeeId}
            myLeaveBalances={myLeaveBalances}
          />
        </TabsContent>
        <TabsContent value="holidays" className="mt-4">
          <HolidayManager isHR={isHR} />
        </TabsContent>
        <TabsContent value="attendance" className="mt-4">
          <AttendanceTracker isHR={isHR} userId={userId} />
        </TabsContent>
        <TabsContent value="tasks" className="mt-4">
          <TaskBoard userId={userId} isHR={isHR} />
        </TabsContent>
        <TabsContent value="announcements" className="mt-4">
          <Announcements isHR={isHR} userId={userId} />
        </TabsContent>
        {isHR && (
          <TabsContent value="assets" className="mt-4">
            <AssetManager isHR={isHR} />
          </TabsContent>
        )}
        <TabsContent value="knowledge" className="mt-4">
          <KnowledgeBaseView isHR={isHR} />
        </TabsContent>
        {isHR && (
          <TabsContent value="performance-reviews" className="mt-4">
            <PerformanceReviews isHR={isHR} />
          </TabsContent>
        )}
        {isHR && (
          <TabsContent value="succession-planning" className="mt-4">
            <SuccessionPlanning isHR={isHR} />
          </TabsContent>
        )}
        {/* Visible to everyone: the panel itself shows only the sheets you own
            or approve, and staff who are not required to submit simply see an
            empty state explaining why. Gating the tab by role would hide it
            from the very people who have to fill it in. */}
        <TabsContent value="timesheets" className="mt-4">
          <TimesheetsPanel />
        </TabsContent>
        {isHR && (
          <TabsContent value="leave-balances" className="mt-4">
            <LeaveBalances />
          </TabsContent>
        )}
        {canSeeAccountRequests && (
          <TabsContent value="account-requests" className="mt-4">
            <AccountRequests />
          </TabsContent>
        )}
        {canSeeOffboarding && (
          <TabsContent value="offboarding" className="mt-4">
            <OffboardingRequests />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
