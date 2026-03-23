"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { CalendarDays, Globe, MapPin, Plus, Trash2 } from "lucide-react";

interface Holiday {
  id: string;
  name: string;
  date: string;
  description: string | null;
  isGlobal: boolean;
  regionId: string | null;
  region: { id: string; name: string } | null;
}

interface Region {
  id: string;
  name: string;
}

interface Props {
  isHR: boolean;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-CA", {
    weekday: "short", year: "numeric", month: "short", day: "numeric",
  });
}

function isUpcoming(dateStr: string) {
  return new Date(dateStr) >= new Date(new Date().setHours(0, 0, 0, 0));
}

export function HolidayManager({ isHR }: Props) {
  const { toast } = useToast();
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [filterRegion, setFilterRegion] = useState<string>("all");

  // Form state
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [description, setDescription] = useState("");
  const [regionId, setRegionId] = useState<string>("global");

  const loadHolidays = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/hr/holidays");
      const json = await res.json();
      setHolidays(json.holidays ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHolidays();
    if (isHR) {
      fetch("/api/hr/regions")
        .then((r) => r.json())
        .then((json) => setRegions(json.regions ?? []));
    }
  }, [isHR, loadHolidays]);

  async function handleAdd() {
    if (!name || !date) {
      toast({ title: "Missing fields", description: "Name and date are required.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/hr/holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          date,
          description: description || null,
          regionId: regionId === "global" ? null : regionId,
          isGlobal: regionId === "global",
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast({ title: "Error", description: json.error || "Failed to add holiday", variant: "destructive" });
        return;
      }
      toast({ title: "Holiday added", description: `${name} has been added.` });
      setShowAdd(false);
      setName(""); setDate(""); setDescription(""); setRegionId("global");
      loadHolidays();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string, holidayName: string) {
    if (!confirm(`Delete "${holidayName}"?`)) return;
    const res = await fetch(`/api/hr/holidays/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast({ title: "Deleted", description: `${holidayName} removed.` });
      setHolidays((h) => h.filter((x) => x.id !== id));
    } else {
      toast({ title: "Error", description: "Failed to delete holiday.", variant: "destructive" });
    }
  }

  const filtered = holidays.filter((h) => {
    if (filterRegion === "all") return true;
    if (filterRegion === "global") return h.isGlobal;
    return h.regionId === filterRegion;
  });

  const upcoming = filtered.filter((h) => isUpcoming(h.date));
  const past = filtered.filter((h) => !isUpcoming(h.date));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-muted-foreground" />
          <span className="font-medium">
            {upcoming.length} upcoming holiday{upcoming.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isHR && (
            <Select value={filterRegion} onValueChange={setFilterRegion}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Filter by region" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Regions</SelectItem>
                <SelectItem value="global">Global Only</SelectItem>
                {regions.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {isHR && (
            <Button size="sm" onClick={() => setShowAdd(true)}>
              <Plus className="h-4 w-4 mr-1" /> Add Holiday
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Loading holidays...</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center border rounded-lg">
          No holidays found.
        </div>
      ) : (
        <div className="space-y-6">
          {upcoming.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
                Upcoming
              </h3>
              <div className="space-y-2">
                {upcoming.map((h) => (
                  <HolidayRow key={h.id} holiday={h} isHR={isHR} onDelete={handleDelete} />
                ))}
              </div>
            </div>
          )}
          {past.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
                Past
              </h3>
              <div className="space-y-2 opacity-60">
                {past.map((h) => (
                  <HolidayRow key={h.id} holiday={h} isHR={isHR} onDelete={handleDelete} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add Holiday Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Holiday</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Holiday Name *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Canada Day"
              />
            </div>
            <div className="space-y-2">
              <Label>Date *</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Region</Label>
              <Select value={regionId} onValueChange={setRegionId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">
                    <div className="flex items-center gap-2">
                      <Globe className="h-3.5 w-3.5" /> Global (all regions)
                    </div>
                  </SelectItem>
                  {regions.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Global holidays apply to all employees. Region-specific holidays only appear for employees in that region.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Description (optional)</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={submitting}>
              {submitting ? "Adding..." : "Add Holiday"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function HolidayRow({
  holiday,
  isHR,
  onDelete,
}: {
  holiday: Holiday;
  isHR: boolean;
  onDelete: (id: string, name: string) => void;
}) {
  const daysAway = Math.ceil(
    (new Date(holiday.date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );

  return (
    <div className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/30 transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex flex-col items-center justify-center flex-shrink-0">
          <span className="text-xs font-bold text-primary leading-none">
            {new Date(holiday.date).toLocaleDateString("en", { month: "short" }).toUpperCase()}
          </span>
          <span className="text-sm font-bold text-primary leading-none">
            {new Date(holiday.date).getDate()}
          </span>
        </div>
        <div className="min-w-0">
          <p className="font-medium text-sm truncate">{holiday.name}</p>
          <p className="text-xs text-muted-foreground">{formatDate(holiday.date)}</p>
          {holiday.description && (
            <p className="text-xs text-muted-foreground truncate">{holiday.description}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
        {holiday.isGlobal ? (
          <Badge variant="secondary" className="gap-1">
            <Globe className="h-3 w-3" /> Global
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1">
            <MapPin className="h-3 w-3" /> {holiday.region?.name ?? "Region"}
          </Badge>
        )}
        {isUpcoming(holiday.date) && daysAway <= 30 && (
          <Badge variant="default" className="text-xs">
            {daysAway === 0 ? "Today" : daysAway === 1 ? "Tomorrow" : `${daysAway}d`}
          </Badge>
        )}
        {isHR && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={() => onDelete(holiday.id, holiday.name)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
