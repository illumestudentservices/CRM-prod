"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { Lead, Source, Institution, User } from "@prisma/client";

// ─── Schema ───────────────────────────────────────────────────────────────────

const leadSchema = z.object({
  fullName: z.string().min(2, "Full name is required"),
  email: z.string().email("Invalid email address"),
  phone: z.string().min(7, "Phone number is required"),
  nationality: z.string().min(1, "Nationality is required"),
  countryOfResidence: z.string().min(1, "Country of residence is required"),
  interestedProgram: z.string().min(2, "Program is required"),
  faculty: z.string().optional(),
  studyLevel: z.enum(["UNDERGRADUATE", "POSTGRADUATE", "PATHWAY", "FOUNDATION"]),
  intakeYear: z.coerce.number().min(2020).max(2035),
  intakeMonth: z.coerce.number().min(1).max(12),
  sourceId: z.string().optional(),
  institutionId: z.string().optional(),
  assignedICRId: z.string().optional(),
  notes: z.string().optional(),

  // Pipeline capture. Optional here on purpose: the stage gate decides when
  // each one becomes mandatory, so requiring them at creation would block a
  // lead being captured at all. Without these inputs the gate can ask for a
  // field the user has no way to fill in.
  intendedDestination: z.string().optional(),
  preferredCountry: z.string().optional(),
  budgetRange: z.string().optional(),
  currentQualification: z.string().optional(),
  counsellingOutcome: z.string().optional(),
  academicQualification: z.string().optional(),
  englishStatus: z.string().optional(),
  enrolmentDate: z.string().optional(),
});

type LeadFormValues = z.infer<typeof leadSchema>;

// Mirrors the BudgetRange and EnglishStatus enums. Values must match exactly —
// the API validates against the same enums and silently rejecting a typo here
// would look like the field simply not saving.
const BUDGET_RANGES = [
  { value: "UNDER_10K", label: "Under $10,000" },
  { value: "FROM_10K_TO_20K", label: "$10,000 - $20,000" },
  { value: "FROM_20K_TO_35K", label: "$20,000 - $35,000" },
  { value: "FROM_35K_TO_50K", label: "$35,000 - $50,000" },
  { value: "OVER_50K", label: "Over $50,000" },
  { value: "UNDECIDED", label: "Undecided" },
] as const;

const ENGLISH_STATUSES = [
  { value: "IELTS", label: "IELTS" },
  { value: "TOEFL", label: "TOEFL" },
  { value: "PTE", label: "PTE" },
  { value: "DUOLINGO", label: "Duolingo" },
  { value: "MOI", label: "Medium of Instruction letter" },
  { value: "NATIVE_SPEAKER", label: "Native speaker" },
  { value: "NOT_TAKEN", label: "Not taken yet" },
  { value: "EXEMPT", label: "Exempt" },
] as const;

// ─── Constants ────────────────────────────────────────────────────────────────

const STUDY_LEVELS = [
  { value: "UNDERGRADUATE", label: "Undergraduate" },
  { value: "POSTGRADUATE", label: "Postgraduate" },
  { value: "PATHWAY", label: "Pathway" },
  { value: "FOUNDATION", label: "Foundation" },
] as const;

const MONTHS = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];

// ─── Field component ──────────────────────────────────────────────────────────

function FormField({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-slate-700">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </Label>
      {children}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface LeadFormProps {
  open: boolean;
  onClose: () => void;
  lead?: Lead | null;
  sources?: Pick<Source, "id" | "name">[];
  institutions?: Pick<Institution, "id" | "name">[];
  icrUsers?: Pick<User, "id" | "name">[];
  onSaved?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LeadForm({
  open,
  onClose,
  lead,
  sources = [],
  institutions = [],
  icrUsers = [],
  onSaved,
}: LeadFormProps) {
  const { toast } = useToast();
  const [isDuplicateWarning, setIsDuplicateWarning] = React.useState(false);
  const isEdit = !!lead;

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<LeadFormValues>({
    resolver: zodResolver(leadSchema) as never,
    defaultValues: {
      fullName: lead?.fullName ?? "",
      email: lead?.email ?? "",
      phone: lead?.phone ?? "",
      nationality: lead?.nationality ?? "",
      countryOfResidence: lead?.countryOfResidence ?? "",
      interestedProgram: lead?.interestedProgram ?? "",
      faculty: lead?.faculty ?? "",
      studyLevel: (lead?.studyLevel as LeadFormValues["studyLevel"]) ?? "UNDERGRADUATE",
      intakeYear: lead?.intakeYear ?? new Date().getFullYear() + 1,
      intakeMonth: lead?.intakeMonth ?? 9,
      sourceId: lead?.sourceId ?? undefined,
      institutionId: lead?.institutionId ?? undefined,
      assignedICRId: lead?.assignedICRId ?? undefined,
      notes: lead?.notes ?? "",
      intendedDestination: lead?.intendedDestination ?? "",
      preferredCountry: lead?.preferredCountry ?? "",
      budgetRange: lead?.budgetRange ?? undefined,
      currentQualification: lead?.currentQualification ?? "",
      counsellingOutcome: lead?.counsellingOutcome ?? "",
      academicQualification: lead?.academicQualification ?? "",
      englishStatus: lead?.englishStatus ?? undefined,
      enrolmentDate: lead?.enrolmentDate
        ? new Date(lead.enrolmentDate).toISOString().slice(0, 10)
        : "",
    },
  });

  // Reset when lead changes
  React.useEffect(() => {
    if (open) {
      reset({
        fullName: lead?.fullName ?? "",
        email: lead?.email ?? "",
        phone: lead?.phone ?? "",
        nationality: lead?.nationality ?? "",
        countryOfResidence: lead?.countryOfResidence ?? "",
        interestedProgram: lead?.interestedProgram ?? "",
        faculty: lead?.faculty ?? "",
        studyLevel: (lead?.studyLevel as LeadFormValues["studyLevel"]) ?? "UNDERGRADUATE",
        intakeYear: lead?.intakeYear ?? new Date().getFullYear() + 1,
        intakeMonth: lead?.intakeMonth ?? 9,
        sourceId: lead?.sourceId ?? undefined,
        institutionId: lead?.institutionId ?? undefined,
        assignedICRId: lead?.assignedICRId ?? undefined,
        notes: lead?.notes ?? "",
        intendedDestination: lead?.intendedDestination ?? "",
        preferredCountry: lead?.preferredCountry ?? "",
        budgetRange: lead?.budgetRange ?? undefined,
        currentQualification: lead?.currentQualification ?? "",
        counsellingOutcome: lead?.counsellingOutcome ?? "",
        academicQualification: lead?.academicQualification ?? "",
        englishStatus: lead?.englishStatus ?? undefined,
        enrolmentDate: lead?.enrolmentDate
          ? new Date(lead.enrolmentDate).toISOString().slice(0, 10)
          : "",
      });
      setIsDuplicateWarning(false);
    }
  }, [open, lead, reset]);

  async function onSubmit(values: LeadFormValues) {
    try {
      const url = isEdit ? `/api/leads/${lead!.id}` : "/api/leads";
      const method = isEdit ? "PATCH" : "POST";

      // Strip empty/"none" optional UUID fields so they don't fail uuid() validation
      const cleanId = (v?: string) => (v && v !== "none" ? v : undefined);

      // An untouched optional field arrives as "", which the API rejects: those
      // columns are min(1).optional().nullable(), so an empty string is not the
      // same as "not provided". Send null to clear it instead.
      const orNull = (v?: string) => (v && v.trim() !== "" ? v.trim() : null);
      // Enums must be omitted rather than nulled to "": the API validates
      // against a literal set and anything else is a 422.
      const orUndefined = (v?: string) => (v && v !== "none" ? v : undefined);

      const payload = {
        ...values,
        sourceId: cleanId(values.sourceId),
        institutionId: cleanId(values.institutionId),
        assignedICRId: cleanId(values.assignedICRId),

        intendedDestination: orNull(values.intendedDestination),
        preferredCountry: orNull(values.preferredCountry),
        currentQualification: orNull(values.currentQualification),
        counsellingOutcome: orNull(values.counsellingOutcome),
        academicQualification: orNull(values.academicQualification),
        budgetRange: orUndefined(values.budgetRange),
        englishStatus: orUndefined(values.englishStatus),
        // The date input yields "YYYY-MM-DD"; the API wants a full ISO datetime.
        enrolmentDate: values.enrolmentDate
          ? new Date(`${values.enrolmentDate}T00:00:00.000Z`).toISOString()
          : null,
      };

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        // Surface first validation detail if available
        const firstDetail = data.details?.fieldErrors
          ? Object.entries(data.details.fieldErrors as Record<string, string[]>)
              .map(([field, msgs]) => `${field}: ${msgs[0]}`)
              .join(", ")
          : null;
        throw new Error(firstDetail ?? data.error ?? "Something went wrong");
      }

      // API returns `warning` key when a duplicate is detected (POST) or data.isDuplicate (PATCH)
      if (data.warning || data.isDuplicate || data.data?.isDuplicate) {
        setIsDuplicateWarning(true);
      }

      toast({
        title: isEdit ? "Lead updated" : "Lead created",
        description: isEdit
          ? `${values.fullName} has been updated.`
          : `${values.fullName} has been added to the pipeline.`,
        variant: "success",
      });

      onSaved?.();
      onClose();
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to save lead.",
        variant: "destructive",
      });
    }
  }

  const currentStudyLevel = watch("studyLevel");
  const currentSourceId = watch("sourceId");
  const currentInstitutionId = watch("institutionId");
  const currentAssignedICRId = watch("assignedICRId");
  const currentIntakeMonth = watch("intakeMonth");

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Lead" : "Add New Lead"}</DialogTitle>
        </DialogHeader>

        {isDuplicateWarning && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-800">Possible duplicate detected</p>
              <p className="text-xs text-amber-700 mt-0.5">
                A lead with a similar email or name already exists in the system.
              </p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {/* Personal information */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">
              Personal Information
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="Full Name" required error={errors.fullName?.message}>
                <Input {...register("fullName")} placeholder="John Doe" />
              </FormField>

              <FormField label="Email" required error={errors.email?.message}>
                <Input {...register("email")} type="email" placeholder="john@example.com" />
              </FormField>

              <FormField label="Phone" required error={errors.phone?.message}>
                <Input {...register("phone")} placeholder="+1 234 567 8900" />
              </FormField>

              <FormField label="Nationality" required error={errors.nationality?.message}>
                <Input {...register("nationality")} placeholder="e.g. Nigerian" />
              </FormField>

              <FormField
                label="Country of Residence"
                required
                error={errors.countryOfResidence?.message}
              >
                <Input {...register("countryOfResidence")} placeholder="e.g. Nigeria" />
              </FormField>
            </div>
          </div>

          {/* Academic information */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">
              Academic Information
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                label="Interested Program"
                required
                error={errors.interestedProgram?.message}
              >
                <Input
                  {...register("interestedProgram")}
                  placeholder="e.g. Business Administration"
                />
              </FormField>

              <FormField label="Faculty" error={errors.faculty?.message}>
                <Input {...register("faculty")} placeholder="e.g. Business & Management" />
              </FormField>

              <FormField label="Study Level" required error={errors.studyLevel?.message}>
                <Select
                  value={currentStudyLevel}
                  onValueChange={(v) =>
                    setValue("studyLevel", v as LeadFormValues["studyLevel"], {
                      shouldValidate: true,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select level..." />
                  </SelectTrigger>
                  <SelectContent>
                    {STUDY_LEVELS.map((l) => (
                      <SelectItem key={l.value} value={l.value}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>

              <FormField label="Intake Month" required error={errors.intakeMonth?.message}>
                <Select
                  value={String(currentIntakeMonth)}
                  onValueChange={(v) =>
                    setValue("intakeMonth", Number(v), { shouldValidate: true })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select month..." />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m) => (
                      <SelectItem key={m.value} value={String(m.value)}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>

              <FormField label="Intake Year" required error={errors.intakeYear?.message}>
                <Input
                  {...register("intakeYear", { valueAsNumber: true })}
                  type="number"
                  min={2020}
                  max={2035}
                  placeholder="2025"
                />
              </FormField>
            </div>
          </div>

          {/* Pipeline capture — every field the stage gate can ask for */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">
              Pipeline Details
            </h3>
            <p className="text-xs text-slate-400 -mt-2 mb-3">
              Filled in as the student progresses. Each stage asks only for what
              it needs.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="Intended Destination">
                <Input
                  {...register("intendedDestination")}
                  placeholder="e.g. United Kingdom"
                />
              </FormField>

              <FormField label="Preferred Country">
                <Input
                  {...register("preferredCountry")}
                  placeholder="Confirmed after counselling"
                />
              </FormField>

              <FormField label="Budget Range">
                <Select
                  value={watch("budgetRange") ?? "none"}
                  onValueChange={(v) =>
                    setValue("budgetRange", v === "none" ? undefined : v)
                  }
                >
                  <SelectTrigger><SelectValue placeholder="Not discussed yet" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not discussed yet</SelectItem>
                    {BUDGET_RANGES.map((b) => (
                      <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>

              <FormField label="Current Qualification">
                <Input
                  {...register("currentQualification")}
                  placeholder="e.g. BSc Computer Science"
                />
              </FormField>

              <FormField label="Highest Academic Qualification">
                <Input
                  {...register("academicQualification")}
                  placeholder="e.g. BSc 2:1"
                />
              </FormField>

              <FormField label="English Proficiency">
                <Select
                  value={watch("englishStatus") ?? "none"}
                  onValueChange={(v) =>
                    setValue("englishStatus", v === "none" ? undefined : v)
                  }
                >
                  <SelectTrigger><SelectValue placeholder="Not recorded" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not recorded</SelectItem>
                    {ENGLISH_STATUSES.map((e) => (
                      <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>

              <FormField label="Enrolment Date">
                <Input type="date" {...register("enrolmentDate")} />
              </FormField>

              <div className="sm:col-span-2">
                <FormField label="Counselling Outcome">
                  <Textarea
                    rows={2}
                    {...register("counsellingOutcome")}
                    placeholder="What was agreed on the counselling call?"
                  />
                </FormField>
              </div>
            </div>
          </div>

          {/* Assignment & Source */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">
              Assignment & Source
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {sources.length > 0 && (
                <FormField label="Source" error={errors.sourceId?.message}>
                  <Select
                    value={currentSourceId ?? "none"}
                    onValueChange={(v) =>
                      setValue("sourceId", v === "none" ? undefined : v)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select source..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No source</SelectItem>
                      {sources.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              )}

              {institutions.length > 0 && (
                <FormField label="Institution" error={errors.institutionId?.message}>
                  <Select
                    value={currentInstitutionId ?? "none"}
                    onValueChange={(v) =>
                      setValue("institutionId", v === "none" ? undefined : v)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select institution..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No institution</SelectItem>
                      {institutions.map((i) => (
                        <SelectItem key={i.id} value={i.id}>
                          {i.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              )}

              {icrUsers.length > 0 && (
                <FormField label="Assigned ICR" error={errors.assignedICRId?.message}>
                  <Select
                    value={currentAssignedICRId ?? "none"}
                    onValueChange={(v) =>
                      setValue("assignedICRId", v === "none" ? undefined : v)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select ICR..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Unassigned</SelectItem>
                      {icrUsers.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              )}
            </div>
          </div>

          {/* Notes */}
          <FormField label="Notes" error={errors.notes?.message}>
            <Textarea
              {...register("notes")}
              placeholder="Any additional notes about this lead..."
              rows={3}
            />
          </FormField>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} className="gap-2">
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEdit ? "Save Changes" : "Add Lead"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
