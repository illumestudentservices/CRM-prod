import Link from "next/link";

const TABS: Array<{ href: string; label: string }> = [
  { href: "/recruitment-network/partners", label: "Recruitment Partners" },
  { href: "/recruitment-network/events", label: "Events" },
  { href: "/recruitment-network/campaigns", label: "Campaigns" },
  { href: "/recruitment-network/performance", label: "Network Performance" },
];

export default function RecruitmentNetworkLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Recruitment Network</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Partners, events, campaigns and network performance in one place.
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
