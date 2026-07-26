"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { School, Users, Briefcase, Plus, BarChart3 } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { ExportButton } from "@/components/shared/export-button";
import type { RelationshipStatus, AgentTier } from "@prisma/client";
import { AgentDashboard } from "./agent-dashboard";

const REL_COLOR: Record<string, string> = {
  NEW: "bg-blue-100 text-blue-700",
  DEVELOPING: "bg-cyan-100 text-cyan-700",
  ESTABLISHED: "bg-green-100 text-green-700",
  STRATEGIC: "bg-violet-100 text-violet-700",
  AT_RISK: "bg-red-100 text-red-700",
  DORMANT: "bg-slate-100 text-slate-600",
};

const TIER_COLOR: Record<string, string> = {
  PLATINUM: "bg-violet-100 text-violet-700 border-violet-200",
  GOLD: "bg-amber-100 text-amber-700 border-amber-200",
  SILVER: "bg-slate-100 text-slate-600 border-slate-200",
  EMERGING: "bg-green-100 text-green-700 border-green-200",
};

interface SchoolItem {
  id: string;
  name: string;
  country: string;
  city: string | null;
  type: string;
  relationshipStatus: RelationshipStatus;
  studentVolume: number | null;
  lastVisitDate: Date | string | null;
  relationshipScore: number | null;
  market: { id: string; name: string } | null;
  _count: { counsellors: number; activities: number };
}

interface AgentItem {
  id: string;
  name: string;
  country: string;
  email: string | null;
  phone: string | null;
  rating: number | null;
  agentProfile: {
    id: string;
    tier: AgentTier;
    icefMembership: boolean;
    certificationStatus: string | null;
    offers: number;
    deposits: number;
    enrolments: number;
  } | null;
  _count: { leads: number };
}

interface CounsellorItem {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  position: string | null;
  influenceScore: number | null;
  lastEngagementDate: Date | string | null;
  school: { id: string; name: string; country: string };
}

interface AgentProfileData {
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
  stats: { schools: number; counsellors: number; agents: number };
  schools: SchoolItem[];
  agents: AgentItem[];
  agentProfiles: AgentProfileData[];
}

export function StakeholdersClient({ stats, schools, agents, agentProfiles }: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("schools");
  const [schoolDialogOpen, setSchoolDialogOpen] = useState(false);
  const [agentDialogOpen, setAgentDialogOpen] = useState(false);
  const [counsellorDialogOpen, setCounsellorDialogOpen] = useState(false);
  const [counsellors, setCounsellors] = useState<CounsellorItem[]>([]);
  const [counsellorsLoaded, setCounsellorsLoaded] = useState(false);
  const [loadingCounsellors, setLoadingCounsellors] = useState(false);
  const [saving, setSaving] = useState(false);

  // School form state
  const [schoolForm, setSchoolForm] = useState({
    name: "",
    country: "",
    city: "",
    address: "",
    website: "",
    type: "PUBLIC",
    principalName: "",
    principalEmail: "",
    phone: "",
    relationshipStatus: "NEW",
    studentVolume: "",
    notes: "",
  });

  // Agent form state
  const [agentForm, setAgentForm] = useState({
    sourceId: "",
    certificationStatus: "",
    icefMembership: false,
    tier: "EMERGING",
    countryCoverage: "",
    contractUrl: "",
    notes: "",
  });

  // Counsellor form state
  const [counsellorForm, setCounsellorForm] = useState({
    name: "",
    email: "",
    phone: "",
    position: "",
    influenceScore: "",
    schoolId: "",
  });

  async function loadCounsellors() {
    if (counsellorsLoaded) return;
    setLoadingCounsellors(true);
    try {
      const res = await fetch("/api/stakeholders/counsellors");
      if (res.ok) {
        const data = await res.json();
        setCounsellors(data);
        setCounsellorsLoaded(true);
      }
    } catch {
      // silently fail
    } finally {
      setLoadingCounsellors(false);
    }
  }

  async function handleCreateSchool(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/stakeholders/schools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(schoolForm),
      });
      if (res.ok) {
        setSchoolDialogOpen(false);
        setSchoolForm({
          name: "",
          country: "",
          city: "",
          address: "",
          website: "",
          type: "PUBLIC",
          principalName: "",
          principalEmail: "",
          phone: "",
          relationshipStatus: "NEW",
          studentVolume: "",
          notes: "",
        });
        router.refresh();
      }
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateAgent(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/stakeholders/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...agentForm,
          countryCoverage: agentForm.countryCoverage
            ? agentForm.countryCoverage.split(",").map((c) => c.trim())
            : [],
        }),
      });
      if (res.ok) {
        setAgentDialogOpen(false);
        setAgentForm({
          sourceId: "",
          certificationStatus: "",
          icefMembership: false,
          tier: "EMERGING",
          countryCoverage: "",
          contractUrl: "",
          notes: "",
        });
        router.refresh();
      }
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateCounsellor(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/stakeholders/counsellors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(counsellorForm),
      });
      if (res.ok) {
        setCounsellorDialogOpen(false);
        setCounsellorForm({
          name: "",
          email: "",
          phone: "",
          position: "",
          influenceScore: "",
          schoolId: "",
        });
        setCounsellorsLoaded(false);
        loadCounsellors();
        router.refresh();
      }
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Stat Cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-blue-50 flex items-center justify-center">
              <School className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">
                {stats.schools}
              </p>
              <p className="text-xs text-slate-500">Schools</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-cyan-50 flex items-center justify-center">
              <Users className="h-5 w-5 text-cyan-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">
                {stats.counsellors}
              </p>
              <p className="text-xs text-slate-500">Counsellors</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-amber-50 flex items-center justify-center">
              <Briefcase className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">
                {stats.agents}
              </p>
              <p className="text-xs text-slate-500">Agents</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs
        defaultValue="schools"
        value={activeTab}
        onValueChange={(v) => {
          setActiveTab(v);
          if (v === "counsellors") loadCounsellors();
        }}
      >
        <div className="flex items-center justify-between">
          <TabsList className="bg-white border border-slate-200">
            <TabsTrigger value="schools">
              Schools ({stats.schools})
            </TabsTrigger>
            <TabsTrigger value="agents">Agents ({stats.agents})</TabsTrigger>
            <TabsTrigger value="counsellors">
              Counsellors ({stats.counsellors})
            </TabsTrigger>
            <TabsTrigger value="performance">
              <BarChart3 className="h-3.5 w-3.5 mr-1" />
              Performance
            </TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-2">
            <ExportButton
              exports={[
                {
                  label: "Schools",
                  data: schools.map((s) => ({
                    name: s.name,
                    country: s.country,
                    city: s.city ?? "—",
                    type: s.type,
                    relationshipStatus: s.relationshipStatus.replace(/_/g, " "),
                    studentVolume: s.studentVolume ?? "—",
                    lastVisit: s.lastVisitDate ? formatDate(s.lastVisitDate) : "—",
                    relationshipScore: s.relationshipScore ?? "—",
                    market: s.market?.name ?? "—",
                    counsellors: s._count.counsellors,
                    activities: s._count.activities,
                  })),
                  columns: [
                    { key: "name", header: "Name" },
                    { key: "country", header: "Country" },
                    { key: "city", header: "City" },
                    { key: "type", header: "Type" },
                    { key: "relationshipStatus", header: "Relationship Status" },
                    { key: "studentVolume", header: "Student Volume" },
                    { key: "lastVisit", header: "Last Visit" },
                    { key: "relationshipScore", header: "Relationship Score" },
                    { key: "market", header: "Market" },
                    { key: "counsellors", header: "Counsellors" },
                    { key: "activities", header: "Activities" },
                  ],
                  filename: "schools",
                },
                {
                  label: "Agents",
                  data: agents.map((a) => ({
                    name: a.name,
                    country: a.country,
                    email: a.email ?? "—",
                    phone: a.phone ?? "—",
                    tier: a.agentProfile?.tier ?? "—",
                    leads: a._count.leads,
                    rating: a.rating ?? "—",
                    icefMembership: a.agentProfile?.icefMembership ? "Yes" : "No",
                  })),
                  columns: [
                    { key: "name", header: "Name" },
                    { key: "country", header: "Country" },
                    { key: "email", header: "Email" },
                    { key: "phone", header: "Phone" },
                    { key: "tier", header: "Tier" },
                    { key: "leads", header: "Leads" },
                    { key: "rating", header: "Rating" },
                    { key: "icefMembership", header: "ICEF Membership" },
                  ],
                  filename: "agents",
                },
              ]}
              title="Export Stakeholders"
            />
            {activeTab === "schools" && (
              <Dialog
                open={schoolDialogOpen}
                onOpenChange={setSchoolDialogOpen}
              >
                <DialogTrigger asChild>
                  <Button size="sm" className="gap-1.5">
                    <Plus className="h-4 w-4" />
                    Add School
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Add School</DialogTitle>
                  </DialogHeader>
                  <form
                    onSubmit={handleCreateSchool}
                    className="space-y-4 pt-2"
                  >
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="school-name">
                          Name <span className="text-red-500">*</span>
                        </Label>
                        <Input
                          id="school-name"
                          value={schoolForm.name}
                          onChange={(e) =>
                            setSchoolForm({ ...schoolForm, name: e.target.value })
                          }
                          required
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="school-country">
                          Country <span className="text-red-500">*</span>
                        </Label>
                        <Input
                          id="school-country"
                          value={schoolForm.country}
                          onChange={(e) =>
                            setSchoolForm({
                              ...schoolForm,
                              country: e.target.value,
                            })
                          }
                          required
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="school-city">City</Label>
                        <Input
                          id="school-city"
                          value={schoolForm.city}
                          onChange={(e) =>
                            setSchoolForm({ ...schoolForm, city: e.target.value })
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="school-type">Type</Label>
                        <Select
                          value={schoolForm.type}
                          onValueChange={(v) =>
                            setSchoolForm({ ...schoolForm, type: v })
                          }
                        >
                          <SelectTrigger id="school-type">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="PUBLIC">Public</SelectItem>
                            <SelectItem value="PRIVATE">Private</SelectItem>
                            <SelectItem value="INTERNATIONAL">
                              International
                            </SelectItem>
                            <SelectItem value="BOARDING">Boarding</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="school-address">Address</Label>
                      <Input
                        id="school-address"
                        value={schoolForm.address}
                        onChange={(e) =>
                          setSchoolForm({
                            ...schoolForm,
                            address: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="school-website">Website</Label>
                        <Input
                          id="school-website"
                          value={schoolForm.website}
                          onChange={(e) =>
                            setSchoolForm({
                              ...schoolForm,
                              website: e.target.value,
                            })
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="school-phone">Phone</Label>
                        <Input
                          id="school-phone"
                          value={schoolForm.phone}
                          onChange={(e) =>
                            setSchoolForm({
                              ...schoolForm,
                              phone: e.target.value,
                            })
                          }
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="school-principal">Principal Name</Label>
                        <Input
                          id="school-principal"
                          value={schoolForm.principalName}
                          onChange={(e) =>
                            setSchoolForm({
                              ...schoolForm,
                              principalName: e.target.value,
                            })
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="school-principal-email">
                          Principal Email
                        </Label>
                        <Input
                          id="school-principal-email"
                          type="email"
                          value={schoolForm.principalEmail}
                          onChange={(e) =>
                            setSchoolForm({
                              ...schoolForm,
                              principalEmail: e.target.value,
                            })
                          }
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="school-status">
                          Relationship Status
                        </Label>
                        <Select
                          value={schoolForm.relationshipStatus}
                          onValueChange={(v) =>
                            setSchoolForm({
                              ...schoolForm,
                              relationshipStatus: v,
                            })
                          }
                        >
                          <SelectTrigger id="school-status">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="NEW">New</SelectItem>
                            <SelectItem value="DEVELOPING">
                              Developing
                            </SelectItem>
                            <SelectItem value="ESTABLISHED">
                              Established
                            </SelectItem>
                            <SelectItem value="STRATEGIC">Strategic</SelectItem>
                            <SelectItem value="AT_RISK">At Risk</SelectItem>
                            <SelectItem value="DORMANT">Dormant</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="school-volume">Student Volume</Label>
                        <Input
                          id="school-volume"
                          type="number"
                          value={schoolForm.studentVolume}
                          onChange={(e) =>
                            setSchoolForm({
                              ...schoolForm,
                              studentVolume: e.target.value,
                            })
                          }
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="school-notes">Notes</Label>
                      <Textarea
                        id="school-notes"
                        value={schoolForm.notes}
                        onChange={(e) =>
                          setSchoolForm({
                            ...schoolForm,
                            notes: e.target.value,
                          })
                        }
                        rows={2}
                      />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setSchoolDialogOpen(false)}
                      >
                        Cancel
                      </Button>
                      <Button type="submit" disabled={saving}>
                        {saving ? "Creating..." : "Create School"}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            )}
            {activeTab === "agents" && (
              <Dialog
                open={agentDialogOpen}
                onOpenChange={setAgentDialogOpen}
              >
                <DialogTrigger asChild>
                  <Button size="sm" className="gap-1.5">
                    <Plus className="h-4 w-4" />
                    Add Agent
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Add Agent Profile</DialogTitle>
                  </DialogHeader>
                  <form
                    onSubmit={handleCreateAgent}
                    className="space-y-4 pt-2"
                  >
                    <div className="space-y-1.5">
                      <Label htmlFor="agent-sourceId">
                        Source ID <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="agent-sourceId"
                        placeholder="Enter the source UUID"
                        value={agentForm.sourceId}
                        onChange={(e) =>
                          setAgentForm({
                            ...agentForm,
                            sourceId: e.target.value,
                          })
                        }
                        required
                      />
                      <p className="text-xs text-slate-400">
                        The ID of the agent source from Sources module.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="agent-tier">Tier</Label>
                        <Select
                          value={agentForm.tier}
                          onValueChange={(v) =>
                            setAgentForm({ ...agentForm, tier: v })
                          }
                        >
                          <SelectTrigger id="agent-tier">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="PLATINUM">Platinum</SelectItem>
                            <SelectItem value="GOLD">Gold</SelectItem>
                            <SelectItem value="SILVER">Silver</SelectItem>
                            <SelectItem value="EMERGING">Emerging</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="agent-cert">
                          Certification Status
                        </Label>
                        <Input
                          id="agent-cert"
                          value={agentForm.certificationStatus}
                          onChange={(e) =>
                            setAgentForm({
                              ...agentForm,
                              certificationStatus: e.target.value,
                            })
                          }
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="agent-coverage">
                        Country Coverage
                      </Label>
                      <Input
                        id="agent-coverage"
                        placeholder="e.g. India, Nepal, Bangladesh"
                        value={agentForm.countryCoverage}
                        onChange={(e) =>
                          setAgentForm({
                            ...agentForm,
                            countryCoverage: e.target.value,
                          })
                        }
                      />
                      <p className="text-xs text-slate-400">
                        Comma-separated list of countries.
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="agent-contract">Contract URL</Label>
                      <Input
                        id="agent-contract"
                        value={agentForm.contractUrl}
                        onChange={(e) =>
                          setAgentForm({
                            ...agentForm,
                            contractUrl: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="agent-notes">Notes</Label>
                      <Textarea
                        id="agent-notes"
                        value={agentForm.notes}
                        onChange={(e) =>
                          setAgentForm({
                            ...agentForm,
                            notes: e.target.value,
                          })
                        }
                        rows={2}
                      />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setAgentDialogOpen(false)}
                      >
                        Cancel
                      </Button>
                      <Button type="submit" disabled={saving}>
                        {saving ? "Creating..." : "Create Agent Profile"}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            )}
            {activeTab === "counsellors" && (
              <Dialog
                open={counsellorDialogOpen}
                onOpenChange={setCounsellorDialogOpen}
              >
                <DialogTrigger asChild>
                  <Button size="sm" className="gap-1.5">
                    <Plus className="h-4 w-4" />
                    Add Counsellor
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Add Counsellor</DialogTitle>
                  </DialogHeader>
                  <form
                    onSubmit={handleCreateCounsellor}
                    className="space-y-4 pt-2"
                  >
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="counsellor-name">
                          Name <span className="text-red-500">*</span>
                        </Label>
                        <Input
                          id="counsellor-name"
                          value={counsellorForm.name}
                          onChange={(e) =>
                            setCounsellorForm({
                              ...counsellorForm,
                              name: e.target.value,
                            })
                          }
                          required
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="counsellor-email">Email</Label>
                        <Input
                          id="counsellor-email"
                          type="email"
                          value={counsellorForm.email}
                          onChange={(e) =>
                            setCounsellorForm({
                              ...counsellorForm,
                              email: e.target.value,
                            })
                          }
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="counsellor-phone">Phone</Label>
                        <Input
                          id="counsellor-phone"
                          value={counsellorForm.phone}
                          onChange={(e) =>
                            setCounsellorForm({
                              ...counsellorForm,
                              phone: e.target.value,
                            })
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="counsellor-position">Position</Label>
                        <Input
                          id="counsellor-position"
                          value={counsellorForm.position}
                          onChange={(e) =>
                            setCounsellorForm({
                              ...counsellorForm,
                              position: e.target.value,
                            })
                          }
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="counsellor-influence">
                          Influence Score
                        </Label>
                        <Input
                          id="counsellor-influence"
                          type="number"
                          min="0"
                          max="100"
                          value={counsellorForm.influenceScore}
                          onChange={(e) =>
                            setCounsellorForm({
                              ...counsellorForm,
                              influenceScore: e.target.value,
                            })
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="counsellor-school">
                          School <span className="text-red-500">*</span>
                        </Label>
                        <Select
                          value={counsellorForm.schoolId}
                          onValueChange={(v) =>
                            setCounsellorForm({
                              ...counsellorForm,
                              schoolId: v,
                            })
                          }
                        >
                          <SelectTrigger id="counsellor-school">
                            <SelectValue placeholder="Select school" />
                          </SelectTrigger>
                          <SelectContent>
                            {schools.map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setCounsellorDialogOpen(false)}
                      >
                        Cancel
                      </Button>
                      <Button type="submit" disabled={saving}>
                        {saving ? "Creating..." : "Create Counsellor"}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>

        {/* Schools Tab */}
        <TabsContent value="schools" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80">
                    <TableHead>School</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Market</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-center">Counsellors</TableHead>
                    <TableHead className="text-center">Activities</TableHead>
                    <TableHead>Last Visit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schools.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="text-center text-slate-400 py-8"
                      >
                        No schools added yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    schools.map((s) => (
                      <TableRow
                        key={s.id}
                        className="cursor-pointer hover:bg-slate-50"
                        onClick={() =>
                          router.push(`/stakeholders?schoolId=${s.id}`)
                        }
                      >
                        <TableCell>
                          <div>
                            <p className="font-medium text-slate-900">
                              {s.name}
                            </p>
                            <p className="text-xs text-slate-400">{s.type}</p>
                          </div>
                        </TableCell>
                        <TableCell className="text-slate-600 text-sm">
                          {[s.city, s.country].filter(Boolean).join(", ")}
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">
                          {s.market?.name ?? "—"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              REL_COLOR[s.relationshipStatus] ?? ""
                            }
                          >
                            {s.relationshipStatus.replace(/_/g, " ")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center text-sm">
                          {s._count.counsellors}
                        </TableCell>
                        <TableCell className="text-center text-sm">
                          {s._count.activities}
                        </TableCell>
                        <TableCell className="text-sm text-slate-500">
                          {s.lastVisitDate
                            ? formatDate(s.lastVisitDate)
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Agents Tab */}
        <TabsContent value="agents" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80">
                    <TableHead>Agent</TableHead>
                    <TableHead>Country</TableHead>
                    <TableHead>Tier</TableHead>
                    <TableHead>ICEF</TableHead>
                    <TableHead className="text-center">Leads</TableHead>
                    <TableHead>Contact</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agents.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="text-center text-slate-400 py-8"
                      >
                        No agents found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    agents.map((a) => (
                      <TableRow
                        key={a.id}
                        className="cursor-pointer hover:bg-slate-50"
                        onClick={() =>
                          router.push(
                            `/stakeholders?agentId=${a.agentProfile?.id ?? a.id}`
                          )
                        }
                      >
                        <TableCell className="font-medium text-slate-900">
                          {a.name}
                        </TableCell>
                        <TableCell className="text-slate-600 text-sm">
                          {a.country}
                        </TableCell>
                        <TableCell>
                          {a.agentProfile ? (
                            <Badge
                              variant="outline"
                              className={
                                TIER_COLOR[a.agentProfile.tier] ?? ""
                              }
                            >
                              {a.agentProfile.tier}
                            </Badge>
                          ) : (
                            <span className="text-xs text-slate-400">
                              {"—"}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {a.agentProfile?.icefMembership ? (
                            <Badge
                              variant="outline"
                              className="bg-green-50 text-green-700 border-green-200 text-xs"
                            >
                              ICEF
                            </Badge>
                          ) : (
                            <span className="text-xs text-slate-400">No</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center text-sm">
                          {a._count.leads}
                        </TableCell>
                        <TableCell className="text-sm text-slate-500">
                          {a.email ?? a.phone ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Performance Tab */}
        <TabsContent value="performance" className="mt-4">
          <AgentDashboard agents={agentProfiles} />
        </TabsContent>

        {/* Counsellors Tab */}
        <TabsContent value="counsellors" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80">
                    <TableHead>Name</TableHead>
                    <TableHead>School</TableHead>
                    <TableHead>Position</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead className="text-center">
                      Influence Score
                    </TableHead>
                    <TableHead>Last Engagement</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingCounsellors ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="text-center text-slate-400 py-8"
                      >
                        Loading counsellors...
                      </TableCell>
                    </TableRow>
                  ) : counsellors.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="text-center text-slate-400 py-8"
                      >
                        No counsellors found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    counsellors.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium text-slate-900">
                          {c.name}
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="text-sm text-slate-700">
                              {c.school.name}
                            </p>
                            <p className="text-xs text-slate-400">
                              {c.school.country}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">
                          {c.position ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm text-slate-500">
                          {c.email ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm text-slate-500">
                          {c.phone ?? "—"}
                        </TableCell>
                        <TableCell className="text-center">
                          {c.influenceScore !== null ? (
                            <Badge
                              variant="outline"
                              className={
                                c.influenceScore >= 80
                                  ? "bg-green-50 text-green-700 border-green-200"
                                  : c.influenceScore >= 50
                                    ? "bg-amber-50 text-amber-700 border-amber-200"
                                    : "bg-slate-50 text-slate-600 border-slate-200"
                              }
                            >
                              {c.influenceScore}
                            </Badge>
                          ) : (
                            <span className="text-xs text-slate-400">
                              {"—"}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-slate-500">
                          {c.lastEngagementDate
                            ? formatDate(c.lastEngagementDate)
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
