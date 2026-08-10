"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const schema = z.object({
  // User info
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email(),
  // Password is NOT collected here: the API generates a strong temp password
  // and emails a magic link so the employee sets their own via /reset-password
  // (which enforces 12-char + 4-class complexity). Asking HR to type one only
  // meant a weaker password than the reset flow would accept, and it was
  // silently thrown away by the API anyway.
  role: z.string(),
  regionId: z.string().optional(),
  // Employee info
  jobTitle: z.string().min(2),
  departmentId: z.string().optional(),
  employmentType: z.string(),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional(),
  startDate: z.string(),
  managerId: z.string().optional(),
  phone: z.string().optional(),
  emergencyContact: z.string().optional(),
  emergencyPhone: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.role !== "SUPER_ADMIN" && !data.managerId) {
    ctx.addIssue({
      path: ["managerId"],
      code: z.ZodIssueCode.custom,
      message: "Manager is required",
    });
  }
});

type FormValues = z.infer<typeof schema>;

interface Region {
  id: string;
  name: string;
}

interface Manager {
  id: string;
  employeeId: string;
  user: { name: string | null; email: string };
  jobTitle: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function EmployeeForm({ open, onClose, onSuccess }: Props) {
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [regions, setRegions] = useState<Region[]>([]);
  const [managers, setManagers] = useState<Manager[]>([]);
  const { register, handleSubmit, setValue, watch, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema) as never,
    defaultValues: { role: "EMPLOYEE", employmentType: "FULL_TIME" },
  });

  const selectedRole = watch("role");

  useEffect(() => {
    fetch("/api/hr/regions")
      .then((r) => r.json())
      .then((json) => setRegions(json.regions ?? []));
    fetch("/api/hr/employees?limit=200")
      .then((r) => r.json())
      .then((json) => setManagers(json.employees ?? []));
  }, []);

  async function onSubmit(values: FormValues) {
    const res = await fetch("/api/hr/employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    const data = await res.json();
    if (!res.ok) {
      toast({ title: "Error", description: data.error || "Failed to create employee", variant: "destructive" });
      return;
    }
    toast({
      title: "Employee created",
      description: `${values.firstName} ${values.lastName} has been added.`,
    });
    onSuccess();
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add New Employee</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground font-medium">Step 1: Account Details</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>First Name *</Label>
                  <Input {...register("firstName")} placeholder="John" />
                  {errors.firstName && <p className="text-xs text-destructive">{errors.firstName.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label>Last Name *</Label>
                  <Input {...register("lastName")} placeholder="Smith" />
                  {errors.lastName && <p className="text-xs text-destructive">{errors.lastName.message}</p>}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Email *</Label>
                <Input {...register("email")} type="email" placeholder="john@illume.edu" />
                {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 dark:bg-slate-900/40 dark:border-slate-800 p-3 text-xs text-slate-600 dark:text-slate-400">
                <p className="font-medium text-slate-700 dark:text-slate-200">Password setup</p>
                <p className="mt-1">
                  The employee receives a secure magic-link email and sets their own
                  password. Passwords must be at least 12 characters with upper, lower,
                  number and special-character classes.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select defaultValue="EMPLOYEE" onValueChange={(v) => setValue("role", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="EMPLOYEE">Employee</SelectItem>
                    <SelectItem value="ICR">ICR</SelectItem>
                    <SelectItem value="REGIONAL_MANAGER">Regional Manager</SelectItem>
                    <SelectItem value="HR_MANAGER">HR Manager</SelectItem>
                    <SelectItem value="HQ_ANALYTICS">HQ Analytics</SelectItem>
                    <SelectItem value="HQ_EXECUTIVE">HQ Executive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Region</Label>
                <Select onValueChange={(v) => setValue("regionId", v === "none" ? undefined : v)}>
                  <SelectTrigger><SelectValue placeholder="Select region (optional)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No region</SelectItem>
                    {regions.map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="button" className="w-full" onClick={() => setStep(2)}>
                Next: Employee Details →
              </Button>
            </div>
          )}
          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground font-medium">Step 2: Employee Details</p>
              <div className="space-y-2">
                <Label>Job Title *</Label>
                <Input {...register("jobTitle")} placeholder="e.g. Student Recruitment Manager" />
                {errors.jobTitle && <p className="text-xs text-destructive">{errors.jobTitle.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>
                  Manager {selectedRole !== "SUPER_ADMIN" && <span className="text-destructive">*</span>}
                </Label>
                <Select onValueChange={(v) => setValue("managerId", v === "none" ? undefined : v)}>
                  <SelectTrigger>
                    <SelectValue placeholder={selectedRole === "SUPER_ADMIN" ? "No manager (Super Admin)" : "Select manager"} />
                  </SelectTrigger>
                  <SelectContent>
                    {selectedRole === "SUPER_ADMIN" && (
                      <SelectItem value="none">No manager</SelectItem>
                    )}
                    {managers.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.user.name ?? m.user.email} — {m.jobTitle}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(errors as Record<string, { message?: string }>).managerId && (
                  <p className="text-xs text-destructive">
                    {(errors as Record<string, { message?: string }>).managerId?.message}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Employment Type</Label>
                  <Select defaultValue="FULL_TIME" onValueChange={(v) => setValue("employmentType", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FULL_TIME">Full-time</SelectItem>
                      <SelectItem value="PART_TIME">Part-time</SelectItem>
                      <SelectItem value="CONTRACT">Contract</SelectItem>
                      <SelectItem value="INTERN">Intern</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Start Date *</Label>
                  <Input {...register("startDate")} type="date" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Gender</Label>
                  <Select onValueChange={(v) => setValue("gender", v as FormValues["gender"])}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FEMALE">Female</SelectItem>
                      <SelectItem value="MALE">Male</SelectItem>
                      <SelectItem value="OTHER">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  {/* Says why it is being collected, rather than asking without
                      explanation. */}
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    Determines maternity and paternity leave eligibility.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input {...register("phone")} placeholder="+60 12 345 6789" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Emergency Contact</Label>
                  <Input {...register("emergencyContact")} placeholder="Contact name" />
                </div>
                <div className="space-y-2">
                  <Label>Emergency Phone</Label>
                  <Input {...register("emergencyPhone")} placeholder="+60 12 345 6789" />
                </div>
              </div>
              <DialogFooter className="gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setStep(1)}>← Back</Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Creating..." : "Create Employee"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
