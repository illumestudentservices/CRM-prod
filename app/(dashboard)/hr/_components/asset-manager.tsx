"use client";

/**
 * The IT asset register.
 *
 * Rewritten when the regional managers' "Global IT Equipment Inventory"
 * spreadsheet was imported. That sheet carries ten columns this screen had no
 * home for — region, country, custodian, position, condition, accessories,
 * asset tag, purchase year/month, verified by, date verified — and it is those
 * columns, not the device name, that people actually look things up by.
 *
 * Two structural changes came with it:
 *
 *  - `status` is the register's OPERATIONAL state (In Use / Spare / Repair /
 *    Lost / Stolen / Retired), not custody. Custody is the assignment table.
 *    Under the old AVAILABLE/ASSIGNED scheme all 84 imported devices would have
 *    read "AVAILABLE" — because almost none of the people holding them have an
 *    Employee record yet — while the register said 63 were in use.
 *  - the list groups by custodian, because "what has this person got" is the
 *    question, and one person's laptop and phone were landing at opposite ends
 *    of the list under created-at order.
 *
 * There is now an Edit action. Until this rewrite an asset could be created,
 * assigned, returned and deleted but never corrected, so fixing a typed serial
 * meant deleting the record and losing its assignment history.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
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
import { getInitials, cn } from "@/lib/utils";
import {
  ASSET_TYPES, ASSET_TYPE_LABELS, ASSET_STATUSES, ASSET_STATUS_LABELS,
  ASSET_STATUS_BADGE, ASSET_STATUSES_NEEDING_ATTENTION,
  ASSET_CONDITIONS, ASSET_CONDITION_LABELS, ASSET_CONDITION_CLASS,
  formatPurchase,
  type AssetStatus, type AssetCondition,
} from "@/lib/assets";
import {
  Plus, Monitor, Laptop, Smartphone, Printer, Package, Tablet, Headphones,
  HardDrive, UserPlus, RotateCcw, Trash2, Search, Pencil, MapPin, BadgeCheck,
  Cable, X,
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
  assetTag: string | null;
  brand: string | null;
  model: string | null;
  status: string;
  condition: string | null;
  regionId: string | null;
  region: { id: string; name: string } | null;
  country: string | null;
  custodianName: string | null;
  custodianPosition: string | null;
  accessories: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  purchasedAt: string | null;
  purchasePrecision: string | null;
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
  MONITOR: <Monitor className="h-4 w-4" />,
  MOBILE_PHONE: <Smartphone className="h-4 w-4" />,
  TABLET: <Tablet className="h-4 w-4" />,
  PRINTER: <Printer className="h-4 w-4" />,
  HEADSET: <Headphones className="h-4 w-4" />,
  DOCKING_STATION: <HardDrive className="h-4 w-4" />,
};

/** Everything the add/edit dialog holds, as strings — one shape for both modes. */
type FormState = {
  name: string; type: string; status: string; condition: string;
  brand: string; model: string; serialNumber: string; assetTag: string;
  regionId: string; country: string;
  custodianName: string; custodianPosition: string;
  accessories: string; verifiedBy: string; verifiedAt: string;
  purchasedAt: string; warrantyEnd: string; notes: string;
  /**
   * Carried, not shown. A date input can only offer a day, so "bought June
   * 2024" loads as 2024-06-01 — and opening the dialog to fix a typo in the
   * serial and pressing Save would then send that date back and have the server
   * stamp it DAY, quietly turning "June 2024" into "1 June 2024". The original
   * precision rides along and is only replaced when the date itself is edited.
   */
  purchasePrecision: string;
};

const EMPTY_FORM: FormState = {
  name: "", type: "LAPTOP", status: "SPARE", condition: "",
  brand: "", model: "", serialNumber: "", assetTag: "",
  regionId: "", country: "",
  custodianName: "", custodianPosition: "",
  accessories: "", verifiedBy: "", verifiedAt: "",
  purchasedAt: "", warrantyEnd: "", notes: "",
  purchasePrecision: "DAY",
};

/** A stored timestamp to the `yyyy-mm-dd` an `<input type="date">` wants. */
const dateInput = (v: string | null) => (v ? new Date(v).toISOString().slice(0, 10) : "");

/**
 * `""` is the CLEARED state in Radix Select and it THROWS if used as an item
 * value — and not lazily: closed content still renders into a fragment to
 * collect items, so it fires on mount and the dialog silently never opens.
 * "none" is the sentinel the rest of this codebase already uses; it is mapped
 * back to "" on the way into form state and to null on the way to the API.
 */
const NONE = "none";
const fromSelect = (v: string) => (v === NONE ? "" : v);
const toSelect = (v: string) => (v === "" ? NONE : v);

export function AssetManager({ isHR }: { isHR: boolean }) {
  const { toast } = useToast();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [regions, setRegions] = useState<{ id: string; name: string }[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [filterRegion, setFilterRegion] = useState("all");
  const [filterCondition, setFilterCondition] = useState("all");

  // Dialogs
  const [editing, setEditing] = useState<Asset | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [assignTarget, setAssignTarget] = useState<Asset | null>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [assignNotes, setAssignNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const loadAssets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/hr/assets");
      const json = await res.json();
      setAssets(json.assets ?? []);
      setRegions(json.regions ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAssets();
    // Only HR can read the staff list, and only HR sees the Assign button, so
    // asking for it as anyone else earns a 403 in the console for nothing.
    if (!isHR) return;
    fetch("/api/hr/employees?limit=200")
      .then((r) => (r.ok ? r.json() : { employees: [] }))
      .then((json) => setEmployees(json.employees ?? []))
      .catch(() => setEmployees([]));
  }, [loadAssets, isHR]);

  function openAdd() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function openEdit(a: Asset) {
    setEditing(a);
    setForm({
      name: a.name, type: a.type, status: a.status, condition: a.condition ?? "",
      brand: a.brand ?? "", model: a.model ?? "",
      serialNumber: a.serialNumber ?? "", assetTag: a.assetTag ?? "",
      regionId: a.regionId ?? "", country: a.country ?? "",
      custodianName: a.custodianName ?? "", custodianPosition: a.custodianPosition ?? "",
      accessories: a.accessories ?? "", verifiedBy: a.verifiedBy ?? "",
      verifiedAt: dateInput(a.verifiedAt),
      purchasedAt: dateInput(a.purchasedAt), warrantyEnd: dateInput(a.warrantyEnd),
      notes: a.notes ?? "",
      purchasePrecision: a.purchasePrecision ?? "DAY",
    });
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.name.trim()) return;
    setSubmitting(true);
    try {
      const payload = {
        ...form,
        condition: form.condition || null,
        regionId: form.regionId || null,
        // Sent explicitly so the server does not have to guess. It defaults an
        // unaccompanied date to DAY, which is right for a date somebody typed
        // and wrong for one the importer derived from a year and a month.
        purchasePrecision: form.purchasedAt ? form.purchasePrecision : null,
      };
      const res = editing
        ? await fetch(`/api/hr/assets/${editing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "update", ...payload }),
          })
        : await fetch("/api/hr/assets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Could not save", description: json.error ?? "Try again", variant: "destructive" });
        return;
      }
      toast({ title: editing ? "Asset updated" : "Asset added" });
      setShowForm(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      loadAssets();
    } finally {
      setSubmitting(false);
    }
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
      const json = await res.json().catch(() => ({}));
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
    else { const j = await res.json().catch(() => ({})); toast({ title: "Error", description: j.error, variant: "destructive" }); }
  }

  async function handleDelete(asset: Asset) {
    if (!confirm(`Delete "${asset.name}"? It goes to the Recycle Bin.`)) return;
    const res = await fetch(`/api/hr/assets/${asset.id}`, { method: "DELETE" });
    if (res.ok) { toast({ title: "Asset deleted" }); loadAssets(); }
    else { const j = await res.json().catch(() => ({})); toast({ title: "Error", description: j.error, variant: "destructive" }); }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assets.filter((a) => {
      if (q) {
        // Serial, tag and custodian are all searchable because all three are how
        // a device gets looked up — somebody reads a sticker, or asks what a
        // named person is holding.
        const hay = [
          a.name, a.brand, a.model, a.serialNumber, a.assetTag,
          a.custodianName, a.custodianPosition, a.country, a.region?.name,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filterStatus !== "all" && a.status !== filterStatus) return false;
      if (filterType !== "all" && a.type !== filterType) return false;
      if (filterRegion !== "all" && a.regionId !== filterRegion) return false;
      if (filterCondition !== "all" && (a.condition ?? "") !== filterCondition) return false;
      return true;
    });
  }, [assets, search, filterStatus, filterType, filterRegion, filterCondition]);

  const stats = useMemo(() => ({
    total: assets.length,
    inUse: assets.filter((a) => a.status === "IN_USE").length,
    spare: assets.filter((a) => a.status === "SPARE").length,
    attention: assets.filter((a) =>
      ASSET_STATUSES_NEEDING_ATTENTION.includes(a.status as AssetStatus) ||
      a.condition === "DAMAGED" || a.condition === "POOR"
    ).length,
    unassigned: assets.filter((a) => a.assignments.length === 0 && a.custodianName).length,
  }), [assets]);

  const anyFilter =
    !!search || filterStatus !== "all" || filterType !== "all" ||
    filterRegion !== "all" || filterCondition !== "all";

  function clearFilters() {
    setSearch(""); setFilterStatus("all"); setFilterType("all");
    setFilterRegion("all"); setFilterCondition("all");
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Devices", value: stats.total, color: "text-slate-700 dark:text-slate-200" },
          { label: "In Use", value: stats.inUse, color: "text-green-600 dark:text-green-400" },
          { label: "Spare", value: stats.spare, color: "text-blue-600 dark:text-blue-400" },
          // One number for "somebody needs to deal with this", covering both a
          // status (repair, lost, stolen) and a condition (poor, damaged) —
          // they are separate columns but the same to-do list.
          { label: "Needs Attention", value: stats.attention, color: "text-amber-600 dark:text-amber-400" },
        ].map((s) => (
          <div key={s.label} className="p-3 rounded-lg border bg-card text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      {/*
        The imported register names its custodians as text, because 52 of them
        have no staff record yet. This says so plainly rather than letting the
        list look like it is fully linked up — and it disappears once every
        device is attached to a real employee.
      */}
      {isHR && stats.unassigned > 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-sky-200 dark:border-sky-500/30 bg-sky-50 dark:bg-sky-500/10 px-4 py-3">
          <UserPlus className="h-4 w-4 text-sky-600 dark:text-sky-300 shrink-0 mt-0.5" />
          <p className="text-sm text-sky-900 dark:text-sky-200">
            <strong>{stats.unassigned}</strong> device{stats.unassigned === 1 ? " is" : "s are"} recorded
            against a custodian&apos;s name but not yet linked to a staff record. Use{" "}
            <strong>Assign</strong> on a device once its holder has an employee profile — the name
            shown now came from the equipment register.
          </p>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search name, serial, tag, person, country…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {ASSET_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{ASSET_STATUS_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {ASSET_TYPES.map((t) => (
              <SelectItem key={t} value={t}>{ASSET_TYPE_LABELS[t]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {regions.length > 0 && (
          <Select value={filterRegion} onValueChange={setFilterRegion}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder="Region" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Regions</SelectItem>
              {regions.map((r) => (
                <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={filterCondition} onValueChange={setFilterCondition}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Condition" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Conditions</SelectItem>
            {ASSET_CONDITIONS.map((c) => (
              <SelectItem key={c} value={c}>{ASSET_CONDITION_LABELS[c]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {anyFilter && (
          <Button variant="ghost" size="sm" className="gap-1" onClick={clearFilters}>
            <X className="h-3.5 w-3.5" /> Clear
          </Button>
        )}
        {isHR && (
          <Button size="sm" onClick={openAdd}>
            <Plus className="h-4 w-4 mr-1" /> Add Asset
          </Button>
        )}
      </div>

      {anyFilter && !loading && (
        <p className="text-xs text-muted-foreground">
          Showing {filtered.length} of {assets.length} devices
        </p>
      )}

      {/* Asset List */}
      {loading ? (
        <div className="text-sm text-muted-foreground py-10 text-center">Loading assets…</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-muted-foreground py-10 text-center border rounded-lg">
          {assets.length === 0 ? "No assets recorded yet." : "No assets match your filters."}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((asset) => {
            const assignee = asset.assignments[0]?.employee;
            const status = asset.status as AssetStatus;
            const condition = asset.condition as AssetCondition | null;
            const purchase = formatPurchase(asset.purchasedAt, asset.purchasePrecision);
            return (
              <div key={asset.id} className="flex items-start gap-4 p-4 rounded-lg border bg-card hover:bg-accent/20 transition-colors">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 text-primary mt-0.5">
                  {TYPE_ICONS[asset.type] ?? <Package className="h-4 w-4" />}
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-sm">{asset.name}</p>
                    <Badge variant={ASSET_STATUS_BADGE[status] ?? "secondary"} className="text-xs">
                      {ASSET_STATUS_LABELS[status] ?? asset.status}
                    </Badge>
                    {condition && (
                      <span className={cn(
                        "text-[10px] font-medium px-2 py-0.5 rounded-full",
                        ASSET_CONDITION_CLASS[condition] ?? "bg-slate-100 text-slate-600"
                      )}>
                        {ASSET_CONDITION_LABELS[condition] ?? condition}
                      </span>
                    )}
                    {asset.assetTag && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                        {asset.assetTag}
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-muted-foreground">
                    {[
                      asset.brand, asset.model,
                      asset.serialNumber ? `S/N ${asset.serialNumber}` : null,
                      purchase ? `bought ${purchase}` : null,
                    ].filter(Boolean).join(" · ")}
                  </p>

                  {/* Who has it. The linked employee wins over the register's
                      text name, because an assignment is a foreign key with a
                      date and the text is a best-known-holder. */}
                  {assignee ? (
                    <div className="flex items-center gap-1.5">
                      <Avatar className="h-4 w-4">
                        <AvatarImage src={(assignee.user as { image?: string | null }).image ?? undefined} />
                        <AvatarFallback className="text-[8px] bg-primary text-white">
                          {getInitials(assignee.user.name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-xs text-muted-foreground">
                        {assignee.user.name} · {assignee.employeeId}
                      </span>
                    </div>
                  ) : asset.custodianName ? (
                    <p className="text-xs text-muted-foreground">
                      {asset.custodianName}
                      {asset.custodianPosition ? ` · ${asset.custodianPosition}` : ""}
                      <span className="ml-1.5 text-[10px] text-sky-600 dark:text-sky-400">
                        (not linked to a staff record)
                      </span>
                    </p>
                  ) : null}

                  <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                    {(asset.region?.name || asset.country) && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {[asset.country, asset.region?.name].filter(Boolean).join(" · ")}
                      </span>
                    )}
                    {asset.accessories && (
                      <span className="inline-flex items-center gap-1">
                        <Cable className="h-3 w-3" />
                        {asset.accessories}
                      </span>
                    )}
                    {asset.verifiedBy && (
                      <span className="inline-flex items-center gap-1">
                        <BadgeCheck className="h-3 w-3" />
                        {asset.verifiedBy}
                        {asset.verifiedAt && ` · ${formatPurchase(asset.verifiedAt, "DAY")}`}
                      </span>
                    )}
                  </div>

                  {asset.notes && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 italic">{asset.notes}</p>
                  )}

                  {asset.warrantyEnd && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      Warranty ends {formatPurchase(asset.warrantyEnd, "DAY")}
                    </p>
                  )}
                </div>
                {isHR && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {/* Assign is offered whenever nobody is formally holding it,
                        whatever the operational status — a laptop can be in use
                        by someone whose staff record has only just been created,
                        and that is exactly the case this button exists for. */}
                    {asset.assignments.length === 0 && (
                      <Button variant="outline" size="sm" className="h-7 text-xs gap-1"
                        onClick={() => { setAssignTarget(asset); setSelectedEmployeeId(""); setAssignNotes(""); }}>
                        <UserPlus className="h-3.5 w-3.5" /> Assign
                      </Button>
                    )}
                    {asset.assignments.length > 0 && (
                      <Button variant="outline" size="sm" className="h-7 text-xs gap-1"
                        onClick={() => handleReturn(asset)}>
                        <RotateCcw className="h-3.5 w-3.5" /> Return
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit"
                      onClick={() => openEdit(asset)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                      title="Delete" onClick={() => handleDelete(asset)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit dialog — one form, two modes, so a field can never be
          addable but not editable. */}
      <Dialog open={showForm} onOpenChange={(o) => { setShowForm(o); if (!o) setEditing(null); }}>
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Asset" : "Add Asset"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Device Name *</Label>
                <Input value={form.name} onChange={(e) => set("name", e.target.value)}
                  placeholder="e.g. HP EliteBook 1040 G10" />
              </div>
              <div className="space-y-1.5">
                <Label>Equipment Type *</Label>
                <Select value={form.type} onValueChange={(v) => set("type", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ASSET_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{ASSET_TYPE_LABELS[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="space-y-1.5">
                <Label>Brand</Label>
                <Input value={form.brand} onChange={(e) => set("brand", e.target.value)} placeholder="HP" />
              </div>
              <div className="space-y-1.5">
                <Label>Model</Label>
                <Input value={form.model} onChange={(e) => set("model", e.target.value)} placeholder="EliteBook" />
              </div>
              <div className="space-y-1.5">
                <Label>Serial Number</Label>
                <Input value={form.serialNumber} onChange={(e) => set("serialNumber", e.target.value)} placeholder="5CG33756BY" />
              </div>
              <div className="space-y-1.5">
                <Label>Asset Tag</Label>
                <Input value={form.assetTag} onChange={(e) => set("assetTag", e.target.value)} placeholder="UAE-001" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Status *</Label>
                <Select value={form.status} onValueChange={(v) => set("status", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ASSET_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{ASSET_STATUS_LABELS[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Condition</Label>
                <Select value={toSelect(form.condition)} onValueChange={(v) => set("condition", fromSelect(v))}>
                  <SelectTrigger><SelectValue placeholder="Not recorded" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not recorded</SelectItem>
                    {ASSET_CONDITIONS.map((c) => (
                      <SelectItem key={c} value={c}>{ASSET_CONDITION_LABELS[c]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Custodian</Label>
                <Input value={form.custodianName} onChange={(e) => set("custodianName", e.target.value)}
                  placeholder="Who is holding it" />
                <p className="text-[11px] text-muted-foreground">
                  A name is enough. Link it to a staff record with <strong>Assign</strong> once they have one.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Position</Label>
                <Input value={form.custodianPosition} onChange={(e) => set("custodianPosition", e.target.value)}
                  placeholder="ICR" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Region</Label>
                <Select value={toSelect(form.regionId)} onValueChange={(v) => set("regionId", fromSelect(v))}>
                  <SelectTrigger><SelectValue placeholder="Not recorded" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not recorded</SelectItem>
                    {regions.map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Country</Label>
                <Input value={form.country} onChange={(e) => set("country", e.target.value)} placeholder="Nigeria" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Accessories</Label>
              <Input value={form.accessories} onChange={(e) => set("accessories", e.target.value)}
                placeholder="Charger, Backpack" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Purchase Date</Label>
                <Input type="date" value={form.purchasedAt}
                  onChange={(e) =>
                    // Editing the date is what makes it a known day. Leaving it
                    // alone must not promote "June 2024" to "1 June 2024".
                    setForm((f) => ({ ...f, purchasedAt: e.target.value, purchasePrecision: "DAY" }))
                  } />
                {form.purchasedAt && form.purchasePrecision !== "DAY" && (
                  <p className="text-[11px] text-muted-foreground">
                    Recorded as {form.purchasePrecision === "YEAR" ? "a year" : "a month"} only —
                    the day shown is a placeholder. Changing this field records an exact date.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Warranty End</Label>
                <Input type="date" value={form.warrantyEnd} onChange={(e) => set("warrantyEnd", e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Verified By</Label>
                <Input value={form.verifiedBy} onChange={(e) => set("verifiedBy", e.target.value)}
                  placeholder="Regional Manager" />
              </div>
              <div className="space-y-1.5">
                <Label>Date Verified</Label>
                <Input type="date" value={form.verifiedAt} onChange={(e) => set("verifiedAt", e.target.value)} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Comments</Label>
              <Input value={form.notes} onChange={(e) => set("notes", e.target.value)}
                placeholder="Anything worth knowing about this device" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowForm(false); setEditing(null); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={submitting || !form.name.trim()}>
              {submitting ? "Saving…" : editing ? "Save Changes" : "Add Asset"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Dialog */}
      <Dialog open={!!assignTarget} onOpenChange={(o) => { if (!o) setAssignTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Assign Asset</DialogTitle></DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-sm text-muted-foreground">
              Assigning: <strong className="text-foreground">{assignTarget?.name}</strong>
              {assignTarget?.serialNumber && <span> (S/N {assignTarget.serialNumber})</span>}
            </p>
            {assignTarget?.custodianName && (
              <p className="text-xs text-muted-foreground">
                The equipment register records this as held by{" "}
                <strong className="text-foreground">{assignTarget.custodianName}</strong>. Picking a
                staff member below replaces that with a real link.
              </p>
            )}
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
              {employees.length === 0 && (
                <p className="text-[11px] text-muted-foreground">
                  No staff records available to assign to.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Input
                value={assignNotes}
                onChange={(e) => setAssignNotes(e.target.value)}
                placeholder="Any assignment notes…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignTarget(null)}>Cancel</Button>
            <Button onClick={handleAssign} disabled={submitting || !selectedEmployeeId}>
              {submitting ? "Assigning…" : "Assign Asset"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
