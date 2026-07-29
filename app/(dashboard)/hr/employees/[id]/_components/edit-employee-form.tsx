"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

interface Department { id: string; name: string; }
interface ManagerOption { id: string; user: { name: string | null }; }
interface Region { id: string; name: string; }

interface EditEmployeeFormProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  employeeId: string;
  initial: {
    jobTitle: string;
    employmentType: string;
    gender?: string | null;
    /** ISO date. Drives leave accrual, so editing it reprices entitlement. */
    startDate: string;
    phone: string | null;
    emergencyContact: string | null;
    emergencyPhone: string | null;
    address: string | null;
    isActive: boolean;
    departmentId: string | null;
    managerId: string | null;
    // Super admin fields
    name: string | null;
    email: string;
    role: string;
    regionId: string | null;
  };
  departments: Department[];
  managers: ManagerOption[];
  regions: Region[];
  isHR: boolean;
  isSuperAdmin: boolean;
}

export function EditEmployeeForm({
  open,
  onClose,
  onSuccess,
  employeeId,
  initial,
  departments,
  managers,
  regions,
  isHR,
  isSuperAdmin,
}: EditEmployeeFormProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    // Super admin fields
    name: initial.name ?? "",
    email: initial.email,
    role: initial.role,
    regionId: initial.regionId ?? "none",
    // HR fields
    jobTitle: initial.jobTitle,
    employmentType: initial.employmentType,
    gender: initial.gender ?? "none",
    startDate: initial.startDate?.slice(0, 10) ?? "",
    isActive: initial.isActive,
    departmentId: initial.departmentId ?? "none",
    managerId: initial.managerId ?? "none",
    // Self fields
    phone: initial.phone ?? "",
    emergencyContact: initial.emergencyContact ?? "",
    emergencyPhone: initial.emergencyPhone ?? "",
    address: initial.address ?? "",
  });

  const set = (k: string, v: string | boolean) => setForm((p) => ({ ...p, [k]: v }));

  async function handleSave() {
    setLoading(true);
    const payload: Record<string, unknown> = {
      phone: form.phone || null,
      emergencyContact: form.emergencyContact || null,
      emergencyPhone: form.emergencyPhone || null,
      address: form.address || null,
    };
    if (isHR) {
      payload.jobTitle = form.jobTitle;
      payload.employmentType = form.employmentType;
      payload.gender = form.gender === "none" ? null : form.gender;
      if (form.startDate) payload.startDate = form.startDate;
      payload.isActive = form.isActive;
      payload.departmentId = form.departmentId === "none" ? null : form.departmentId;
      payload.managerId = form.managerId === "none" ? null : form.managerId;
    }
    if (isSuperAdmin) {
      payload.name = form.name || null;
      payload.email = form.email;
      payload.role = form.role;
      payload.regionId = form.regionId === "none" ? null : form.regionId;
    }
    const res = await fetch(`/api/hr/employees/${employeeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setLoading(false);
    if (res.ok) {
      toast({ title: "Employee updated" });
      onSuccess();
    } else {
      const d = await res.json();
      toast({ title: "Error", description: d.error ?? "Failed to update", variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Employee</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {isSuperAdmin && (
            <>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b pb-1">Account Settings</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Full Name</Label>
                  <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Role</Label>
                  <Select value={form.role} onValueChange={(v) => set("role", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SUPER_ADMIN">Super Admin</SelectItem>
                      <SelectItem value="HQ_EXECUTIVE">HQ Executive</SelectItem>
                      <SelectItem value="HQ_ANALYTICS">HQ Analytics</SelectItem>
                      <SelectItem value="REGIONAL_MANAGER">Regional Manager</SelectItem>
                      <SelectItem value="ICR">ICR</SelectItem>
                      <SelectItem value="HR_MANAGER">HR Manager</SelectItem>
                      <SelectItem value="EMPLOYEE">Employee</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Region</Label>
                  <Select value={form.regionId} onValueChange={(v) => set("regionId", v)}>
                    <SelectTrigger><SelectValue placeholder="No region" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No region</SelectItem>
                      {regions.map((r) => (
                        <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          )}
          {isHR && (
            <>
              <div className="space-y-1.5">
                <Label>Job Title</Label>
                <Input value={form.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Date of Joining</Label>
                <Input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => set("startDate", e.target.value)}
                />
                {form.startDate !== (initial.startDate?.slice(0, 10) ?? "") && (
                  <p className="text-xs text-amber-600">
                    Changing this recalculates leave entitlement immediately, including
                    days already accrued. The change is recorded in the activity log.
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Employment Type</Label>
                  <Select value={form.employmentType} onValueChange={(v) => set("employmentType", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FULL_TIME">Full-time</SelectItem>
                      <SelectItem value="PART_TIME">Part-time</SelectItem>
                      <SelectItem value="CONTRACT">Contract</SelectItem>
                      <SelectItem value="INTERN">Intern</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Gender</Label>
                  <Select value={form.gender} onValueChange={(v) => set("gender", v)}>
                    <SelectTrigger><SelectValue placeholder="Not recorded" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not recorded</SelectItem>
                      <SelectItem value="FEMALE">Female</SelectItem>
                      <SelectItem value="MALE">Male</SelectItem>
                      <SelectItem value="OTHER">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  {form.gender === "none" && (
                    <p className="text-xs text-amber-600">
                      Maternity and paternity leave stay blocked until this is set.
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>Department</Label>
                  <Select value={form.departmentId} onValueChange={(v) => set("departmentId", v)}>
                    <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {departments.map((d) => (
                        <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Manager</Label>
                <Select value={form.managerId} onValueChange={(v) => set("managerId", v)}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {managers.filter((m) => m.id !== employeeId).map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.user.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={form.isActive} onCheckedChange={(v) => set("isActive", v)} id="isActive" />
                <Label htmlFor="isActive">Active</Label>
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label>Phone</Label>
            <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+60 12 345 6789" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Emergency Contact</Label>
              <Input value={form.emergencyContact} onChange={(e) => set("emergencyContact", e.target.value)} placeholder="Contact name" />
            </div>
            <div className="space-y-1.5">
              <Label>Emergency Phone</Label>
              <Input value={form.emergencyPhone} onChange={(e) => set("emergencyPhone", e.target.value)} placeholder="+60 12 345 6789" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Address</Label>
            <Input value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="Full address" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={loading}>{loading ? "Saving..." : "Save Changes"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
