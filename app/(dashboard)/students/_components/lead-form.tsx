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
import type { Lead, RecruitmentPartner, Institution, User } from "@prisma/client";
import { displayName } from "@/lib/person-name";
import {
  BUDGET_RANGES,
  COUNSELLING_OUTCOMES,
  ENGLISH_STATUSES,
  STUDY_LEVELS,
  MONTHS,
} from "@/lib/lead-options";

// ─── Schema ───────────────────────────────────────────────────────────────────

const leadSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address"),
  phone: z.string().min(7, "Phone number is required"),
  nationality: z.string().min(1, "Nationality is required"),
  countryOfResidence: z.string().min(1, "Country of residence is required"),
  // Spec §2 (Student Pipeline) — dedup keys captured at creation when
  // available. Both nullable — event capture often can't collect them.
  dateOfBirth: z.string().optional(),
  passportNumber: z.string().optional(),
  // Spec Recruitment Network — how the lead reached us. Optional to keep
  // capture fast; the pipeline gate can flag it later.
  channel: z.string().optional(),
  interestedProgram: z.string().min(2, "Program is required"),
  faculty: z.string().optional(),
  studyLevel: z.enum(["UNDERGRADUATE", "POSTGRADUATE", "PATHWAY", "FOUNDATION"]),
  intakeYear: z.coerce.number().min(2020).max(2035),
  intakeMonth: z.coerce.number().min(1).max(12),
  sourceId: z.string().optional(),
  institutionId: z.string().optional(),
  assignedICRId: z.string().optional(),
  notes: z.string().optional(),
  /// "" = not asked. Mapped to true/false/undefined on submit, never to a
  /// default — an unanswered question is not a refusal.
  marketingConsent: z.enum(["", "yes", "no"]).optional(),

  // Pipeline capture. Optional here on purpose: the stage gate decides when
  // each one becomes mandatory, so requiring them at creation would block a
  // lead being captured at all. Without these inputs the gate can ask for a
  // field the user has no way to fill in.
  intendedDestination: z.string().optional(),
  preferredCountry: z.string().optional(),
  budgetRange: z.string().optional(),
  currentQualification: z.string().optional(),
  counsellingOutcome: z.string().optional(),
  counsellingOutcomeEnum: z.string().optional(),
  academicQualification: z.string().optional(),
  englishStatus: z.string().optional(),
  enrolmentDate: z.string().optional(),
});

type LeadFormValues = z.infer<typeof leadSchema>;

// ─── Match check panel ───────────────────────────────────────────────────────
// Spec §2 — before creating a new Student Profile, search existing profiles.
// The panel debounces the current form values, calls /api/leads/find-matches,
// and surfaces candidates as clickable rows. Auto-hides when the form is in
// edit mode (there's already a profile).

interface MatchRow {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  countryOfResidence: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  matchedOn: string[];
  interestCount: number;
  currentOwner: { id: string; name: string | null } | null;
}

function MatchCheckPanel({
  enabled,
  firstName,
  lastName,
  email,
  phone,
  countryOfResidence,
  dateOfBirth,
  passportNumber,
}: {
  enabled: boolean;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  countryOfResidence?: string;
  dateOfBirth?: string;
  passportNumber?: string;
}) {
  const [matches, setMatches] = React.useState<MatchRow[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!enabled) {
      setMatches([]);
      return;
    }
    // Require at least one strong signal before hitting the endpoint.
    const hasSignal =
      (email && email.length > 3) ||
      (phone && phone.length > 5) ||
      (passportNumber && passportNumber.length >= 3) ||
      (firstName && lastName && firstName.length > 1 && lastName.length > 1);
    if (!hasSignal) {
      setMatches([]);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/leads/find-matches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            firstName,
            lastName,
            email,
            phone,
            countryOfResidence,
            dateOfBirth: dateOfBirth
              ? new Date(`${dateOfBirth}T00:00:00.000Z`).toISOString()
              : undefined,
            passportNumber,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setMatches(data.matches ?? []);
        }
      } catch {
        /* ignore — non-fatal */
      } finally {
        setLoading(false);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [enabled, firstName, lastName, email, phone, countryOfResidence, dateOfBirth, passportNumber]);

  if (!enabled || matches.length === 0) return null;

  const badgeColour = (c: MatchRow["confidence"]) =>
    c === "HIGH"
      ? "bg-red-100 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30"
      : c === "MEDIUM"
      ? "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30"
      : "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700";

  return (
    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/50 dark:border-amber-500/30 dark:bg-amber-500/10 p-3">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
          {matches.length} possible existing student{matches.length === 1 ? "" : "s"}
          {loading ? " (searching…)" : ""}
        </p>
      </div>
      <p className="text-xs text-amber-800 dark:text-amber-300 mb-2">
        Open an existing record to add a new Institution Interest instead of creating a duplicate profile.
      </p>
      <ul className="space-y-1.5">
        {matches.slice(0, 5).map((m) => (
          <li key={m.id} className="flex items-start gap-2 rounded border border-amber-200 bg-white dark:border-amber-500/30 dark:bg-slate-900 p-2 text-xs">
            <span className={cn("inline-flex items-center rounded border px-1.5 py-0.5 font-semibold uppercase tracking-wide", badgeColour(m.confidence))}>
              {m.confidence}
            </span>
            <div className="flex-1">
              <a
                href={`/students/${m.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-slate-900 dark:text-slate-100 hover:underline"
              >
                {m.displayName}
              </a>
              <div className="text-slate-500 dark:text-slate-400">
                {m.email ?? "no email"} · {m.phone ?? "no phone"} · {m.countryOfResidence} · {m.interestCount} interest{m.interestCount === 1 ? "" : "s"}
                {m.currentOwner?.name && <> · owned by {m.currentOwner.name}</>}
              </div>
              <div className="text-slate-400 dark:text-slate-500">Matched on: {m.matchedOn.join(", ")}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

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
      <Label className="text-xs font-medium text-slate-700 dark:text-slate-300">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </Label>
      {children}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface LeadFormProps {
  open: boolean;
  onClose: () => void;
  lead?: Lead | null;
  sources?: Pick<RecruitmentPartner, "id" | "name">[];
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
      firstName: lead?.firstName ?? "",
      lastName: lead?.lastName ?? "",
      email: lead?.email ?? "",
      phone: lead?.phone ?? "",
      nationality: lead?.nationality ?? "",
      countryOfResidence: lead?.countryOfResidence ?? "",
      dateOfBirth: lead?.dateOfBirth
        ? new Date(lead.dateOfBirth).toISOString().slice(0, 10)
        : "",
      passportNumber: lead?.passportNumber ?? "",
      channel: lead?.channel ?? "",
      interestedProgram: lead?.interestedProgram ?? "",
      faculty: lead?.faculty ?? "",
      studyLevel: (lead?.studyLevel as LeadFormValues["studyLevel"]) ?? "UNDERGRADUATE",
      intakeYear: lead?.intakeYear ?? new Date().getFullYear() + 1,
      intakeMonth: lead?.intakeMonth ?? 9,
      sourceId: lead?.sourceId ?? undefined,
      institutionId: lead?.institutionId ?? undefined,
      assignedICRId: lead?.assignedICRId ?? undefined,
      notes: lead?.notes ?? "",
      marketingConsent:
        lead?.marketingConsent === true ? "yes" : lead?.marketingConsent === false ? "no" : "",
      intendedDestination: lead?.intendedDestination ?? "",
      preferredCountry: lead?.preferredCountry ?? "",
      budgetRange: lead?.budgetRange ?? undefined,
      currentQualification: lead?.currentQualification ?? "",
      counsellingOutcome: lead?.counsellingOutcome ?? "",
      counsellingOutcomeEnum: lead?.counsellingOutcomeEnum ?? undefined,
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
        firstName: lead?.firstName ?? "",
        lastName: lead?.lastName ?? "",
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
      counsellingOutcomeEnum: lead?.counsellingOutcomeEnum ?? undefined,
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

        // Spec §2 — DOB is captured as YYYY-MM-DD from the date input; the API
        // wants an ISO datetime. Passport is a bare string.
        dateOfBirth: values.dateOfBirth
          ? new Date(`${values.dateOfBirth}T00:00:00.000Z`).toISOString()
          : undefined,
        passportNumber: orNull(values.passportNumber),
        channel: orUndefined(values.channel),

        intendedDestination: orNull(values.intendedDestination),
        preferredCountry: orNull(values.preferredCountry),
        currentQualification: orNull(values.currentQualification),
        counsellingOutcome: orNull(values.counsellingOutcome),
        counsellingOutcomeEnum: orUndefined(values.counsellingOutcomeEnum),
        academicQualification: orNull(values.academicQualification),
        budgetRange: orUndefined(values.budgetRange),
        englishStatus: orUndefined(values.englishStatus),
        // The date input yields "YYYY-MM-DD"; the API wants a full ISO datetime.
        enrolmentDate: values.enrolmentDate
          ? new Date(`${values.enrolmentDate}T00:00:00.000Z`).toISOString()
          : null,
        // "" means the question was not put to them, which the API stores as
        // NULL. Sending false would record a refusal that never happened.
        marketingConsent:
          !values.marketingConsent ? undefined : values.marketingConsent === "yes",
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
          ? `${displayName(values)} has been updated.`
          : `${displayName(values)} has been added to the pipeline.`,
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
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/30 p-3">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Possible duplicate detected</p>
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                A lead with a similar email or name already exists in the system.
              </p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {/* Personal information */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3">
              Personal Information
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="First Name" required error={errors.firstName?.message}>
                <Input {...register("firstName")} placeholder="Nkechi" />
              </FormField>
              <FormField label="Last Name" required error={errors.lastName?.message}>
                <Input {...register("lastName")} placeholder="Obi" />
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

              {/* Spec §2 — DOB and passport are the strongest identity signals
                  for duplicate detection. Both are optional at capture. */}
              <FormField label="Date of Birth" error={errors.dateOfBirth?.message}>
                <Input {...register("dateOfBirth")} type="date" />
              </FormField>

              <FormField label="Passport Number" error={errors.passportNumber?.message}>
                <Input {...register("passportNumber")} placeholder="Optional" />
              </FormField>

              {/* Spec Recruitment Network — how the lead reached us. */}
              <FormField label="Lead Channel" error={errors.channel?.message}>
                <Select
                  value={watch("channel") || ""}
                  onValueChange={(v) => setValue("channel", v, { shouldValidate: true })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select channel..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AGENT_REFERRAL">Agent Referral</SelectItem>
                    <SelectItem value="SCHOOL_REFERRAL">School Referral</SelectItem>
                    <SelectItem value="WEBSITE">Website</SelectItem>
                    <SelectItem value="WALK_IN">Walk-in</SelectItem>
                    <SelectItem value="STUDENT_REFERRAL">Student Referral</SelectItem>
                    <SelectItem value="STAFF_REFERRAL">Staff Referral</SelectItem>
                    <SelectItem value="GOOGLE_ADS">Google Ads</SelectItem>
                    <SelectItem value="META_ADS">Meta Ads</SelectItem>
                    <SelectItem value="ORGANIC_SOCIAL">Organic Social</SelectItem>
                    <SelectItem value="QR_CODE">QR Code</SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
            </div>

            <MatchCheckPanel
              enabled={!isEdit}
              firstName={watch("firstName")}
              lastName={watch("lastName")}
              email={watch("email")}
              phone={watch("phone")}
              countryOfResidence={watch("countryOfResidence")}
              dateOfBirth={watch("dateOfBirth")}
              passportNumber={watch("passportNumber")}
            />
          </div>

          {/* Academic information */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3">
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
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3">
              Pipeline Details
            </h3>
            <p className="text-xs text-slate-400 dark:text-slate-500 -mt-2 mb-3">
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

              {/* Spec §5. The free-text box below stays — "how did the call go"
                  still needs colour — but progression past Contacted now turns
                  on this categorical answer, so it cannot be left to prose.
                  "none" rather than "" as the cleared sentinel: Radix reserves
                  the empty string and throws when it is used as an item value. */}
              <FormField label="Counselling Outcome">
                <Select
                  value={watch("counsellingOutcomeEnum") ?? "none"}
                  onValueChange={(v) =>
                    setValue("counsellingOutcomeEnum", v === "none" ? undefined : v)
                  }
                >
                  <SelectTrigger><SelectValue placeholder="Not recorded" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not recorded</SelectItem>
                    {COUNSELLING_OUTCOMES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>

              <div className="sm:col-span-2">
                <FormField label="Counselling Notes">
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
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3">
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

          {/* Anti-spam consent. Present here as well as on the offline form —
              a consent record that only covers event leads is worse than none,
              because it looks like coverage while office-created leads sit
              unrecorded. Three states: unanswered is not a refusal. */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/40 p-3.5 space-y-2">
            <Label className="text-xs font-medium text-slate-700 dark:text-slate-300">May we email them?</Label>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              Canadian anti-spam law requires permission before sending marketing email.
            </p>
            <div className="flex flex-wrap gap-2 pt-0.5">
              {([
                { v: "yes", label: "Yes, they agreed" },
                { v: "no", label: "No, they declined" },
                { v: "", label: "Didn't ask" },
              ] as const).map((o) => (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => setValue("marketingConsent", o.v)}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-xs font-medium border transition-colors",
                    (watch("marketingConsent") ?? "") === o.v
                      ? "bg-[#1E3A5F] text-white border-[#1E3A5F]"
                      : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-700 dark:hover:bg-slate-800/60"
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

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
