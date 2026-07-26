"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Button } from "@/components/ui/button";
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
import { Separator } from "@/components/ui/separator";
import { StatCard } from "@/components/shared/stat-card";
import { formatDate } from "@/lib/utils";
import { Plus, Trash2, Plane, Hotel, Car, Package } from "lucide-react";
import { ExportButton } from "@/components/shared/export-button";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TravelItineraryItem {
  id: string;
  type: string;
  description: string;
  departureLocation?: string | null;
  arrivalLocation?: string | null;
  date: string;
  cost?: number | null;
  confirmationRef?: string | null;
  notes?: string | null;
}

interface TravelMeetingItem {
  id: string;
  title: string;
  location?: string | null;
  date: string;
  notes?: string | null;
  activityId?: string | null;
}

interface TravelRequest {
  id: string;
  destination: string;
  purpose: string;
  departDate: string;
  returnDate: string;
  estimatedCost?: number | null;
  actualCost?: number | null;
  status: string;
  notes?: string | null;
  createdAt: string;
  employee: {
    id: string;
    user: { id: string; name: string | null; image?: string | null };
  };
  itineraryItems: TravelItineraryItem[];
  travelMeetings: TravelMeetingItem[];
}

interface TravelStats {
  totalTrips: number;
  totalCost: number;
  averageCostPerTrip: number;
  schoolsVisited: number;
  agentsVisited: number;
}

interface EmployeeOption {
  id: string;
  name: string;
}

interface TravelClientProps {
  travelRequests: TravelRequest[];
  stats: TravelStats;
  employees: EmployeeOption[];
}

// ─── Status Badge Styles ──────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800 hover:bg-amber-100",
  APPROVED: "bg-green-100 text-green-800 hover:bg-green-100",
  REJECTED: "bg-red-100 text-red-800 hover:bg-red-100",
  COMPLETED: "bg-blue-100 text-blue-800 hover:bg-blue-100",
};

const ITEM_TYPE_ICONS: Record<string, React.ElementType> = {
  FLIGHT: Plane,
  HOTEL: Hotel,
  TRANSFER: Car,
  OTHER_TRAVEL: Package,
};

// ─── New Itinerary/Meeting Item Templates ─────────────────────────────────────

interface NewItineraryItem {
  type: string;
  description: string;
  departureLocation: string;
  arrivalLocation: string;
  date: string;
  cost: string;
  confirmationRef: string;
  notes: string;
}

interface NewMeetingItem {
  title: string;
  location: string;
  date: string;
  notes: string;
}

const emptyItinerary = (): NewItineraryItem => ({
  type: "FLIGHT",
  description: "",
  departureLocation: "",
  arrivalLocation: "",
  date: "",
  cost: "",
  confirmationRef: "",
  notes: "",
});

const emptyMeeting = (): NewMeetingItem => ({
  title: "",
  location: "",
  date: "",
  notes: "",
});

// ─── Component ────────────────────────────────────────────────────────────────

export function TravelClient({
  travelRequests,
  stats,
  employees,
}: TravelClientProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = React.useState("plans");
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  // Form state
  const [employeeId, setEmployeeId] = React.useState("");
  const [destination, setDestination] = React.useState("");
  const [purpose, setPurpose] = React.useState("");
  const [departDate, setDepartDate] = React.useState("");
  const [returnDate, setReturnDate] = React.useState("");
  const [estimatedCost, setEstimatedCost] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [itineraryItems, setItineraryItems] = React.useState<NewItineraryItem[]>([]);
  const [meetingItems, setMeetingItems] = React.useState<NewMeetingItem[]>([]);

  function resetForm() {
    setEmployeeId("");
    setDestination("");
    setPurpose("");
    setDepartDate("");
    setReturnDate("");
    setEstimatedCost("");
    setNotes("");
    setItineraryItems([]);
    setMeetingItems([]);
  }

  async function handleCreate() {
    if (!employeeId || !destination || !purpose || !departDate || !returnDate) return;

    setSubmitting(true);
    try {
      const payload = {
        employeeId,
        destination,
        purpose,
        departDate,
        returnDate,
        estimatedCost: estimatedCost ? parseFloat(estimatedCost) : undefined,
        notes: notes || undefined,
        itineraryItems: itineraryItems
          .filter((item) => item.description)
          .map((item) => ({
            type: item.type,
            description: item.description,
            departureLocation: item.departureLocation || undefined,
            arrivalLocation: item.arrivalLocation || undefined,
            date: item.date,
            cost: item.cost ? parseFloat(item.cost) : undefined,
            confirmationRef: item.confirmationRef || undefined,
            notes: item.notes || undefined,
          })),
        travelMeetings: meetingItems
          .filter((m) => m.title)
          .map((m) => ({
            title: m.title,
            location: m.location || undefined,
            date: m.date,
            notes: m.notes || undefined,
          })),
      };

      const res = await fetch("/api/travel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setDialogOpen(false);
        resetForm();
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Itinerary helpers
  function addItineraryItem() {
    setItineraryItems((prev) => [...prev, emptyItinerary()]);
  }

  function removeItineraryItem(index: number) {
    setItineraryItems((prev) => prev.filter((_, i) => i !== index));
  }

  function updateItineraryItem(index: number, field: keyof NewItineraryItem, value: string) {
    setItineraryItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  }

  // Meeting helpers
  function addMeetingItem() {
    setMeetingItems((prev) => [...prev, emptyMeeting()]);
  }

  function removeMeetingItem(index: number) {
    setMeetingItems((prev) => prev.filter((_, i) => i !== index));
  }

  function updateMeetingItem(index: number, field: keyof NewMeetingItem, value: string) {
    setMeetingItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  }

  // Cost breakdown by destination for reporting tab
  const costByDestination = React.useMemo(() => {
    const map: Record<string, { trips: number; cost: number }> = {};
    for (const tr of travelRequests) {
      const dest = tr.destination;
      if (!map[dest]) map[dest] = { trips: 0, cost: 0 };
      map[dest].trips += 1;
      map[dest].cost += tr.actualCost ?? tr.estimatedCost ?? 0;
    }
    return Object.entries(map)
      .map(([destination, data]) => ({ destination, ...data }))
      .sort((a, b) => b.cost - a.cost);
  }, [travelRequests]);

  return (
    <div className="space-y-4">
      {/* Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          title="Total Trips"
          value={stats.totalTrips}
          icon="Globe"
          iconColor="text-[#1E3A5F]"
          iconBg="bg-[#1E3A5F]/10"
        />
        <StatCard
          title="Total Cost"
          value={stats.totalCost.toLocaleString("en-US", {
            style: "currency",
            currency: "USD",
            minimumFractionDigits: 0,
          })}
          icon="Target"
          iconColor="text-green-600"
          iconBg="bg-green-50"
        />
        <StatCard
          title="Avg Cost/Trip"
          value={stats.averageCostPerTrip.toLocaleString("en-US", {
            style: "currency",
            currency: "USD",
            minimumFractionDigits: 0,
          })}
          icon="BarChart2"
          iconColor="text-blue-600"
          iconBg="bg-blue-50"
        />
        <StatCard
          title="Schools Visited"
          value={stats.schoolsVisited}
          icon="Building2"
          iconColor="text-violet-600"
          iconBg="bg-violet-50"
        />
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="plans">Travel Plans</TabsTrigger>
          <TabsTrigger value="reporting">Travel Reporting</TabsTrigger>
        </TabsList>

        {/* Travel Plans Tab */}
        <TabsContent value="plans" className="mt-4 space-y-4">
          <div className="flex justify-end gap-2">
            <ExportButton
              data={travelRequests.map((tr) => ({
                employee: tr.employee.user.name ?? "Unknown",
                destination: tr.destination,
                purpose: tr.purpose,
                departDate: formatDate(tr.departDate),
                returnDate: formatDate(tr.returnDate),
                estimatedCost: tr.estimatedCost ?? "—",
                actualCost: tr.actualCost ?? "—",
                status: tr.status,
              }))}
              columns={[
                { key: "employee", header: "Employee" },
                { key: "destination", header: "Destination" },
                { key: "purpose", header: "Purpose" },
                { key: "departDate", header: "Depart Date" },
                { key: "returnDate", header: "Return Date" },
                { key: "estimatedCost", header: "Estimated Cost" },
                { key: "actualCost", header: "Actual Cost" },
                { key: "status", header: "Status" },
              ]}
              filename="travel-plans"
              title="Export Travel Plans"
            />
            <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-1" />
                  Create Travel Plan
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Create Travel Plan</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  {/* Basic Fields */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                      <Label htmlFor="employee">Employee</Label>
                      <Select value={employeeId} onValueChange={setEmployeeId}>
                        <SelectTrigger id="employee">
                          <SelectValue placeholder="Select employee" />
                        </SelectTrigger>
                        <SelectContent>
                          {employees.map((emp) => (
                            <SelectItem key={emp.id} value={emp.id}>
                              {emp.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-2">
                      <Label htmlFor="destination">Destination</Label>
                      <Input
                        id="destination"
                        value={destination}
                        onChange={(e) => setDestination(e.target.value)}
                        placeholder="e.g. London, UK"
                      />
                    </div>
                    <div className="col-span-2">
                      <Label htmlFor="purpose">Purpose</Label>
                      <Textarea
                        id="purpose"
                        value={purpose}
                        onChange={(e) => setPurpose(e.target.value)}
                        placeholder="Describe the purpose of the trip"
                        rows={2}
                      />
                    </div>
                    <div>
                      <Label htmlFor="departDate">Depart Date</Label>
                      <Input
                        id="departDate"
                        type="date"
                        value={departDate}
                        onChange={(e) => setDepartDate(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label htmlFor="returnDate">Return Date</Label>
                      <Input
                        id="returnDate"
                        type="date"
                        value={returnDate}
                        onChange={(e) => setReturnDate(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label htmlFor="estimatedCost">Estimated Cost ($)</Label>
                      <Input
                        id="estimatedCost"
                        type="number"
                        value={estimatedCost}
                        onChange={(e) => setEstimatedCost(e.target.value)}
                        placeholder="0"
                      />
                    </div>
                    <div className="col-span-2">
                      <Label htmlFor="notes">Notes</Label>
                      <Textarea
                        id="notes"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Additional notes (optional)"
                        rows={2}
                      />
                    </div>
                  </div>

                  <Separator />

                  {/* Itinerary Section */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label className="text-sm font-semibold">Itinerary</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={addItineraryItem}
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Add Item
                      </Button>
                    </div>
                    {itineraryItems.map((item, idx) => (
                      <div
                        key={idx}
                        className="border rounded-lg p-3 mb-2 space-y-2 bg-slate-50"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-slate-500">
                            Item {idx + 1}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeItineraryItem(idx)}
                            className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <Select
                            value={item.type}
                            onValueChange={(v) => updateItineraryItem(idx, "type", v)}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="FLIGHT">Flight</SelectItem>
                              <SelectItem value="HOTEL">Hotel</SelectItem>
                              <SelectItem value="TRANSFER">Transfer</SelectItem>
                              <SelectItem value="OTHER_TRAVEL">Other</SelectItem>
                            </SelectContent>
                          </Select>
                          <Input
                            placeholder="Description"
                            value={item.description}
                            onChange={(e) =>
                              updateItineraryItem(idx, "description", e.target.value)
                            }
                          />
                          <Input
                            placeholder="From"
                            value={item.departureLocation}
                            onChange={(e) =>
                              updateItineraryItem(idx, "departureLocation", e.target.value)
                            }
                          />
                          <Input
                            placeholder="To"
                            value={item.arrivalLocation}
                            onChange={(e) =>
                              updateItineraryItem(idx, "arrivalLocation", e.target.value)
                            }
                          />
                          <Input
                            type="date"
                            value={item.date}
                            onChange={(e) =>
                              updateItineraryItem(idx, "date", e.target.value)
                            }
                          />
                          <Input
                            type="number"
                            placeholder="Cost"
                            value={item.cost}
                            onChange={(e) =>
                              updateItineraryItem(idx, "cost", e.target.value)
                            }
                          />
                          <Input
                            placeholder="Confirmation Ref"
                            value={item.confirmationRef}
                            onChange={(e) =>
                              updateItineraryItem(idx, "confirmationRef", e.target.value)
                            }
                          />
                          <Input
                            placeholder="Notes"
                            value={item.notes}
                            onChange={(e) =>
                              updateItineraryItem(idx, "notes", e.target.value)
                            }
                          />
                        </div>
                      </div>
                    ))}
                    {itineraryItems.length === 0 && (
                      <p className="text-xs text-slate-400 py-2">
                        No itinerary items added yet.
                      </p>
                    )}
                  </div>

                  <Separator />

                  {/* Meetings Section */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label className="text-sm font-semibold">Meetings</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={addMeetingItem}
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Add Meeting
                      </Button>
                    </div>
                    {meetingItems.map((m, idx) => (
                      <div
                        key={idx}
                        className="border rounded-lg p-3 mb-2 space-y-2 bg-slate-50"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-slate-500">
                            Meeting {idx + 1}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeMeetingItem(idx)}
                            className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <Input
                            placeholder="Meeting title"
                            value={m.title}
                            onChange={(e) =>
                              updateMeetingItem(idx, "title", e.target.value)
                            }
                          />
                          <Input
                            placeholder="Location"
                            value={m.location}
                            onChange={(e) =>
                              updateMeetingItem(idx, "location", e.target.value)
                            }
                          />
                          <Input
                            type="date"
                            value={m.date}
                            onChange={(e) =>
                              updateMeetingItem(idx, "date", e.target.value)
                            }
                          />
                          <Input
                            placeholder="Notes"
                            value={m.notes}
                            onChange={(e) =>
                              updateMeetingItem(idx, "notes", e.target.value)
                            }
                          />
                        </div>
                      </div>
                    ))}
                    {meetingItems.length === 0 && (
                      <p className="text-xs text-slate-400 py-2">
                        No meetings added yet.
                      </p>
                    )}
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <Button
                      variant="outline"
                      onClick={() => { setDialogOpen(false); resetForm(); }}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleCreate}
                      disabled={submitting || !employeeId || !destination || !purpose || !departDate || !returnDate}
                    >
                      {submitting ? "Creating..." : "Create Travel Plan"}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {/* Travel Plans Table */}
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Destination</TableHead>
                    <TableHead>Purpose</TableHead>
                    <TableHead>Depart</TableHead>
                    <TableHead>Return</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Estimated</TableHead>
                    <TableHead className="text-right">Actual</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {travelRequests.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-slate-400">
                        No travel plans found
                      </TableCell>
                    </TableRow>
                  )}
                  {travelRequests.map((tr) => (
                    <TableRow key={tr.id}>
                      <TableCell className="font-medium">
                        {tr.employee.user.name ?? "Unknown"}
                      </TableCell>
                      <TableCell>{tr.destination}</TableCell>
                      <TableCell className="max-w-[200px] truncate">
                        {tr.purpose}
                      </TableCell>
                      <TableCell>{formatDate(tr.departDate)}</TableCell>
                      <TableCell>{formatDate(tr.returnDate)}</TableCell>
                      <TableCell>
                        <Badge className={STATUS_STYLES[tr.status] ?? ""}>
                          {tr.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {tr.estimatedCost != null
                          ? tr.estimatedCost.toLocaleString("en-US", {
                              style: "currency",
                              currency: "USD",
                              minimumFractionDigits: 0,
                            })
                          : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        {tr.actualCost != null
                          ? tr.actualCost.toLocaleString("en-US", {
                              style: "currency",
                              currency: "USD",
                              minimumFractionDigits: 0,
                            })
                          : "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Travel Reporting Tab */}
        <TabsContent value="reporting" className="mt-4 space-y-4">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <Card className="p-4">
              <p className="text-sm font-medium text-slate-500">Total Trips</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">
                {stats.totalTrips}
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-sm font-medium text-slate-500">Total Cost</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">
                {stats.totalCost.toLocaleString("en-US", {
                  style: "currency",
                  currency: "USD",
                  minimumFractionDigits: 0,
                })}
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-sm font-medium text-slate-500">Schools Visited</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">
                {stats.schoolsVisited}
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-sm font-medium text-slate-500">Agents Visited</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">
                {stats.agentsVisited}
              </p>
            </Card>
          </div>

          {/* Cost Breakdown by Destination */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Cost Breakdown by Destination</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Destination</TableHead>
                    <TableHead className="text-right">Trips</TableHead>
                    <TableHead className="text-right">Total Cost</TableHead>
                    <TableHead className="text-right">Avg Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {costByDestination.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-slate-400">
                        No travel data available
                      </TableCell>
                    </TableRow>
                  )}
                  {costByDestination.map((item) => (
                    <TableRow key={item.destination}>
                      <TableCell className="font-medium">
                        {item.destination}
                      </TableCell>
                      <TableCell className="text-right">{item.trips}</TableCell>
                      <TableCell className="text-right">
                        {item.cost.toLocaleString("en-US", {
                          style: "currency",
                          currency: "USD",
                          minimumFractionDigits: 0,
                        })}
                      </TableCell>
                      <TableCell className="text-right">
                        {(item.cost / item.trips).toLocaleString("en-US", {
                          style: "currency",
                          currency: "USD",
                          minimumFractionDigits: 0,
                        })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
