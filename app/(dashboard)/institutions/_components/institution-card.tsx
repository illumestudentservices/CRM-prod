"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { type AccountStatus } from "@prisma/client";
import { Users, FileText, GraduationCap } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getInitials, cn } from "@/lib/utils";

// ─── Types ─────────────────────────────────────────────────────────────────

interface InstitutionCardProps {
  institution: {
    id: string;
    name: string;
    country: string;
    type: string;
    logoUrl: string | null;
    accountStatus: AccountStatus;
    leadsCount: number;
    contractsCount: number;
    usersCount: number;
    /// Spec §12 — surfaced on the card so an account manager can see which
    /// client needs attention without opening each one.
    openIssuesCount?: number;
    accountHealth?: string | null;
    renewalDate?: string | null;
  };
}

// ─── Status config ─────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  AccountStatus,
  { label: string; className: string }
> = {
  PROSPECT: {
    label: "Prospect",
    className: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
  },
  ONBOARDING: {
    label: "Onboarding",
    className: "bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30",
  },
  ACTIVE: {
    label: "Active",
    className: "bg-green-100 text-green-700 border-green-200 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/30",
  },
  INACTIVE: {
    label: "Inactive",
    className: "bg-gray-100 text-gray-600 border-gray-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700",
  },
  SUSPENDED: {
    label: "Suspended",
    className: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30",
  },
  CLOSED: {
    label: "Closed",
    className: "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700",
  },
  // Legacy — retained for pre-migration-019 rows. Renewal is now a computed
  // alert from Contract.endDate; rows with this status render the label but
  // new rows should never be written with it.
  RENEWAL_DUE: {
    label: "Renewal Due",
    className: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30",
  },
  CHURNED: {
    label: "Churned",
    className: "bg-red-100 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30",
  },
};

// ─── Avatar color from name ────────────────────────────────────────────────

const AVATAR_COLORS = [
  "bg-blue-500",
  "bg-indigo-500",
  "bg-violet-500",
  "bg-emerald-500",
  "bg-teal-500",
  "bg-cyan-500",
  "bg-amber-500",
  "bg-rose-500",
];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// ─── Component ─────────────────────────────────────────────────────────────

export function InstitutionCard({ institution }: InstitutionCardProps) {
  const router = useRouter();
  const status = STATUS_CONFIG[institution.accountStatus];
  const avatarColor = getAvatarColor(institution.name);
  const initials = getInitials(institution.name);

  // Days until the contract renews, or null when there is no renewal date or
  // it is far enough away not to matter. 60 days is the window the business
  // already uses for renewal reminders elsewhere.
  const RENEWAL_WINDOW_DAYS = 60;
  const renewalDays = (() => {
    if (!institution.renewalDate) return null;
    const d = new Date(institution.renewalDate);
    if (Number.isNaN(d.getTime())) return null;
    // UTC day arithmetic, matching the rest of the app — a local-time boundary
    // would make the count differ by where the viewer is sitting.
    const startOfDay = (x: Date) => Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
    const days = Math.round((startOfDay(d) - startOfDay(new Date())) / 86_400_000);
    return days <= RENEWAL_WINDOW_DAYS ? days : null;
  })();

  return (
    <Card
      className="cursor-pointer hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 border-slate-200 dark:border-slate-800"
      onClick={() => router.push(`/institutions/${institution.id}`)}
    >
      <CardContent className="p-5">
        {/* Header */}
        <div className="flex items-start gap-3 mb-4">
          {/* Avatar */}
          <div
            className={cn(
              "h-11 w-11 rounded-xl flex items-center justify-center text-white font-bold text-sm shrink-0",
              avatarColor
            )}
          >
            {institution.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={institution.logoUrl}
                alt={institution.name}
                className="h-full w-full object-contain rounded-xl"
              />
            ) : (
              initials
            )}
          </div>

          {/* Name + Status */}
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-slate-900 dark:text-slate-100 truncate text-sm leading-tight">
              {institution.name}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
              {institution.country} · {institution.type}
            </p>
          </div>
        </div>

        {/* Status Badge */}
        <div className="mb-4">
          <span
            className={cn(
              "inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border",
              status.className
            )}
          >
            {status.label}
          </span>
        </div>

        {/* Needs attention — spec §12.
            Open issues and an imminent renewal are the two things that decide
            whether an account manager should open this client today. Both
            existed only inside the record, so the list gave no signal at all
            and a client in trouble looked exactly like one that was fine.
            Rendered only when there is something to say, so a healthy client
            stays visually quiet. */}
        {(!!institution.openIssuesCount || renewalDays !== null || institution.accountHealth === "AMBER" || institution.accountHealth === "RED") && (
          <div className="flex flex-wrap gap-1.5" data-testid="client-attention">
            {!!institution.openIssuesCount && (
              <span
                data-testid="open-issues-pill"
                className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
              >
                {institution.openIssuesCount} open issue{institution.openIssuesCount === 1 ? "" : "s"}
              </span>
            )}
            {(institution.accountHealth === "AMBER" || institution.accountHealth === "RED") && (
              <span
                data-testid="health-pill"
                className={cn(
                  "text-[10px] font-medium px-2 py-0.5 rounded-full",
                  institution.accountHealth === "RED"
                    ? "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300"
                    : "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                )}
              >
                {institution.accountHealth === "RED" ? "At risk" : "Attention required"}
              </span>
            )}
            {renewalDays !== null && (
              <span
                data-testid="renewal-pill"
                className={cn(
                  "text-[10px] font-medium px-2 py-0.5 rounded-full",
                  renewalDays < 0
                    ? "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300"
                    : "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300"
                )}
              >
                {renewalDays < 0
                  ? `Renewal overdue by ${Math.abs(renewalDays)}d`
                  : `Renews in ${renewalDays}d`}
              </span>
            )}
          </div>
        )}

        {/* Quick Stats */}
        <div className="grid grid-cols-3 gap-2">
          <div className="flex flex-col items-center bg-slate-50 dark:bg-slate-800 rounded-lg p-2 gap-1">
            <GraduationCap className="h-4 w-4 text-slate-400 dark:text-slate-500" />
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {institution.leadsCount}
            </span>
            <span className="text-[10px] text-slate-500 dark:text-slate-400">Leads</span>
          </div>
          <div className="flex flex-col items-center bg-slate-50 dark:bg-slate-800 rounded-lg p-2 gap-1">
            <Users className="h-4 w-4 text-slate-400 dark:text-slate-500" />
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {institution.usersCount}
            </span>
            <span className="text-[10px] text-slate-500 dark:text-slate-400">ICRs</span>
          </div>
          <div className="flex flex-col items-center bg-slate-50 dark:bg-slate-800 rounded-lg p-2 gap-1">
            <FileText className="h-4 w-4 text-slate-400 dark:text-slate-500" />
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {institution.contractsCount}
            </span>
            <span className="text-[10px] text-slate-500 dark:text-slate-400">Contracts</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
