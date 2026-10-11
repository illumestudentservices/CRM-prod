"use client";

import * as React from "react";
import Link from "next/link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { HolidayList } from "@/components/hr/holiday-list";
import { LeaveSection } from "./leave-section";
import { AttachmentsPanel } from "@/components/attachments/attachments-panel";
import { MAX_UPLOAD_MB } from "@/lib/uploads";

// ─── Types ─────────────────────────────────────────────────────────────────

interface DirectReport {
  id: string;
  jobTitle: string;
  user: { name: string | null };
}

interface LeaveBalance {
  leaveType: string;
  /** Derived entitlement from lib/leave-policy, not the stored column — that
   *  one is always 0, and subtracting from it showed negative days remaining. */
  totalDays: number;
  usedDays: number;
  pendingDays: number;
  availableDays: number;
}

interface Worklog {
  id: string;
  date: Date | string;
  taskDesc: string;
  notes: string | null;
  hours: number;
  location: string | null;
}

interface TrainingRecord {
  id: string;
  title: string;
  provider: string | null;
  completedAt: Date | string | null;
  expiryDate: Date | string | null;
}

interface AssetAssignment {
  id: string;
  assignedAt: Date | string;
  asset: { name: string; type: string; serialNumber: string | null };
}

interface PerformanceReview {
  id: string;
  period: string;
  score: number | null;
  status: string;
  completedAt: Date | string | null;
  createdAt: Date | string;
}

interface ProfileData {
  name: string | null;
  email: string;
  phone: string | null;
  regionName: string | null;
  address: string | null;
  emergencyContact: string | null;
  emergencyPhone: string | null;
  managerName: string | null;
  directReports: DirectReport[];
}

interface EmployeeTabsClientProps {
  employeeId: string;
  profile: ProfileData;
  leaveBalances: LeaveBalance[];
  isOwnProfile: boolean;
  /** A line manager, here only to file documents. Hides every other tab. */
  documentsOnly?: boolean;
  worklogs: Worklog[];
  isHR: boolean;
  trainingRecords: TrainingRecord[];
  assetAssignments: AssetAssignment[];
  performanceReviews: PerformanceReview[];
}

// ─── Component ─────────────────────────────────────────────────────────────

/**
 * Every tab value that has a trigger below. A ?tab= outside this set is
 * ignored, because Radix renders an empty panel under no highlighted tab for a
 * value it has no trigger for — a blank page that looks like a broken one.
 */
const TAB_VALUES = new Set([
  "profile", "leave", "holidays", "worklogs", "training", "assets", "reviews", "documents",
]);

export function EmployeeTabsClient({
  employeeId,
  profile,
  leaveBalances,
  isOwnProfile,
  documentsOnly = false,
  worklogs,
  isHR,
  trainingRecords,
  assetAssignments,
  performanceReviews,
}: EmployeeTabsClientProps) {
  /**
   * ★ THE DEFAULT MATTERS AS MUCH AS THE TRIGGER.
   *
   * Hiding the Profile TAB while still defaulting to it would have rendered
   * the address and next-of-kin panel on load, with only the button to switch
   * away missing. A manager would have landed on exactly the data this is
   * meant to keep from them.
   */
  const [activeTab, setActiveTab] = React.useState(
    documentsOnly ? "documents" : "profile",
  );

  // /hr?tab=leave redirects an EMPLOYEE here and carries the tab with it, so
  // honour it — otherwise the dashboard's leave card lands them on Profile and
  // leaves them to find Leave for themselves. Same approach as the HR tabs.
  // Read in an effect rather than from useSearchParams() so this component does
  // not have to sit inside a Suspense boundary.
  React.useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (tab && TAB_VALUES.has(tab)) setActiveTab(tab);
  }, []);

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <TabsList className="flex-wrap h-auto gap-1">
        {/* A manager opening a report's record sees Documents alone. The
            Profile tab holds a home address and a next-of-kin number, which
            are no part of filing a contract. */}
        {!documentsOnly && <TabsTrigger value="profile">Profile</TabsTrigger>}
        {!documentsOnly && <TabsTrigger value="leave">Leave</TabsTrigger>}
        {!documentsOnly && <TabsTrigger value="holidays">Holidays</TabsTrigger>}
        {!documentsOnly && <TabsTrigger value="worklogs">Worklogs</TabsTrigger>}
        {!documentsOnly && <TabsTrigger value="training">Training</TabsTrigger>}
        {!documentsOnly && <TabsTrigger value="assets">Assets</TabsTrigger>}
        {!documentsOnly && <TabsTrigger value="reviews">Performance Reviews</TabsTrigger>}
        <TabsTrigger value="documents">Documents</TabsTrigger>
      </TabsList>

      {/* PROFILE */}
      {!documentsOnly && (
      <TabsContent value="profile" className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Personal Information</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Full Name</span><span className="font-medium">{profile.name}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Email</span><span className="font-medium">{profile.email}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Phone</span><span className="font-medium">{profile.phone ?? "—"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Region</span><span className="font-medium">{profile.regionName ?? "—"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Address</span><span className="font-medium text-right max-w-[200px]">{profile.address ?? "—"}</span></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Emergency Contact</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Name</span><span className="font-medium">{profile.emergencyContact ?? "—"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Phone</span><span className="font-medium">{profile.emergencyPhone ?? "—"}</span></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Reporting Structure</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Manager</span><span className="font-medium">{profile.managerName ?? "—"}</span></div>
            <div>
              <span className="text-muted-foreground">Direct Reports</span>
              {profile.directReports.length === 0
                ? <p className="text-muted-foreground mt-1">None</p>
                : profile.directReports.map((r) => (
                  <div key={r.id} className="mt-1">
                    <Link href={`/hr/employees/${r.id}`} className="text-[#0EA5E9] hover:underline">
                      {r.user.name} — {r.jobTitle}
                    </Link>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      </TabsContent>
      )}

      {/* LEAVE */}
      {!documentsOnly && (
      <TabsContent value="leave" className="mt-4">
        <LeaveSection employeeId={employeeId} balances={leaveBalances} isOwnProfile={isOwnProfile} />
      </TabsContent>
      )}

      {/* HOLIDAYS — the same global + own-region list the HR tab shows, read
          only. An EMPLOYEE is redirected off /hr, so this was the one ERP
          calendar they had no way to open. */}
      {!documentsOnly && (
      <TabsContent value="holidays" className="mt-4">
        <HolidayList />
      </TabsContent>
      )}

      {/* WORKLOGS */}
      {!documentsOnly && (
      <TabsContent value="worklogs" className="mt-4">
        <Card>
          <CardContent className="p-4">
            <div className="space-y-2">
              {worklogs.length === 0
                ? <p className="text-muted-foreground text-sm text-center py-6">No worklogs recorded.</p>
                : worklogs.map((w) => (
                  <div key={w.id} className="flex items-start gap-4 p-3 rounded-lg bg-muted/30 border">
                    <div className="text-sm font-mono text-muted-foreground w-24 shrink-0">{formatDate(w.date)}</div>
                    <div className="flex-1">
                      <p className="text-sm">{w.taskDesc}</p>
                      {w.notes && <p className="text-xs text-muted-foreground mt-1">{w.notes}</p>}
                    </div>
                    <Badge variant="secondary">{w.hours}h</Badge>
                    {w.location && <span className="text-xs text-muted-foreground">{w.location}</span>}
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      </TabsContent>
      )}

      {/* TRAINING */}
      {!documentsOnly && (
      <TabsContent value="training" className="mt-4">
        <Card>
          <CardContent className="p-4 space-y-3">
            {trainingRecords.length === 0
              ? <p className="text-muted-foreground text-sm text-center py-6">No training records.</p>
              : trainingRecords.map((t) => (
                <div key={t.id} className="flex items-start justify-between p-3 rounded-lg bg-muted/30 border">
                  <div>
                    <p className="font-medium text-sm">{t.title}</p>
                    {t.provider && <p className="text-xs text-muted-foreground">{t.provider}</p>}
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    {t.completedAt && <p>Completed: {formatDate(t.completedAt)}</p>}
                    {t.expiryDate && <p className="text-amber-600">Expires: {formatDate(t.expiryDate)}</p>}
                  </div>
                </div>
              ))}
          </CardContent>
        </Card>
      </TabsContent>
      )}

      {/* ASSETS */}
      {!documentsOnly && (
      <TabsContent value="assets" className="mt-4">
        <Card>
          <CardContent className="p-4 space-y-3">
            {assetAssignments.length === 0
              ? <p className="text-muted-foreground text-sm text-center py-6">No assets assigned.</p>
              : assetAssignments.map((a) => (
                <div key={a.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border">
                  <div>
                    <p className="font-medium text-sm">{a.asset.name}</p>
                    <p className="text-xs text-muted-foreground">{a.asset.type}{a.asset.serialNumber ? ` • S/N: ${a.asset.serialNumber}` : ""}</p>
                  </div>
                  <div className="text-xs text-muted-foreground text-right">
                    <p>Since {formatDate(a.assignedAt)}</p>
                  </div>
                </div>
              ))}
          </CardContent>
        </Card>
      </TabsContent>
      )}

      {/* PERFORMANCE REVIEWS */}
      {!documentsOnly && (
      <TabsContent value="reviews" className="mt-4">
        <Card>
          <CardContent className="p-4 space-y-3">
            {performanceReviews.length === 0
              ? <p className="text-muted-foreground text-sm text-center py-6">No performance reviews.</p>
              : performanceReviews.map((r) => {
                const statusStyle: Record<string, { variant: "warning" | "default" | "success"; label: string }> = {
                  PENDING: { variant: "warning", label: "Pending" },
                  IN_PROGRESS: { variant: "default", label: "In Progress" },
                  COMPLETED: { variant: "success", label: "Completed" },
                };
                const badge = statusStyle[r.status] ?? { variant: "secondary" as const, label: r.status };
                return (
                  <div key={r.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border">
                    <div className="flex items-center gap-4">
                      <div>
                        <p className="font-medium text-sm">{r.period}</p>
                        {r.score != null && (
                          <p className="text-xs text-muted-foreground">Score: {r.score.toFixed(1)} / 5</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                      {r.completedAt && (
                        <span className="text-xs text-muted-foreground">
                          Completed: {formatDate(r.completedAt)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
          </CardContent>
        </Card>
      </TabsContent>
      )}

      {/* DOCUMENTS */}
      <TabsContent value="documents" className="mt-4 space-y-4">
        {/*
          ★ THIS PERSON'S SPACE, AND NOBODY ELSE'S.

          parentId is this employee's id, so a file uploaded here hangs off
          this record alone. The gate is EMPLOYEE_DOCUMENT in
          lib/attachment-parent.ts: the person themselves, and HR. Not a
          colleague, and deliberately not their line manager — a staff record
          carries contracts, visas and medical notes.

          Size and file type are not decided here. AttachmentsPanel enforces
          the one app-wide 3 MB limit from lib/uploads.ts, and the server
          re-checks it and runs validateAttachment, which refuses html, svg,
          exe and script types and rejects anything whose extension disagrees
          with its MIME. A client check is a convenience; the server is the
          boundary.
        */}
        {/* No outer card title: AttachmentsPanel draws its own "Attachments"
            heading, and two of them stacked read as a mistake. */}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Contracts, certificates and right-to-work paperwork. Up to {MAX_UPLOAD_MB} MB each.
            Visible to this employee and HR only &mdash; not to colleagues, and not to their manager.
          </p>
          <AttachmentsPanel parentType="EMPLOYEE_DOCUMENT" parentId={employeeId} />
        </div>

      </TabsContent>
    </Tabs>
  );
}
