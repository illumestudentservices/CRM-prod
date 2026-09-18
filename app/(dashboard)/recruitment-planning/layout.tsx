import Link from "next/link";

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
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Recruitment Planning</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Quarterly plans, budget approval, events and campaigns.
      </p>
      <nav className="flex gap-2 border-b mb-4">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="px-3 py-2 text-sm font-medium hover:bg-muted rounded-t transition-colors"
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <div>{children}</div>
    </div>
  );
}
