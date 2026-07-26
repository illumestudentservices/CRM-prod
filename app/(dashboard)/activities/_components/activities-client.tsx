"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getInitials, formatDate } from "@/lib/utils";
import {
  ClipboardList, CalendarDays, School, Handshake, Users, Flag,
  Plus, Trash2, Loader2,
} from "lucide-react";
import { ExportButton } from "@/components/shared/export-button";
import type { ActivityType } from "@prisma/client";

// ─── Type configuration ──────────────────────────────────────────────────────

const TYPE_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  SCHOOL_VISIT: { label: "School Visit", color: "bg-blue-100 text-blue-700", icon: School },
  AGENT_MEETING: { label: "Agent Meeting", color: "bg-amber-100 text-amber-700", icon: Handshake },
  STUDENT_EVENT: { label: "Student Event", color: "bg-cyan-100 text-cyan-700", icon: Users },
  FAIR: { label: "Fair", color: "bg-violet-100 text-violet-700", icon: Flag },
  PARTNER_MEETING: { label: "Partner Meeting", color: "bg-green-100 text-green-700", icon: Handshake },
};

const ACTIVITY_TYPES = [
  { value: "SCHOOL_VISIT", label: "School Visit" },
  { value: "AGENT_MEETING", label: "Agent Meeting" },
  { value: "STUDENT_EVENT", label: "Student Event" },
  { value: "FAIR", label: "Fair" },
  { value: "PARTNER_MEETING", label: "Partner Meeting" },
] as const;

// ─── Types ───────────────────────────────────────────────────────────────────

interface ActivityItem {
  id: string;
  type: ActivityType;
  title: string;
  date: Date | string;
  city: string | null;
  country: string | null;
  studentsEngaged: number | null;
  leadsGenerated: number | null;
  cost: number | null;
  outcomes: string | null;
  user: { id: string; name: string | null; image: string | null };
  institution: { id: string; name: string } | null;
  market: { id: string; name: string } | null;
  school: { id: string; name: string } | null;
  _count: { attendees: number };
}

interface Stats {
  total: number;
  thisMonth: number;
  byType: Array<{ type: string; count: number }>;
}

interface ActionItem {
  title: string;
  assignee: string;
  dueDate: string;
  completed: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ActivitiesClient({ activities, stats }: { activities: ActivityItem[]; stats: Stats }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [type, setType] = useState<string>("SCHOOL_VISIT");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [description, setDescription] = useState("");
  const [institutionId, setInstitutionId] = useState("");
  const [location, setLocation] = useState("");

  // Type-specific fields
  const [schoolId, setSchoolId] = useState("");
  const [studentsEngaged, setStudentsEngaged] = useState("");
  const [counsellorsEngaged, setCounsellorsEngaged] = useState("");
  const [outcomes, setOutcomes] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [topics, setTopics] = useState("");
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [leadsGenerated, setLeadsGenerated] = useState("");
  const [applicationsGenerated, setApplicationsGenerated] = useState("");
  const [cost, setCost] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [stakeholderName, setStakeholderName] = useState("");

  function resetForm() {
    setType("SCHOOL_VISIT");
    setTitle("");
    setDate("");
    setCity("");
    setCountry("");
    setDescription("");
    setInstitutionId("");
    setLocation("");
    setSchoolId("");
    setStudentsEngaged("");
    setCounsellorsEngaged("");
    setOutcomes("");
    setSourceId("");
    setTopics("");
    setActionItems([]);
    setLeadsGenerated("");
    setApplicationsGenerated("");
    setCost("");
    setFollowUp("");
    setStakeholderName("");
  }

  function addActionItem() {
    setActionItems((prev) => [...prev, { title: "", assignee: "", dueDate: "", completed: false }]);
  }

  function removeActionItem(index: number) {
    setActionItems((prev) => prev.filter((_, i) => i !== index));
  }

  function updateActionItem(index: number, field: keyof ActionItem, value: string | boolean) {
    setActionItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  }

  // Compute ROI for fairs
  const computedRoi = (() => {
    if (type !== "FAIR") return null;
    const c = parseFloat(cost);
    const l = parseInt(leadsGenerated, 10);
    if (!c || c <= 0 || !l || l <= 0) return null;
    return (l / c).toFixed(4);
  })();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    // Build description for PARTNER_MEETING (prepend stakeholder + objective)
    let finalDescription = description;
    if (type === "PARTNER_MEETING" && stakeholderName) {
      finalDescription = `Stakeholder: ${stakeholderName}\n${description}`;
    }

    const payload: Record<string, unknown> = {
      type,
      title,
      date,
      city: city || null,
      country: country || null,
      description: finalDescription || null,
      institutionId: institutionId || null,
      location: location || null,
    };

    // Type-specific payload
    if (type === "SCHOOL_VISIT") {
      payload.schoolId = schoolId || null;
      payload.studentsEngaged = studentsEngaged ? parseInt(studentsEngaged, 10) : null;
      payload.counsellorsEngaged = counsellorsEngaged ? parseInt(counsellorsEngaged, 10) : null;
      payload.outcomes = outcomes || null;
    }

    if (type === "AGENT_MEETING") {
      payload.sourceId = sourceId || null;
      payload.topics = topics || null;
      payload.outcomes = outcomes || null;
      if (actionItems.length > 0) {
        payload.actionItems = actionItems.filter((ai) => ai.title.trim() !== "");
      }
    }

    if (type === "STUDENT_EVENT") {
      payload.leadsGenerated = leadsGenerated ? parseInt(leadsGenerated, 10) : null;
      payload.applicationsGenerated = applicationsGenerated ? parseInt(applicationsGenerated, 10) : null;
    }

    if (type === "FAIR") {
      payload.cost = cost ? parseFloat(cost) : null;
      payload.leadsGenerated = leadsGenerated ? parseInt(leadsGenerated, 10) : null;
      payload.applicationsGenerated = applicationsGenerated ? parseInt(applicationsGenerated, 10) : null;
    }

    if (type === "PARTNER_MEETING") {
      payload.outcomes = outcomes || null;
      payload.followUp = followUp || null;
    }

    try {
      const res = await fetch("/api/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error("Failed to create activity:", err);
        return;
      }

      resetForm();
      setOpen(false);
      router.refresh();
    } catch (err) {
      console.error("Failed to create activity:", err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-slate-100 flex items-center justify-center">
              <ClipboardList className="h-5 w-5 text-slate-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{stats.total}</p>
              <p className="text-xs text-slate-500">Total Activities</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-cyan-50 flex items-center justify-center">
              <CalendarDays className="h-5 w-5 text-cyan-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{stats.thisMonth}</p>
              <p className="text-xs text-slate-500">This Month</p>
            </div>
          </CardContent>
        </Card>
        {stats.byType.slice(0, 2).map((bt) => {
          const cfg = TYPE_CONFIG[bt.type];
          return (
            <Card key={bt.type}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-slate-50 flex items-center justify-center">
                  {cfg && <cfg.icon className="h-5 w-5 text-slate-500" />}
                </div>
                <div>
                  <p className="text-2xl font-bold text-slate-900">{bt.count}</p>
                  <p className="text-xs text-slate-500">{cfg?.label ?? bt.type}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Log Activity button + table */}
      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-900">Recent Activities</h3>
              <ExportButton
                data={activities.map((a) => ({
                  type: TYPE_CONFIG[a.type]?.label ?? a.type,
                  title: a.title,
                  date: formatDate(a.date),
                  user: a.user.name ?? "—",
                  city: a.city ?? "—",
                  country: a.country ?? "—",
                  institution: a.institution?.name ?? "—",
                  market: a.market?.name ?? "—",
                  school: a.school?.name ?? "—",
                  studentsEngaged: a.studentsEngaged ?? "—",
                  leadsGenerated: a.leadsGenerated ?? "—",
                  cost: a.cost ?? "—",
                  attendees: a._count.attendees,
                }))}
                columns={[
                  { key: "type", header: "Type" },
                  { key: "title", header: "Title" },
                  { key: "date", header: "Date" },
                  { key: "user", header: "User" },
                  { key: "city", header: "City" },
                  { key: "country", header: "Country" },
                  { key: "institution", header: "Institution" },
                  { key: "market", header: "Market" },
                  { key: "school", header: "School" },
                  { key: "studentsEngaged", header: "Students Engaged" },
                  { key: "leadsGenerated", header: "Leads Generated" },
                  { key: "cost", header: "Cost" },
                  { key: "attendees", header: "Attendees" },
                ]}
                filename="activities"
                title="Activities"
              />
            </div>
            <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5">
                  <Plus className="h-4 w-4" />
                  Log Activity
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="text-slate-900">Log New Activity</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-5 pt-2">
                  {/* Activity Type Selector */}
                  <div className="space-y-1.5">
                    <Label className="text-slate-700">Activity Type</Label>
                    <Select value={type} onValueChange={setType}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        {ACTIVITY_TYPES.map((t) => (
                          <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Common fields */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-slate-700">Title *</Label>
                      <Input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="Activity title"
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-slate-700">Date *</Label>
                      <Input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-slate-700">City</Label>
                      <Input
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                        placeholder="City"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-slate-700">Country</Label>
                      <Input
                        value={country}
                        onChange={(e) => setCountry(e.target.value)}
                        placeholder="Country"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-slate-700">Location / Venue</Label>
                      <Input
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        placeholder="Venue or address"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-slate-700">Institution ID</Label>
                      <Input
                        value={institutionId}
                        onChange={(e) => setInstitutionId(e.target.value)}
                        placeholder="Institution ID (optional)"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-slate-700">Description</Label>
                    <Textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder={type === "PARTNER_MEETING" ? "Objective / meeting agenda" : "Activity description"}
                      rows={3}
                    />
                  </div>

                  {/* ──── SCHOOL_VISIT fields ──── */}
                  {type === "SCHOOL_VISIT" && (
                    <div className="space-y-4 rounded-lg border border-blue-100 bg-blue-50/30 p-4">
                      <p className="text-sm font-medium text-blue-700">School Visit Details</p>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="space-y-1.5">
                          <Label className="text-slate-700">School ID</Label>
                          <Input
                            value={schoolId}
                            onChange={(e) => setSchoolId(e.target.value)}
                            placeholder="School ID"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-slate-700">Students Engaged</Label>
                          <Input
                            type="number"
                            min={0}
                            value={studentsEngaged}
                            onChange={(e) => setStudentsEngaged(e.target.value)}
                            placeholder="0"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-slate-700">Counsellors Engaged</Label>
                          <Input
                            type="number"
                            min={0}
                            value={counsellorsEngaged}
                            onChange={(e) => setCounsellorsEngaged(e.target.value)}
                            placeholder="0"
                          />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-slate-700">Outcomes</Label>
                        <Textarea
                          value={outcomes}
                          onChange={(e) => setOutcomes(e.target.value)}
                          placeholder="Key outcomes from the visit"
                          rows={2}
                        />
                      </div>
                    </div>
                  )}

                  {/* ──── AGENT_MEETING fields ──── */}
                  {type === "AGENT_MEETING" && (
                    <div className="space-y-4 rounded-lg border border-amber-100 bg-amber-50/30 p-4">
                      <p className="text-sm font-medium text-amber-700">Agent Meeting Details</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label className="text-slate-700">Source / Agent ID</Label>
                          <Input
                            value={sourceId}
                            onChange={(e) => setSourceId(e.target.value)}
                            placeholder="Source ID"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-slate-700">Topics Discussed</Label>
                          <Input
                            value={topics}
                            onChange={(e) => setTopics(e.target.value)}
                            placeholder="Commission, marketing, etc."
                          />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-slate-700">Outcomes</Label>
                        <Textarea
                          value={outcomes}
                          onChange={(e) => setOutcomes(e.target.value)}
                          placeholder="Meeting outcomes"
                          rows={2}
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-slate-700">Action Items</Label>
                          <Button type="button" variant="outline" size="sm" onClick={addActionItem} className="gap-1">
                            <Plus className="h-3 w-3" /> Add
                          </Button>
                        </div>
                        {actionItems.map((item, idx) => (
                          <div key={idx} className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-end">
                            <div className="space-y-1">
                              <Label className="text-xs text-slate-500">Task</Label>
                              <Input
                                value={item.title}
                                onChange={(e) => updateActionItem(idx, "title", e.target.value)}
                                placeholder="Action item"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs text-slate-500">Assignee</Label>
                              <Input
                                value={item.assignee}
                                onChange={(e) => updateActionItem(idx, "assignee", e.target.value)}
                                placeholder="Who"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs text-slate-500">Due</Label>
                              <Input
                                type="date"
                                value={item.dueDate}
                                onChange={(e) => updateActionItem(idx, "dueDate", e.target.value)}
                              />
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeActionItem(idx)}
                              className="text-red-500 hover:text-red-700 mb-0.5"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ──── STUDENT_EVENT fields ──── */}
                  {type === "STUDENT_EVENT" && (
                    <div className="space-y-4 rounded-lg border border-cyan-100 bg-cyan-50/30 p-4">
                      <p className="text-sm font-medium text-cyan-700">Student Event Details</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label className="text-slate-700">Leads Generated</Label>
                          <Input
                            type="number"
                            min={0}
                            value={leadsGenerated}
                            onChange={(e) => setLeadsGenerated(e.target.value)}
                            placeholder="0"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-slate-700">Applications Generated</Label>
                          <Input
                            type="number"
                            min={0}
                            value={applicationsGenerated}
                            onChange={(e) => setApplicationsGenerated(e.target.value)}
                            placeholder="0"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ──── FAIR fields ──── */}
                  {type === "FAIR" && (
                    <div className="space-y-4 rounded-lg border border-violet-100 bg-violet-50/30 p-4">
                      <p className="text-sm font-medium text-violet-700">Fair Details</p>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="space-y-1.5">
                          <Label className="text-slate-700">Cost ($)</Label>
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={cost}
                            onChange={(e) => setCost(e.target.value)}
                            placeholder="0.00"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-slate-700">Leads Generated</Label>
                          <Input
                            type="number"
                            min={0}
                            value={leadsGenerated}
                            onChange={(e) => setLeadsGenerated(e.target.value)}
                            placeholder="0"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-slate-700">Applications Generated</Label>
                          <Input
                            type="number"
                            min={0}
                            value={applicationsGenerated}
                            onChange={(e) => setApplicationsGenerated(e.target.value)}
                            placeholder="0"
                          />
                        </div>
                      </div>
                      {computedRoi && (
                        <div className="rounded-md bg-violet-100 px-3 py-2">
                          <p className="text-sm text-violet-800">
                            Estimated ROI: <span className="font-semibold">{computedRoi}</span> leads per dollar
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ──── PARTNER_MEETING fields ──── */}
                  {type === "PARTNER_MEETING" && (
                    <div className="space-y-4 rounded-lg border border-green-100 bg-green-50/30 p-4">
                      <p className="text-sm font-medium text-green-700">Partner Meeting Details</p>
                      <div className="space-y-1.5">
                        <Label className="text-slate-700">Stakeholder Name</Label>
                        <Input
                          value={stakeholderName}
                          onChange={(e) => setStakeholderName(e.target.value)}
                          placeholder="Partner / stakeholder name"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-slate-700">Outcomes</Label>
                        <Textarea
                          value={outcomes}
                          onChange={(e) => setOutcomes(e.target.value)}
                          placeholder="Meeting outcomes and agreements"
                          rows={2}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-slate-700">Follow-up</Label>
                        <Textarea
                          value={followUp}
                          onChange={(e) => setFollowUp(e.target.value)}
                          placeholder="Next steps and follow-up actions"
                          rows={2}
                        />
                      </div>
                    </div>
                  )}

                  {/* Submit */}
                  <div className="flex justify-end gap-2 pt-2">
                    <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={saving || !title || !date}>
                      {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {saving ? "Saving..." : "Log Activity"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/80">
                <TableHead>Activity</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>By</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Location</TableHead>
                <TableHead className="text-center">Attendees</TableHead>
                <TableHead className="text-center">Leads</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activities.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-slate-400 py-8">
                    No activities recorded yet.
                  </TableCell>
                </TableRow>
              ) : (
                activities.map((a) => {
                  const cfg = TYPE_CONFIG[a.type];
                  return (
                    <TableRow key={a.id}>
                      <TableCell>
                        <p className="font-medium text-slate-900 text-sm">{a.title}</p>
                        {a.school && (
                          <p className="text-xs text-slate-400">{a.school.name}</p>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cfg?.color ?? ""}>
                          {cfg?.label ?? a.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">{formatDate(a.date)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="h-6 w-6">
                            <AvatarFallback className="bg-slate-200 text-slate-600 text-[10px]">
                              {getInitials(a.user.name)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-sm text-slate-600">{a.user.name ?? "—"}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        {a.institution?.name ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm text-slate-500">
                        {[a.city, a.country].filter(Boolean).join(", ") || "—"}
                      </TableCell>
                      <TableCell className="text-center text-sm">{a._count.attendees}</TableCell>
                      <TableCell className="text-center text-sm">{a.leadsGenerated ?? "—"}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
