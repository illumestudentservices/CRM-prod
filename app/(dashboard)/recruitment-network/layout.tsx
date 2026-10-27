import Link from "next/link";
import { auth } from "@/lib/auth";
import { effectiveHasPermission } from "@/lib/effective-permissions";

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
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Recruitment Network</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Partners and network performance. Events and campaigns moved to Recruitment Planning.
      </p>
      <nav className="flex gap-2 border-b mb-4">
        {tabs.map((t) => (
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
