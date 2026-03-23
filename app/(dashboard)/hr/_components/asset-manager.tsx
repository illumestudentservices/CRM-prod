"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { getInitials } from "@/lib/utils";
import {
  Plus, Monitor, Laptop, Smartphone, Printer, Package,
  UserPlus, RotateCcw, Trash2, Search,
} from "lucide-react";

interface Assignment {
  id: string;
  employee: {
    id: string;
    employeeId: string;
    user: { id: string; name: string | null; image?: string | null };
  };
}

interface Asset {
  id: string;
  name: string;
  type: string;
  serialNumber: string | null;
  brand: string | null;
  model: string | null;
  status: string;
  purchasedAt: string | null;
  warrantyEnd: string | null;
  notes: string | null;
  assignments: Assignment[];
}

interface Employee {
  id: string;
  employeeId: string;
  jobTitle: string;
  user: { name: string | null };
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  LAPTOP: <Laptop className="h-4 w-4" />,
  DESKTOP: <Monitor className="h-4 w-4" />,
  PHONE: <Smartphone className="h-4 w-4" />,
  PRINTER: <Printer className="h-4 w-4" />,
};

const STATUS_VARIANT: Record<string, "success" | "secondary" | "warning" | "destructive"> = {
  AVAILABLE: "success",
  ASSIGNED: "secondary",
  MAINTENANCE: "warning",
  RETIRED: "destructive",
};

const ASSET_TYPES = ["LAPTOP", "DESKTOP", "PHONE", "PRINTER", "MONITOR", "TABLET", "OTHER"];

export function AssetManager({ isHR }: { isHR: boolean }) {
  const { toast } = useToast();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");

  // Dialogs
  const [showAdd, setShowAdd] = useState(false);
  const [assignTarget, setAssignTarget] = useState<Asset | null>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [assignNotes, setAssignNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Add form
  const [form, setForm] = useState({
    name: "", type: "LAPTOP", serialNumber: "", brand: "",
    model: "", purchasedAt: "", warrantyEnd: "", notes: "",
  });

  const loadAssets = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/hr/assets");
    const json = await res.json();
    setAssets(json.assets ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAssets();
    fetch("/api/hr/employees?limit=200")
      .then((r) => r.json())
      .then((json) => setEmployees(json.employees ?? []));
  }, [loadAssets]);

  async function handleAdd() {
    if (!form.name || !form.type) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/hr/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          type: form.type,
          serialNumber: form.serialNumber || null,
          brand: form.brand || null,
          model: form.model || null,
          purchasedAt: form.purchasedAt || null,
          warrantyEnd: form.warrantyEnd || null,
          notes: form.notes || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) { toast({ title: "Error", description: json.error, variant: "destructive" }); return; }
      toast({ title: "Asset added" });
      setShowAdd(false);
      setForm({ name: "", type: "LAPTOP", serialNumber: "", brand: "", model: "", purchasedAt: "", warrantyEnd: "", notes: "" });
      loadAssets();
    } finally { setSubmitting(false); }
  }

  async function handleAssign() {
    if (!assignTarget || !selectedEmployeeId) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/hr/assets/${assignTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "assign", employeeId: selectedEmployeeId, notes: assignNotes || null }),
      });
      const json = await res.json();
      if (!res.ok) { toast({ title: "Error", description: json.error, variant: "destructive" }); return; }
      toast({ title: "Asset assigned" });
      setAssignTarget(null);
      setSelectedEmployeeId("");
      setAssignNotes("");
      loadAssets();
    } finally { setSubmitting(false); }
  }

  async function handleReturn(asset: Asset) {
    if (!confirm(`Return "${asset.name}"?`)) return;
    const res = await fetch(`/api/hr/assets/${asset.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "return" }),
    });
    if (res.ok) { toast({ title: "Asset returned" }); loadAssets(); }
    else { const j = await res.json(); toast({ title: "Error", description: j.error, variant: "destructive" }); }
  }

  async function handleDelete(asset: Asset) {
    if (!confirm(`Delete "${asset.name}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/hr/assets/${asset.id}`, { method: "DELETE" });
    if (res.ok) { toast({ title: "Asset deleted" }); loadAssets(); }
    else { const j = await res.json(); toast({ title: "Error", description: j.error, variant: "destructive" }); }
  }

  const filtered = assets.filter((a) => {
    const matchSearch = !search ||
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      (a.serialNumber ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (a.brand ?? "").toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === "all" || a.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const stats = {
    total: assets.length,
    available: assets.filter((a) => a.status === "AVAILABLE").length,
    assigned: assets.filter((a) => a.status === "ASSIGNED").length,
    maintenance: assets.filter((a) => a.status === "MAINTENANCE").length,
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Assets", value: stats.total, color: "text-slate-700" },
          { label: "Available", value: stats.available, color: "text-green-600" },
          { label: "Assigned", value: stats.assigned, color: "text-blue-600" },
          { label: "Maintenance", value: stats.maintenance, color: "text-amber-600" },
        ].map((s) => (
          <div key={s.label} className="p-3 rounded-lg border bg-card text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by name, serial, brand..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="AVAILABLE">Available</SelectItem>
            <SelectItem value="ASSIGNED">Assigned</SelectItem>
            <SelectItem value="MAINTENANCE">Maintenance</SelectItem>
            <SelectItem value="RETIRED">Retired</SelectItem>
          </SelectContent>
        </Select>
        {isHR && (
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add Asset
          </Button>
        )}
      </div>

      {/* Asset List */}
      {loading ? (
        <div className="text-sm text-muted-foreground py-10 text-center">Loading assets...</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-muted-foreground py-10 text-center border rounded-lg">
          No assets found.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((asset) => {
            const assignee = asset.assignments[0]?.employee;
            return (
              <div key={asset.id} className="flex items-center gap-4 p-4 rounded-lg border bg-card hover:bg-accent/20 transition-colors">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 text-primary">
                  {TYPE_ICONS[asset.type] ?? <Package className="h-4 w-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-sm">{asset.name}</p>
                    <Badge variant={STATUS_VARIANT[asset.status] ?? "secondary"} className="text-xs">
                      {asset.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {[asset.brand, asset.model, asset.serialNumber ? `S/N: ${asset.serialNumber}` : null]
                      .filter(Boolean).join(" · ")}
                  </p>
                  {assignee && (
                    <div className="flex items-center gap-1.5 mt-1">
                      <Avatar className="h-4 w-4">
                        <AvatarImage src={(assignee.user as { image?: string | null }).image ?? undefined} />
                        <AvatarFallback className="text-[8px] bg-primary text-white">
                          {getInitials(assignee.user.name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-xs text-muted-foreground">
                        Assigned to {assignee.user.name} · {assignee.employeeId}
                      </span>
                    </div>
                  )}
                  {asset.warrantyEnd && (
                    <p className="text-xs text-amber-600 mt-0.5">
                      Warranty ends {new Date(asset.warrantyEnd).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" })}
                    </p>
                  )}
                </div>
                {isHR && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {asset.status === "AVAILABLE" && (
                      <Button variant="outline" size="sm" className="h-7 text-xs gap-1"
                        onClick={() => { setAssignTarget(asset); setSelectedEmployeeId(""); setAssignNotes(""); }}>
                        <UserPlus className="h-3.5 w-3.5" /> Assign
                      </Button>
                    )}
                    {asset.status === "ASSIGNED" && (
                      <Button variant="outline" size="sm" className="h-7 text-xs gap-1"
                        onClick={() => handleReturn(asset)}>
                        <RotateCcw className="h-3.5 w-3.5" /> Return
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(asset)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add Asset Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Asset</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Asset Name *</Label>
                <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. MacBook Pro" />
              </div>
              <div className="space-y-1.5">
                <Label>Type *</Label>
                <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ASSET_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Brand</Label>
                <Input value={form.brand} onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))} placeholder="Apple" />
              </div>
              <div className="space-y-1.5">
                <Label>Model</Label>
                <Input value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} placeholder="M3 Pro" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Serial Number</Label>
              <Input value={form.serialNumber} onChange={(e) => setForm((f) => ({ ...f, serialNumber: e.target.value }))} placeholder="SN-XXXXXXX" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Purchase Date</Label>
                <Input type="date" value={form.purchasedAt} onChange={(e) => setForm((f) => ({ ...f, purchasedAt: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Warranty End</Label>
                <Input type="date" value={form.warrantyEnd} onChange={(e) => setForm((f) => ({ ...f, warrantyEnd: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Any notes..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={submitting || !form.name}>
              {submitting ? "Adding..." : "Add Asset"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Dialog */}
      <Dialog open={!!assignTarget} onOpenChange={(o) => { if (!o) setAssignTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Asset</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-sm text-muted-foreground">
              Assigning: <strong className="text-foreground">{assignTarget?.name}</strong>
              {assignTarget?.serialNumber && <span> (S/N: {assignTarget.serialNumber})</span>}
            </p>
            <div className="space-y-1.5">
              <Label>Assign To *</Label>
              <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
                <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.user.name ?? "Unknown"} — {e.jobTitle}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Input
                value={assignNotes}
                onChange={(e) => setAssignNotes(e.target.value)}
                placeholder="Any assignment notes..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignTarget(null)}>Cancel</Button>
            <Button onClick={handleAssign} disabled={submitting || !selectedEmployeeId}>
              {submitting ? "Assigning..." : "Assign Asset"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
