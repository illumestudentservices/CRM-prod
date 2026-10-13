"use client";

import { useEffect, useMemo, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { EmailLink } from "@/components/shared/email-link";
import { getInitials } from "@/lib/utils";
import {
  Search, Users, Network, ChevronRight, ChevronDown, MapPin, Briefcase, X,
} from "lucide-react";

type Person = {
  id: string;
  employeeId: string;
  name: string;
  jobTitle: string;
  email: string;
  image: string | null;
  department: string | null;
  region: string | null;
  managerId: string | null;
  reports: number;
};

type Node = Person & { children: Node[] };

/** "Everything" in a Select — Radix forbids an empty-string value. */
const ANY = "__any__";

/**
 * ★ THE TREE IS BUILT HERE AS WELL AS ON THE SERVER.
 *
 * The API returns a flat list because the People view wants one and because a
 * nested payload cannot be filtered without rebuilding it anyway. The same
 * rule applies: anybody whose manager is not in the list becomes a root, so a
 * deactivated manager cannot make a whole branch disappear silently.
 */
function buildTree(people: Person[]): Node[] {
  const byId = new Map<string, Node>(people.map((p) => [p.id, { ...p, children: [] }]));
  const roots: Node[] = [];
  for (const n of byId.values()) {
    const parent = n.managerId ? byId.get(n.managerId) : undefined;
    if (parent && parent.id !== n.id) parent.children.push(n);
    else roots.push(n);
  }
  const sort = (ns: Node[]) => {
    ns.sort((a, b) => b.children.length - a.children.length || a.name.localeCompare(b.name));
    ns.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

function PersonAvatar({ p, size = "h-10 w-10" }: { p: Person; size?: string }) {
  return (
    <Avatar className={`${size} shrink-0`}>
      {p.image && <AvatarImage src={p.image} alt="" />}
      <AvatarFallback className="text-xs">{getInitials(p.name)}</AvatarFallback>
    </Avatar>
  );
}

export function DirectoryClient() {
  const [people, setPeople] = useState<Person[]>([]);
  const [myId, setMyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [fRegion, setFRegion] = useState(ANY);
  const [fDept, setFDept] = useState(ANY);
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/directory")
      .then(async (r) => {
        if (!r.ok) throw new Error(`Could not load the directory (${r.status})`);
        return r.json();
      })
      .then((d) => {
        setPeople(d.people ?? []);
        setMyId(d.myEmployeeId ?? null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const tree = useMemo(() => buildTree(people), [people]);

  const regions = useMemo(
    () => [...new Set(people.map((p) => p.region).filter(Boolean))].sort() as string[],
    [people],
  );
  const departments = useMemo(
    () => [...new Set(people.map((p) => p.department).filter(Boolean))].sort() as string[],
    [people],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return people.filter((p) => {
      if (fRegion !== ANY && p.region !== fRegion) return false;
      if (fDept !== ANY && p.department !== fDept) return false;
      if (!needle) return true;
      return (
        p.name.toLowerCase().includes(needle) ||
        p.jobTitle.toLowerCase().includes(needle) ||
        p.email.toLowerCase().includes(needle) ||
        p.employeeId.toLowerCase().includes(needle) ||
        (p.department ?? "").toLowerCase().includes(needle) ||
        (p.region ?? "").toLowerCase().includes(needle)
      );
    });
  }, [people, q, fRegion, fDept]);

  // The two top levels open by default: the shape of the company without a
  // wall of 101 names.
  useEffect(() => {
    if (!tree.length || open.size) return;
    const next = new Set<string>();
    for (const r of tree) {
      next.add(r.id);
      for (const c of r.children) if (c.children.length) next.add(c.id);
    }
    setOpen(next);
  }, [tree, open.size]);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const expandAll = () =>
    setOpen(new Set(people.filter((p) => p.reports > 0).map((p) => p.id)));
  const collapseAll = () => setOpen(new Set());

  const filtersOn = fRegion !== ANY || fDept !== ANY || !!q.trim();

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          <p>{error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Staff Directory</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Everyone at Illume, and who reports to whom. {people.length} people.
        </p>
      </div>

      <Tabs defaultValue="people">
        <TabsList>
          <TabsTrigger value="people" className="gap-1.5">
            <Users className="h-3.5 w-3.5" /> People
          </TabsTrigger>
          <TabsTrigger value="structure" className="gap-1.5">
            <Network className="h-3.5 w-3.5" /> Structure
          </TabsTrigger>
        </TabsList>

        {/* ── People ─────────────────────────────────────────────────────── */}
        <TabsContent value="people" className="mt-4 space-y-4">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by name, job title, team or region…"
                className="pl-9"
              />
            </div>
            <Select value={fRegion} onValueChange={setFRegion}>
              <SelectTrigger className="sm:w-48"><SelectValue placeholder="All regions" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>All regions</SelectItem>
                {regions.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={fDept} onValueChange={setFDept}>
              <SelectTrigger className="sm:w-44"><SelectValue placeholder="All teams" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>All teams</SelectItem>
                {departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
            {filtersOn && (
              <Button
                variant="ghost" size="sm" className="shrink-0"
                onClick={() => { setQ(""); setFRegion(ANY); setFDept(ANY); }}
              >
                <X className="h-4 w-4 mr-1" /> Clear
              </Button>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Showing {filtered.length} of {people.length}
          </p>

          {filtered.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Users className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p>Nobody matches that.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((p) => {
                const mgr = p.managerId ? byId.get(p.managerId) : null;
                return (
                  <Card
                    key={p.id}
                    className={p.id === myId ? "border-[#0EA5E9] bg-blue-50/30 dark:bg-sky-500/10" : ""}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3 min-w-0">
                        <PersonAvatar p={p} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <p className="font-semibold text-sm truncate">{p.name}</p>
                            {p.id === myId && (
                              <Badge variant="outline" className="text-[10px] h-4 px-1.5 shrink-0">You</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{p.jobTitle}</p>
                          <div className="mt-2">
                            <EmailLink email={p.email} kind="colleague" className="text-xs break-all" />
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 mt-2">
                            {p.department && (
                              <Badge variant="secondary" className="text-[10px] h-4 px-1.5 gap-1">
                                <Briefcase className="h-2.5 w-2.5" />{p.department}
                              </Badge>
                            )}
                            {p.region && (
                              <Badge variant="outline" className="text-[10px] h-4 px-1.5 gap-1">
                                <MapPin className="h-2.5 w-2.5" />{p.region}
                              </Badge>
                            )}
                            {p.reports > 0 && (
                              <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                                {p.reports} report{p.reports === 1 ? "" : "s"}
                              </Badge>
                            )}
                          </div>
                          {mgr && (
                            <p className="text-[11px] text-muted-foreground mt-2 truncate">
                              Reports to {mgr.name}
                            </p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ── Structure ──────────────────────────────────────────────────── */}
        <TabsContent value="structure" className="mt-4 space-y-3">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={expandAll}>Expand all</Button>
            <Button variant="outline" size="sm" onClick={collapseAll}>Collapse all</Button>
            <p className="text-xs text-muted-foreground ml-auto">
              {people.filter((p) => p.reports > 0).length} people have direct reports
            </p>
          </div>

          <Card>
            <CardContent className="p-2 sm:p-4 overflow-x-auto">
              {tree.map((root) => (
                <TreeRow
                  key={root.id}
                  node={root}
                  depth={0}
                  open={open}
                  toggle={toggle}
                  myId={myId}
                />
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TreeRow({
  node, depth, open, toggle, myId,
}: {
  node: Node;
  depth: number;
  open: Set<string>;
  toggle: (id: string) => void;
  myId: string | null;
}) {
  const hasKids = node.children.length > 0;
  const isOpen = open.has(node.id);

  return (
    <div className="min-w-fit">
      <div
        className={`flex items-center gap-2 rounded-md py-1.5 pr-2 ${
          node.id === myId ? "bg-blue-50/60 dark:bg-sky-500/10" : "hover:bg-muted/50"
        }`}
        // Indent with padding rather than nested margins so a deep branch
        // still lines up and the row stays one clickable strip.
        style={{ paddingLeft: `${depth * 20 + 4}px` }}
      >
        {hasKids ? (
          <button
            type="button"
            onClick={() => toggle(node.id)}
            aria-label={isOpen ? `Collapse ${node.name}'s team` : `Expand ${node.name}'s team`}
            aria-expanded={isOpen}
            className="shrink-0 p-0.5 rounded hover:bg-muted"
          >
            {isOpen
              ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
              : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </button>
        ) : (
          <span className="w-5 shrink-0" aria-hidden />
        )}

        <PersonAvatar p={node} size="h-7 w-7" />

        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
          <span className="text-sm font-medium whitespace-nowrap">{node.name}</span>
          {node.id === myId && (
            <Badge variant="outline" className="text-[10px] h-4 px-1.5">You</Badge>
          )}
          <span className="text-xs text-muted-foreground whitespace-nowrap">{node.jobTitle}</span>
          {node.region && (
            <Badge variant="outline" className="text-[10px] h-4 px-1.5 whitespace-nowrap">
              {node.region}
            </Badge>
          )}
          {hasKids && (
            <span className="text-[11px] text-muted-foreground whitespace-nowrap">
              · {node.children.length} direct
            </span>
          )}
        </div>
      </div>

      {hasKids && isOpen && (
        <div className="border-l border-border/60 ml-[13px]">
          {node.children.map((c) => (
            <TreeRow key={c.id} node={c} depth={depth + 1} open={open} toggle={toggle} myId={myId} />
          ))}
        </div>
      )}
    </div>
  );
}
