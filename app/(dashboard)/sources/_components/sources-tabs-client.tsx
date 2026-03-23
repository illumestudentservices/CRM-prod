"use client";

import * as React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatCard } from "@/components/shared/stat-card";
import { cn } from "@/lib/utils";
import { SourceTable, type SourceRow } from "./source-table";
import { CampaignTable, type CampaignRow } from "./campaign-table";

interface SourceStats {
  total: number;
  agents: number;
  schools: number;
  campaigns: number;
}

interface SourcesTabsClientProps {
  sources: SourceRow[];
  campaigns: CampaignRow[];
  regions: { id: string; name: string }[];
  stats: SourceStats;
}

export function SourcesTabsClient({ sources, campaigns, regions, stats }: SourcesTabsClientProps) {
  const [activeTab, setActiveTab] = React.useState("all");

  const statCards = [
    { title: "Total Sources",   value: stats.total,     icon: "Globe" as const,     iconColor: "text-[#1E3A5F]",  iconBg: "bg-[#1E3A5F]/10", tab: "all" },
    { title: "Active Agents",   value: stats.agents,    icon: "Users" as const,     iconColor: "text-blue-600",   iconBg: "bg-blue-50",      tab: "agents" },
    { title: "Active Schools",  value: stats.schools,   icon: "Building2" as const, iconColor: "text-indigo-600", iconBg: "bg-indigo-50",    tab: "schools" },
    { title: "Total Campaigns", value: stats.campaigns, icon: "Megaphone" as const, iconColor: "text-green-600",  iconBg: "bg-green-50",     tab: "campaigns" },
  ];

  return (
    <div className="space-y-4">
      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <StatCard
            key={card.title}
            title={card.title}
            value={card.value}
            icon={card.icon}
            iconColor={card.iconColor}
            iconBg={card.iconBg}
            className={cn(
              "cursor-pointer transition-all",
              activeTab === card.tab && "ring-2 ring-[#1E3A5F] ring-offset-1"
            )}
            onClick={() => setActiveTab(activeTab === card.tab ? "all" : card.tab)}
          />
        ))}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="bg-white border border-slate-200">
          <TabsTrigger value="all">All Sources</TabsTrigger>
          <TabsTrigger value="agents">Agents</TabsTrigger>
          <TabsTrigger value="schools">Schools</TabsTrigger>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-4">
          <SourceTable sources={sources} filterType={null} regions={regions} />
        </TabsContent>
        <TabsContent value="agents" className="mt-4">
          <SourceTable
            sources={sources.filter((s) => s.type === "AGENT")}
            filterType="AGENT"
            regions={regions}
          />
        </TabsContent>
        <TabsContent value="schools" className="mt-4">
          <SourceTable
            sources={sources.filter((s) => s.type === "SCHOOL")}
            filterType="SCHOOL"
            regions={regions}
          />
        </TabsContent>
        <TabsContent value="campaigns" className="mt-4">
          <CampaignTable campaigns={campaigns} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
