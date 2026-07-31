import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { Search, Users, Building2, Globe, Calendar } from "lucide-react";
import { displayName, nameSearchFilter } from "@/lib/person-name";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  const { q } = await searchParams;
  const query = q?.trim() ?? "";

  if (!query) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Search"
          breadcrumbs={[{ label: "Home", href: "/" }, { label: "Search" }]}
        />
        <div className="text-center py-20 text-muted-foreground">
          <Search className="h-12 w-12 mx-auto mb-4 opacity-20" />
          <p className="text-lg font-medium">Enter a search term</p>
          <p className="text-sm mt-1">Search for students, institutions, sources, or events</p>
        </div>
      </div>
    );
  }

  const like = { contains: query, mode: "insensitive" as const };
  // Matches each token against either name part, so "Nkechi Obi" still finds a
  // lead whose two halves are stored in separate columns.
  const byName = nameSearchFilter(query);

  const [leads, institutions, sources, events] = await Promise.all([
    db.lead.findMany({
      where: {
        deletedAt: null,
        OR: [
          ...(byName ? [byName] : []),
          { email: like },
          { phone: like },
          { nationality: like },
        ],
      },
      take: 10,
    }),
    db.institution.findMany({
      where: {
        deletedAt: null,
        OR: [{ name: like }, { country: like }],
      },
      take: 10,
    }),
    db.source.findMany({
      where: {
        deletedAt: null,
        OR: [{ name: like }, { country: like }, { city: like }],
      },
      take: 10,
    }),
    db.event.findMany({
      where: {
        deletedAt: null,
        OR: [{ name: like }, { city: like }, { country: like }],
      },
      take: 10,
    }),
  ]);

  const totalResults = leads.length + institutions.length + sources.length + events.length;

  const STAGE_LABELS: Record<string, string> = {
    NEW: "New", CONTACTED: "Contacted", QUALIFIED: "Qualified",
    APPLIED: "Applied", ENROLLED: "Enrolled", LOST: "Lost",
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Search Results"
        description={`${totalResults} result${totalResults !== 1 ? "s" : ""} for "${query}"`}
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "Search" }]}
      />

      {totalResults === 0 && (
        <div className="text-center py-20 text-muted-foreground">
          <Search className="h-12 w-12 mx-auto mb-4 opacity-20" />
          <p className="text-lg font-medium">No results found</p>
          <p className="text-sm mt-1">Try a different search term</p>
        </div>
      )}

      {leads.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-500 uppercase tracking-wide">
            <Users className="h-4 w-4" /> Students ({leads.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {leads.map((lead) => (
              <Link key={lead.id} href={`/students/${lead.id}`}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer">
                  <CardContent className="p-4 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{displayName(lead)}</p>
                      <p className="text-xs text-muted-foreground truncate">{lead.email}</p>
                      {lead.nationality && (
                        <p className="text-xs text-muted-foreground">{lead.nationality}</p>
                      )}
                    </div>
                    <Badge variant="secondary" className="shrink-0 text-xs">
                      {STAGE_LABELS[lead.stage] ?? lead.stage}
                    </Badge>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {institutions.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-500 uppercase tracking-wide">
            <Building2 className="h-4 w-4" /> Institutions ({institutions.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {institutions.map((inst) => (
              <Link key={inst.id} href={`/institutions/${inst.id}`}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer">
                  <CardContent className="p-4 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{inst.name}</p>
                      <p className="text-xs text-muted-foreground">{inst.country}</p>
                    </div>
                    <Badge variant="outline" className="shrink-0 text-xs">{inst.type}</Badge>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {sources.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-500 uppercase tracking-wide">
            <Globe className="h-4 w-4" /> Sources ({sources.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {sources.map((src) => (
              <Link key={src.id} href={`/sources/${src.id}`}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer">
                  <CardContent className="p-4 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{src.name}</p>
                      {src.city && (
                        <p className="text-xs text-muted-foreground truncate">{src.city}, {src.country}</p>
                      )}
                    </div>
                    <Badge variant="secondary" className="shrink-0 text-xs">{src.type}</Badge>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {events.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-500 uppercase tracking-wide">
            <Calendar className="h-4 w-4" /> Events ({events.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {events.map((evt) => (
              <Link key={evt.id} href={`/events/${evt.id}`}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer">
                  <CardContent className="p-4 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{evt.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{evt.city}, {evt.country}</p>
                    </div>
                    <Badge variant="secondary" className="shrink-0 text-xs">{evt.status}</Badge>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
