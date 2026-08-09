"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AgentTier } from "@prisma/client";

const TIER_COLOR: Record<string, string> = {
  PLATINUM: "bg-violet-100 text-violet-700 border-violet-200",
  GOLD: "bg-amber-100 text-amber-700 border-amber-200",
  SILVER: "bg-slate-100 text-slate-600 border-slate-200",
  EMERGING: "bg-green-100 text-green-700 border-green-200",
  INACTIVE: "bg-zinc-100 text-zinc-500 border-zinc-200",
};

interface AgentData {
  id: string;
  sourceId: string;
  tier: AgentTier;
  offers: number;
  deposits: number;
  enrolments: number;
  visaApprovals: number;
  yieldRate: number | null;
  source: {
    id: string;
    name: string;
    country: string;
  };
  leadCount: number;
}

interface Props {
  agents: AgentData[];
}

export function AgentDashboard({ agents }: Props) {
  // Tier distribution — spec §7 adds INACTIVE for agents that have stopped
  // producing.
  const tierCounts: Record<AgentTier, number> = {
    PLATINUM: agents.filter((a) => a.tier === "PLATINUM").length,
    GOLD:     agents.filter((a) => a.tier === "GOLD").length,
    SILVER:   agents.filter((a) => a.tier === "SILVER").length,
    EMERGING: agents.filter((a) => a.tier === "EMERGING").length,
    INACTIVE: agents.filter((a) => a.tier === "INACTIVE").length,
  };

  const totalAgents = agents.length;

  // Top performers by leads
  const topByLeads = [...agents]
    .sort((a, b) => b.leadCount - a.leadCount)
    .slice(0, 5);

  // Top performers by enrolments
  const topByEnrolments = [...agents]
    .sort((a, b) => b.enrolments - a.enrolments)
    .slice(0, 5);

  // Spec §10 — Visa Approval Rate removed from the Network Performance
  // dashboard because visa information is inconsistently available. The
  // derived column is no longer computed here.

  // Yield rate ranking
  const agentsWithYield = agents
    .filter((a) => a.yieldRate !== null && a.yieldRate > 0)
    .sort((a, b) => (b.yieldRate ?? 0) - (a.yieldRate ?? 0))
    .slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Tier Distribution */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold text-slate-900">
            Agent Tier Distribution
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-4">
            {(
              ["PLATINUM", "GOLD", "SILVER", "EMERGING", "INACTIVE"] as AgentTier[]
            ).map((tier) => {
              const count = tierCounts[tier];
              const pct = totalAgents > 0 ? (count / totalAgents) * 100 : 0;
              return (
                <div
                  key={tier}
                  className="rounded-lg border border-slate-200 p-4 text-center"
                >
                  <Badge
                    variant="outline"
                    className={`mb-2 ${TIER_COLOR[tier]}`}
                  >
                    {tier}
                  </Badge>
                  <p className="text-2xl font-bold text-slate-900">{count}</p>
                  <p className="text-xs text-slate-500">
                    {pct.toFixed(0)}% of total
                  </p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Top Performers Grid */}
      <div className="grid grid-cols-2 gap-4">
        {/* Top by Leads */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-slate-900">
              Top Performers by Leads
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/80">
                  <TableHead>Agent</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">Offers</TableHead>
                  <TableHead className="text-right">Deposits</TableHead>
                  <TableHead className="text-right">Enrolments</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topByLeads.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="text-center text-slate-400 py-6"
                    >
                      No agent data available.
                    </TableCell>
                  </TableRow>
                ) : (
                  topByLeads.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium text-slate-900 text-sm">
                            {a.source.name}
                          </p>
                          <p className="text-xs text-slate-400">
                            {a.source.country}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium text-sm">
                        {a.leadCount}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {a.offers}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {a.deposits}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {a.enrolments}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Top by Enrolments */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-slate-900">
              Top Performers by Enrolments
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/80">
                  <TableHead>Agent</TableHead>
                  <TableHead className="text-right">Enrolments</TableHead>
                  <TableHead>Tier</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topByEnrolments.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={3}
                      className="text-center text-slate-400 py-6"
                    >
                      No agent data available.
                    </TableCell>
                  </TableRow>
                ) : (
                  topByEnrolments.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        <p className="font-medium text-slate-900 text-sm">
                          {a.source.name}
                        </p>
                      </TableCell>
                      <TableCell className="text-right font-medium text-sm">
                        {a.enrolments}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={TIER_COLOR[a.tier]}
                        >
                          {a.tier}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/*
        Spec §10 (Sources / Recruitment Network) — the Visa Approval Rate chart
        was explicitly retired: "Remove Visa Approval Rate from the Network
        Performance dashboard. Reason: Visa information is often incomplete,
        varies by destination country, and may not be consistently available.
        If visa processing is introduced as a future Student module, this
        metric can be reconsidered."

        Kept the block removed rather than commented, so the component's file
        length reflects only fields the spec currently endorses.
      */}

      {/* Yield Rate Ranking */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold text-slate-900">
            Yield Rate Ranking
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/80">
                <TableHead className="w-10">#</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead>Country</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead className="text-right">Yield Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agentsWithYield.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center text-slate-400 py-6"
                  >
                    No yield rate data available.
                  </TableCell>
                </TableRow>
              ) : (
                agentsWithYield.map((a, idx) => (
                  <TableRow key={a.id}>
                    <TableCell className="text-slate-500 font-medium text-sm">
                      {idx + 1}
                    </TableCell>
                    <TableCell className="font-medium text-slate-900 text-sm">
                      {a.source.name}
                    </TableCell>
                    <TableCell className="text-slate-600 text-sm">
                      {a.source.country}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={TIER_COLOR[a.tier]}>
                        {a.tier}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium text-sm">
                      {a.yieldRate?.toFixed(1)}%
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
