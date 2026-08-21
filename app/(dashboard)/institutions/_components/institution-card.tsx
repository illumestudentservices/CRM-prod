"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { type AccountStatus, type AccountHealth } from "@prisma/client";
import { Users, FileText, GraduationCap, ExternalLink, UserRound } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getInitials, cn } from "@/lib/utils";
import { HEALTH_LABELS, HEALTH_PILL } from "@/lib/account-health";

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
    /// The client's own site. Rendered as a small launcher in the corner so it
    /// is reachable without opening the record — the two things people wanted
    /// from this list were "who owns this" and "take me to their site".
    website?: string | null;
    /// Every region this client is worked in, not just the primary. The join
    /// table has held this since the client import; the card is where it finally
    /// becomes visible, because a client worked in five regions looked exactly
    /// like one worked in a single region.
    regionNames?: string[];
    /// The Client Relations owner from the client list.
    ownerName?: string | null;
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

  // A crest that fails to load has to fall back to initials, not to a broken
  // image icon. These files are fetched from the institutions' own sites, so
  // one of them going missing after a refresh is a question of when.
  const [logoBroken, setLogoBroken] = React.useState(false);
  const showLogo = !!institution.logoUrl && !logoBroken;

  const health = (institution.accountHealth ?? "GREY") as AccountHealth;
  // GREY means nobody has rated this client. A pill saying "Not assessed" on
  // two thirds of the grid would be noise, so absence stays silent.
  const showHealth = health !== "GREY";

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
        <div className="flex items-start gap-3 mb-3">
          {/*
            The logo tile stays white in both themes. These crests are the
            institutions' own favicons and every one of them is drawn to sit on
            a light background — several are dark navy or black wordmarks that
            vanish completely on a dark tile. The same mistake put a black frame
            around the Illume logo in the sidebar. Padding plus a hairline ring
            gives the mark room without implying a border.
          */}
          <div
            className={cn(
              "h-11 w-11 rounded-xl flex items-center justify-center shrink-0 overflow-hidden",
              showLogo
                ? "bg-white ring-1 ring-black/5 p-1.5"
                : cn("text-white font-bold text-sm", avatarColor)
            )}
          >
            {showLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={institution.logoUrl!}
                alt=""
                loading="lazy"
                onError={() => setLogoBroken(true)}
                className="h-full w-full object-contain"
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

          {institution.website && (
            <a
              href={institution.website}
              target="_blank"
              rel="noopener noreferrer"
              // The whole card navigates to the client record, so this has to
              // stop the click reaching it or the new tab opens and the CRM
              // navigates away underneath at the same time.
              onClick={(e) => e.stopPropagation()}
              title={`Open ${institution.name}`}
              aria-label={`Open the ${institution.name} website in a new tab`}
              className="shrink-0 -mr-1 -mt-1 p-1.5 rounded-md text-slate-400 hover:text-[#1E3A5F] hover:bg-slate-100 dark:text-slate-500 dark:hover:text-blue-300 dark:hover:bg-slate-800 transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>

        {/* Status + the client list's happiness rating, side by side */}
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          <span
            className={cn(
              "inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border",
              status.className
            )}
          >
            {status.label}
          </span>
          {showHealth && (
            <span
              data-testid="health-sentiment"
              title={`Account health: ${HEALTH_LABELS[health].full}`}
              className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium",
                HEALTH_PILL[health]
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  health === "GREEN" ? "bg-emerald-500" : health === "AMBER" ? "bg-amber-500" : "bg-red-500"
                )}
              />
              {HEALTH_LABELS[health].sentiment}
            </span>
          )}
        </div>

        {/* Regions worked. Truncated at three with a count, because Narxoz is
            worked in all six and a card is not a place for a wrapped list. */}
        {!!institution.regionNames?.length && (
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3 truncate">
            {institution.regionNames.slice(0, 3).join(" · ")}
            {institution.regionNames.length > 3 && ` +${institution.regionNames.length - 3}`}
          </p>
        )}

        {/* Needs attention — spec §12.
            Open issues and an imminent renewal are the two things that decide
            whether an account manager should open this client today. Both
            existed only inside the record, so the list gave no signal at all
            and a client in trouble looked exactly like one that was fine.
            Rendered only when there is something to say, so a healthy client
            stays visually quiet. */}
        {(!!institution.openIssuesCount || renewalDays !== null) && (
          <div className="flex flex-wrap gap-1.5 mb-3" data-testid="client-attention">
            {!!institution.openIssuesCount && (
              <span
                data-testid="open-issues-pill"
                className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
              >
                {institution.openIssuesCount} open issue{institution.openIssuesCount === 1 ? "" : "s"}
              </span>
            )}
            {/* The health warning that used to live here has moved up beside the
                status badge, where it now reads in the client list's own words
                ("Concerned" rather than "Attention required") and covers Green
                too. Repeating it here would say the same thing twice. */}
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

        {/* Who to ask. The client list keeps a Client Relations owner per
            account and it was the first thing anyone looked up; it lived only
            in the spreadsheet until now. */}
        {institution.ownerName && (
          <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
            <UserRound className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{institution.ownerName}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
