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
  };
}

// ─── Status config ─────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  AccountStatus,
  { label: string; className: string }
> = {
  PROSPECT: {
    label: "Prospect",
    className: "bg-slate-100 text-slate-600 border-slate-200",
  },
  ACTIVE: {
    label: "Active",
    className: "bg-green-100 text-green-700 border-green-200",
  },
  RENEWAL_DUE: {
    label: "Renewal Due",
    className: "bg-amber-100 text-amber-700 border-amber-200",
  },
  CHURNED: {
    label: "Churned",
    className: "bg-red-100 text-red-700 border-red-200",
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

  return (
    <Card
      className="cursor-pointer hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 border-slate-200"
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
            <p className="font-semibold text-slate-900 truncate text-sm leading-tight">
              {institution.name}
            </p>
            <p className="text-xs text-slate-500 mt-0.5 truncate">
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

        {/* Quick Stats */}
        <div className="grid grid-cols-3 gap-2">
          <div className="flex flex-col items-center bg-slate-50 rounded-lg p-2 gap-1">
            <GraduationCap className="h-4 w-4 text-slate-400" />
            <span className="text-sm font-semibold text-slate-900">
              {institution.leadsCount}
            </span>
            <span className="text-[10px] text-slate-500">Leads</span>
          </div>
          <div className="flex flex-col items-center bg-slate-50 rounded-lg p-2 gap-1">
            <Users className="h-4 w-4 text-slate-400" />
            <span className="text-sm font-semibold text-slate-900">
              {institution.usersCount}
            </span>
            <span className="text-[10px] text-slate-500">ICRs</span>
          </div>
          <div className="flex flex-col items-center bg-slate-50 rounded-lg p-2 gap-1">
            <FileText className="h-4 w-4 text-slate-400" />
            <span className="text-sm font-semibold text-slate-900">
              {institution.contractsCount}
            </span>
            <span className="text-[10px] text-slate-500">Contracts</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
