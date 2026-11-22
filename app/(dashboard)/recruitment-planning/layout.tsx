import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";

/**
 * Recruitment Planning shell.
 *
 * Events and Campaigns moved here from Recruitment Network on 2026-09-18. They
 * were written as bare page bodies, relying on the Recruitment Network layout
 * for their padding and heading, so this layout has to provide the same frame
 * or they arrive with no margin and no title.
 *
 * It wraps the plans list and the plan detail page too, which matches how
 * Recruitment Network already treats `partners/[id]`.
 */

const TABS: Array<{ href: string; label: string }> = [
  { href: "/recruitment-planning", label: "Plans" },
  { href: "/recruitment-planning/events", label: "Events" },
  { href: "/recruitment-planning/campaigns", label: "Campaigns" },
];

export default function RecruitmentPlanningLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Recruitment Planning"
        description="Quarterly plans, budget approval, events and campaigns."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Recruitment Planning" }]}
      />
      <nav className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800">
        {TABS.map((t) => (
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
