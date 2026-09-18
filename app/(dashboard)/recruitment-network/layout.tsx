import Link from "next/link";

const TABS: Array<{ href: string; label: string }> = [
  { href: "/recruitment-network/partners", label: "Recruitment Partners" },
  // Events and Campaigns moved to Recruitment Planning on 2026-09-18. The old
  // URLs still resolve — they redirect — so existing links and bookmarks work.
  { href: "/recruitment-network/performance", label: "Network Performance" },
];

export default function RecruitmentNetworkLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Recruitment Network</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Partners and network performance. Events and campaigns moved to Recruitment Planning.
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
