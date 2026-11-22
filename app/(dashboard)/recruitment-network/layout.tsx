import Link from "next/link";
import { auth } from "@/lib/auth";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { PageHeader } from "@/components/shared/page-header";

const TABS: Array<{ href: string; label: string }> = [
  { href: "/recruitment-network/partners", label: "Recruitment Partners" },
  // Events and Campaigns moved to Recruitment Planning on 2026-09-18. The old
  // URLs still resolve — they redirect — so existing links and bookmarks work.
  { href: "/recruitment-network/performance", label: "Network Performance" },
];

export default async function RecruitmentNetworkLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  // Network Performance is gated on reports:read (see performance/page.tsx), so
  // a role that cannot open it — ICR — is not shown a dead tab for it.
  const canSeePerformance = session?.user
    ? await effectiveHasPermission(session.user.role, "reports", "read")
    : false;
  const tabs = TABS.filter(
    (t) => t.href !== "/recruitment-network/performance" || canSeePerformance
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recruitment Network"
        description="Partners and network performance."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Recruitment Network" }]}
      />
      <nav className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800">
        {tabs.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="rounded-t-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/60 dark:hover:text-slate-100"
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <div>{children}</div>
    </div>
  );
}
