"use client";

import * as React from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  CloudOff,
  Cloud,
  Download,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  UserPlus,
  Camera,
  Pencil,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  BUDGET_RANGES,
  COUNSELLING_OUTCOMES,
  ENGLISH_STATUSES,
  LEAD_CHANNELS,
  LEAD_TEMPERATURES,
  STUDY_LEVELS,
  MONTHS,
} from "@/lib/lead-options";
import { COUNTRY_NAME_OPTIONS, NATIONALITY_OPTIONS } from "@/lib/countries";
import { OFFLINE_CAPTURE_LIMIT, OFFLINE_CAPTURE_WARNING } from "@/lib/offline-capture";
import {
  addCapture,
  countCaptures,
  isOfflineStorageAvailable,
  listCaptures,
  loadReference,
  markFailed,
  QueueFullError,
  removeCaptures,
  saveReference,
  updateCapture,
  type OfflineReference,
  type QueuedCapture,
} from "@/lib/offline-queue";
import { BadgeScanner, isScanningSupported } from "./badge-scanner";
import type { ScannedBadge } from "@/lib/badge-scan";

/** Never an empty string: Radix reserves "" and throws on it as an item value. */
const NONE = "none";

interface FormState {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  nationality: string;
  countryOfResidence: string;
  /** "YYYY-MM-DD" from the date input, or "". Converted on the way out. */
  dateOfBirth: string;
  passportNumber: string;
  channel: string;
  interestedProgram: string;
  faculty: string;
  studyLevel: string;
  intakeYear: string;
  intakeMonth: string;
  /**
   * Hot / Warm / Cold, same field the office form asks for.
   *
   * Never required here, exactly as there: an ICR working a booth queue has
   * had one short conversation, and the New Lead gate asks for this before the
   * student can move to Contacted — which is the point at which somebody has
   * actually formed a view.
   */
  leadTemperature: string;
  intendedDestination: string;
  currentQualification: string;
  academicQualification: string;
  /** "YYYY-MM-DD" or "". */
  enrolmentDate: string;
  counsellingOutcomeEnum: string;
  counsellingOutcome: string;
  assignedICRId: string;
  sourceId: string;
  eventId: string;
  institutionId: string;
  preferredCountry: string;
  budgetRange: string;
  englishStatus: string;
  notes: string;
  /** "" = not asked, "yes"/"no" = an answer was actually given. */
  marketingConsent: "" | "yes" | "no";
  /**
   * The other three channels, same tri-state.
   *
   * The office form has asked for all four since spec §1; this page asked only
   * about email, so a lead captured at an event arrived with three channels
   * blank and nobody could tell whether that meant "declined" or "never asked".
   */
  phoneContactConsent: "" | "yes" | "no";
  smsContactConsent: "" | "yes" | "no";
  whatsappContactConsent: "" | "yes" | "no";
  /** Blanket override. A plain boolean: absent genuinely means no instruction. */
  doNotContact: boolean;
}

function emptyForm(): FormState {
  return {
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    nationality: "",
    countryOfResidence: "",
    dateOfBirth: "",
    passportNumber: "",
    channel: NONE,
    interestedProgram: "",
    faculty: "",
    studyLevel: "",
    intakeYear: String(new Date().getFullYear() + 1),
    intakeMonth: "",
    leadTemperature: NONE,
    intendedDestination: "",
    currentQualification: "",
    academicQualification: "",
    enrolmentDate: "",
    counsellingOutcomeEnum: NONE,
    counsellingOutcome: "",
    assignedICRId: NONE,
    sourceId: NONE,
    eventId: NONE,
    institutionId: NONE,
    preferredCountry: "",
    budgetRange: NONE,
    englishStatus: NONE,
    notes: "",
    marketingConsent: "",
    phoneContactConsent: "",
    smsContactConsent: "",
    whatsappContactConsent: "",
    doNotContact: false,
  };
}

/**
 * Checked on the device so an ICR is told at the booth, not on returning to
 * wifi. These mirror the server's rules exactly — a looser check here would let
 * leads queue up that can only fail on upload, hours later, with the student
 * long gone.
 */
function validate(f: FormState): Partial<Record<keyof FormState, string>> {
  const e: Partial<Record<keyof FormState, string>> = {};
  if (!f.firstName.trim()) e.firstName = "Required";
  if (!f.lastName.trim()) e.lastName = "Required";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) e.email = "A valid email is required";
  if (f.phone.trim().length < 6) e.phone = "A phone number is required";
  if (f.nationality.trim().length < 2) e.nationality = "Required";
  if (f.countryOfResidence.trim().length < 2) e.countryOfResidence = "Required";
  if (f.interestedProgram.trim().length < 2) e.interestedProgram = "Required";
  // Consent is compulsory at capture: the student is standing in front of you,
  // so there is no honest "didn't ask". Checked here as well as on screen so a
  // lead cannot be queued unanswered and fail hours later back at the office.
  if (!f.marketingConsent) e.marketingConsent = "Please record their answer";
  if (!f.phoneContactConsent) e.phoneContactConsent = "Please record their answer";
  if (!f.smsContactConsent) e.smsContactConsent = "Please record their answer";
  if (!f.whatsappContactConsent) e.whatsappContactConsent = "Please record their answer";
  if (!f.studyLevel) e.studyLevel = "Required";
  if (!f.intakeMonth) e.intakeMonth = "Required";
  const year = Number(f.intakeYear);
  if (!Number.isInteger(year) || year < 2020 || year > 2035) e.intakeYear = "2020–2035";
  return e;
}

function toPayload(f: FormState): Record<string, unknown> {
  const opt = (v: string) => (v.trim() ? v.trim() : undefined);
  const sel = (v: string) => (v && v !== NONE ? v : undefined);
  return {
    firstName: f.firstName.trim(),
    lastName: f.lastName.trim(),
    email: f.email.trim(),
    phone: f.phone.trim(),
    nationality: f.nationality.trim(),
    countryOfResidence: f.countryOfResidence.trim(),
    dateOfBirth: isoDay(f.dateOfBirth),
    passportNumber: opt(f.passportNumber),
    channel: sel(f.channel),
    interestedProgram: f.interestedProgram.trim(),
    faculty: opt(f.faculty),
    studyLevel: f.studyLevel,
    intakeYear: Number(f.intakeYear),
    intakeMonth: Number(f.intakeMonth),
    leadTemperature: sel(f.leadTemperature),
    intendedDestination: opt(f.intendedDestination),
    currentQualification: opt(f.currentQualification),
    academicQualification: opt(f.academicQualification),
    enrolmentDate: isoDay(f.enrolmentDate),
    counsellingOutcomeEnum: sel(f.counsellingOutcomeEnum),
    counsellingOutcome: opt(f.counsellingOutcome),
    assignedICRId: sel(f.assignedICRId),
    sourceId: sel(f.sourceId),
    eventId: sel(f.eventId),
    institutionId: sel(f.institutionId),
    preferredCountry: opt(f.preferredCountry),
    budgetRange: sel(f.budgetRange),
    englishStatus: sel(f.englishStatus),
    notes: opt(f.notes),
    // Left undefined when unanswered. Sending false would record a refusal
    // nobody gave, and under CASL that is the difference between someone you
    // may still ask and someone you must not contact.
    marketingConsent: f.marketingConsent === "" ? undefined : f.marketingConsent === "yes",
    phoneContactConsent: triBool(f.phoneContactConsent),
    smsContactConsent: triBool(f.smsContactConsent),
    whatsappContactConsent: triBool(f.whatsappContactConsent),
    doNotContact: f.doNotContact,
  };
}

/**
 * "YYYY-MM-DD" from a date input to the ISO datetime the sync route expects.
 *
 * Pinned to midnight UTC rather than built from the device clock. A capture is
 * queued on a tablet at a booth and uploaded somewhere else entirely, so a
 * local-midnight date would shift a birthday by a day between Lagos and
 * Vancouver. The office form sends the same shape for the same reason.
 */
const isoDay = (v: string): string | undefined =>
  v ? new Date(`${v}T00:00:00.000Z`).toISOString() : undefined;

/** Same rule as marketingConsent above: unanswered stays unanswered. */
const triBool = (v: "" | "yes" | "no"): boolean | undefined =>
  v === "" ? undefined : v === "yes";

/** Fills only what the badge actually carried; anything absent is left alone. */
function applyBadge(form: FormState, b: ScannedBadge): FormState {
  return {
    ...form,
    firstName: b.firstName ?? form.firstName,
    lastName: b.lastName ?? form.lastName,
    email: b.email ?? form.email,
    phone: b.phone ?? form.phone,
    nationality: b.nationality ?? form.nationality,
    countryOfResidence: b.countryOfResidence ?? form.countryOfResidence,
    interestedProgram: b.interestedProgram ?? form.interestedProgram,
  };
}

/** Rebuilds the form from a queued lead so a rejected one can be corrected. */
function formFromCapture(data: Record<string, unknown>): FormState {
  const s = (v: unknown) => (v == null ? "" : String(v));
  /** Back to the tri-state the buttons use. Anything not true/false is "not asked". */
  const triState = (v: unknown): "" | "yes" | "no" =>
    v === true ? "yes" : v === false ? "no" : "";
  const sel = (v: unknown) => (v == null || v === "" ? NONE : String(v));
  /** ISO datetime back to the "YYYY-MM-DD" a date input will accept. */
  const day = (v: unknown) => (v == null ? "" : String(v).slice(0, 10));
  return {
    firstName: s(data.firstName),
    lastName: s(data.lastName),
    email: s(data.email),
    phone: s(data.phone),
    nationality: s(data.nationality),
    countryOfResidence: s(data.countryOfResidence),
    dateOfBirth: day(data.dateOfBirth),
    passportNumber: s(data.passportNumber),
    channel: sel(data.channel),
    interestedProgram: s(data.interestedProgram),
    faculty: s(data.faculty),
    studyLevel: s(data.studyLevel),
    intakeYear: s(data.intakeYear) || String(new Date().getFullYear() + 1),
    intakeMonth: s(data.intakeMonth),
    leadTemperature: sel(data.leadTemperature),
    intendedDestination: s(data.intendedDestination),
    currentQualification: s(data.currentQualification),
    academicQualification: s(data.academicQualification),
    enrolmentDate: day(data.enrolmentDate),
    counsellingOutcomeEnum: sel(data.counsellingOutcomeEnum),
    counsellingOutcome: s(data.counsellingOutcome),
    assignedICRId: sel(data.assignedICRId),
    sourceId: sel(data.sourceId),
    eventId: sel(data.eventId),
    institutionId: sel(data.institutionId),
    preferredCountry: s(data.preferredCountry),
    budgetRange: sel(data.budgetRange),
    englishStatus: sel(data.englishStatus),
    notes: s(data.notes),
    marketingConsent: triState(data.marketingConsent),
    phoneContactConsent: triState(data.phoneContactConsent),
    smsContactConsent: triState(data.smsContactConsent),
    whatsappContactConsent: triState(data.whatsappContactConsent),
    doNotContact: data.doNotContact === true,
  };
}

export function OfflineCaptureClient({
  userId,
  userName,
}: {
  userId: string;
  userName: string;
}) {
  const { toast } = useToast();

  const [online, setOnline] = React.useState(true);
  const [storageOk, setStorageOk] = React.useState(true);
  const [scannerOpen, setScannerOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [reference, setReference] = React.useState<OfflineReference | null>(null);
  const [queue, setQueue] = React.useState<QueuedCapture[]>([]);
  const [form, setForm] = React.useState<FormState>(emptyForm);
  const [errors, setErrors] = React.useState<Partial<Record<keyof FormState, string>>>({});
  const [refreshing, setRefreshing] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const reloadQueue = React.useCallback(async () => {
    try {
      setQueue(await listCaptures());
    } catch {
      setStorageOk(false);
    }
  }, []);

  React.useEffect(() => {
    setOnline(navigator.onLine);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  React.useEffect(() => {
    if (!isOfflineStorageAvailable()) {
      setStorageOk(false);
      return;
    }
    loadReference().then(setReference).catch(() => setStorageOk(false));
    reloadQueue();
  }, [reloadQueue]);

  /**
   * Pipeline Details is folded away, exactly as on the office form.
   *
   * It matters more here, not less. This form is filled in at a booth with the
   * student standing in front of the ICR, often watching the tablet — which is
   * the situation the office form only sometimes has. These are the rep's own
   * notes about them: how warm they seem, what they can afford. A rep who knows
   * the student can read it will soften what they put down, and a hedged
   * temperature is worth nothing, because the only thing the field is for is an
   * honest judgement.
   *
   * It re-folds whenever the form is reset — after a save, on cancel, and when
   * a rejected lead is opened for correction — so it is never left standing
   * open in front of the next student in the queue.
   */
  const [pipelineOpen, setPipelineOpen] = React.useState(false);

  function cancelEditing() {
    setEditingId(null);
    setForm(emptyForm());
    setErrors({});
    setPipelineOpen(false);
  }

  function startEditing(q: QueuedCapture) {
    setEditingId(q.captureId);
    setForm(formFromCapture(q.data));
    setErrors({});
    setPipelineOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function refreshReference() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/leads/offline-reference");
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Download failed");
      const data: OfflineReference = await res.json();
      await saveReference(data);
      setReference(data);
      toast({ title: "Ready for offline", description: "Lists saved to this device." });
    } catch (err) {
      toast({
        title: "Could not download lists",
        description: err instanceof Error ? err.message : "Try again while connected.",
        variant: "destructive",
      });
    } finally {
      setRefreshing(false);
    }
  }

  async function saveToDevice(e: React.FormEvent) {
    e.preventDefault();
    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    try {
      if (editingId) {
        // Same captureId, so the corrected lead is still the same lead and a
        // retry cannot land alongside the original. Status returns to pending.
        await updateCapture(editingId, toPayload(form));
        cancelEditing();
        await reloadQueue();
        toast({ title: "Corrected", description: "It will go up with the next upload." });
      } else {
        await addCapture(toPayload(form), userId);
        const next = await countCaptures();
        setForm(emptyForm());
        setErrors({});
        setPipelineOpen(false);
        await reloadQueue();
        toast({
          title: "Saved to this device",
          description: `${next} of ${OFFLINE_CAPTURE_LIMIT} held. Not yet uploaded.`,
        });
      }
    } catch (err) {
      toast({
        title: err instanceof QueueFullError ? "Device is full" : "Could not save",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  /**
   * Uploads everything held and reconciles the device against what the server
   * actually confirmed.
   *
   * Only captureIds the server reports as created or already-held are deleted.
   * Anything it did not mention stays put — a lead removed on an assumption is
   * gone for good, since the device is the only copy.
   */
  async function uploadAll() {
    if (queue.length === 0) return;
    setUploading(true);
    try {
      const res = await fetch("/api/leads/offline-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leads: queue.map((q) => ({
            captureId: q.captureId,
            capturedAt: q.capturedAt,
            ...q.data,
          })),
        }),
      });

      if (res.status === 401) {
        toast({
          title: "Please sign in",
          description: "Your session expired. Nothing was lost — sign in and upload again.",
          variant: "destructive",
        });
        return;
      }
      if (!res.ok) {
        throw new Error((await res.json().catch(() => ({}))).error ?? `Upload failed (${res.status})`);
      }

      const body = await res.json();
      const results: { captureId: string; status: string; error?: string }[] = body.results ?? [];

      const settled = results
        .filter((r) => r.status === "created" || r.status === "already_synced")
        .map((r) => r.captureId);
      await removeCaptures(settled);

      for (const r of results.filter((x) => x.status === "failed")) {
        await markFailed(r.captureId, r.error ?? "Rejected by the server");
      }

      await reloadQueue();

      const { created, alreadySynced, failed } = body.summary;
      toast({
        title: failed > 0 ? "Uploaded with problems" : "Upload complete",
        description:
          `${created} added` +
          (alreadySynced ? `, ${alreadySynced} already there` : "") +
          (failed ? `, ${failed} still on this device — open them to fix` : ""),
        variant: failed > 0 ? "destructive" : undefined,
      });
    } catch (err) {
      toast({
        title: "Upload failed",
        description:
          (err instanceof Error ? err.message : "Unknown error") +
          " — nothing was removed from this device.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  }

  async function discard(captureId: string) {
    await removeCaptures([captureId]);
    await reloadQueue();
    toast({ title: "Removed from this device" });
  }

  const full = queue.length >= OFFLINE_CAPTURE_LIMIT;
  const failedCount = queue.filter((q) => q.status === "failed").length;
  const foreign = queue.filter((q) => q.capturedByUserId && q.capturedByUserId !== userId).length;

  if (!storageOk) {
    return (
      <Card>
        <CardContent className="p-6 text-center space-y-2">
          <CloudOff className="h-8 w-8 mx-auto text-slate-300 dark:text-slate-600" />
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
            This browser cannot store leads offline
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Private or incognito windows block offline storage. Open this page in a normal
            window before the event.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <BadgeScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScanned={(b) => setForm((f) => applyBadge(f, b))}
      />

      {/* Status strip */}
      <div className="flex flex-wrap items-center gap-3">
        <Badge
          variant="outline"
          className={cn(
            "gap-1.5",
            online
              ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/30"
              : "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30"
          )}
        >
          {online ? <Cloud className="h-3 w-3" /> : <CloudOff className="h-3 w-3" />}
          {online ? "Connected" : "No connection"}
        </Badge>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          Capturing as <span className="font-medium text-slate-700 dark:text-slate-300">{userName}</span>
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={refreshReference}
            disabled={!online || refreshing}
            className="gap-1.5"
          >
            {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Prepare for offline
          </Button>
          <Button
            size="sm"
            onClick={uploadAll}
            disabled={!online || uploading || queue.length === 0}
            className="gap-1.5 bg-[#1E3A5F] hover:bg-[#1E3A5F]/90"
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Upload {queue.length > 0 ? `(${queue.length})` : "all"}
          </Button>
        </div>
      </div>

      {/* Readiness / limit warnings */}
      {!reference && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10 px-3.5 py-2.5">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
            <span className="font-semibold">Not ready for offline yet.</span> Tap “Prepare for
            offline” while you still have a connection, or the Source, Event and Institution
            lists will be empty at the booth — and Lead source is required before a lead can
            progress.
          </p>
        </div>
      )}

      {reference && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Lists last downloaded {new Date(reference.generatedAt).toLocaleString("en-GB")} ·{" "}
          {reference.sources.length} sources, {reference.events.length} events,{" "}
          {reference.institutions.length} institutions
        </p>
      )}

      <div className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/40 px-3.5 py-2.5">
        <AlertTriangle className="h-4 w-4 text-slate-500 dark:text-slate-400 shrink-0 mt-0.5" />
        <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">{OFFLINE_CAPTURE_WARNING}</p>
      </div>

      {foreign > 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10 px-3.5 py-2.5">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
            {foreign} lead{foreign === 1 ? " was" : "s were"} captured by someone else on this
            device. Uploading now files {foreign === 1 ? "it" : "them"} under your name.
          </p>
        </div>
      )}

      {/* Capture form */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-4">
            {editingId ? (
              <Pencil className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            ) : (
              <UserPlus className="h-4 w-4 text-[#1E3A5F] dark:text-sky-300" />
            )}
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {editingId ? "Correcting a rejected lead" : "New lead"}
            </h2>
            <div className="ml-auto flex items-center gap-2">
              {editingId && (
                <Button variant="ghost" size="sm" onClick={cancelEditing} className="h-7 gap-1.5 text-xs">
                  <XCircle className="h-3.5 w-3.5" />
                  Cancel
                </Button>
              )}
              {!editingId && isScanningSupported() && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setScannerOpen(true)}
                  className="h-7 gap-1.5 text-xs"
                >
                  <Camera className="h-3.5 w-3.5" />
                  Scan badge
                </Button>
              )}
              {full && !editingId && (
                <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30">
                  Device full
                </Badge>
              )}
            </div>
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
            Both an email and a phone number are needed — ask for both while the student is
            still with you.
          </p>

          <form onSubmit={saveToDevice} className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3">Personal Information</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="First Name" name="firstName" required error={errors.firstName}>
                <Input value={form.firstName} onChange={(e) => set("firstName", e.target.value)} placeholder="Nkechi" />
              </Field>
              <Field label="Last Name" name="lastName" required error={errors.lastName}>
                <Input value={form.lastName} onChange={(e) => set("lastName", e.target.value)} placeholder="Obi" />
              </Field>
              <Field label="Email" name="email" required error={errors.email}>
                <Input type="email" inputMode="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
              </Field>
              <Field label="Phone" name="phone" required error={errors.phone}>
                <Input type="tel" inputMode="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
              </Field>
              {/* Both lists are bundled with the page, so they work at a booth
                  with no signal — the same ISO 3166-1 table the online form
                  uses. A value a badge scan put here that is not in the list is
                  kept rather than dropped, which matters most offline: whoever
                  captured it is not around to retype it. */}
              <Field label="Nationality" name="nationality" required error={errors.nationality}>
                <Combobox
                  options={NATIONALITY_OPTIONS}
                  value={form.nationality}
                  onChange={(v) => set("nationality", v)}
                  placeholder="Select nationality..."
                  searchPlaceholder="Search nationality..."
                  emptyText="No nationality matches that."
                  invalid={!!errors.nationality}
                />
              </Field>
              <Field label="Country of Residence" name="countryOfResidence" required error={errors.countryOfResidence}>
                <Combobox
                  options={COUNTRY_NAME_OPTIONS}
                  value={form.countryOfResidence}
                  onChange={(v) => set("countryOfResidence", v)}
                  placeholder="Select country..."
                  searchPlaceholder="Search country..."
                  emptyText="No country matches that."
                  invalid={!!errors.countryOfResidence}
                />
              </Field>
              <Field label="Date of Birth" name="dateOfBirth">
                <Input type="date" value={form.dateOfBirth} onChange={(e) => set("dateOfBirth", e.target.value)} />
              </Field>
              <Field label="Passport Number" name="passportNumber">
                <Input value={form.passportNumber} onChange={(e) => set("passportNumber", e.target.value)} placeholder="Optional" />
              </Field>
              <Field label="Lead Channel" name="channel">
                <Select value={form.channel} onValueChange={(v) => set("channel", v)}>
                  <SelectTrigger><SelectValue placeholder="Select channel..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not recorded</SelectItem>
                    {LEAD_CHANNELS.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3">Academic Information</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Interested Program" name="interestedProgram" required error={errors.interestedProgram}>
                <Input value={form.interestedProgram} onChange={(e) => set("interestedProgram", e.target.value)} placeholder="BSc Computer Science" />
              </Field>
              <Field label="Faculty" name="faculty">
                <Input value={form.faculty} onChange={(e) => set("faculty", e.target.value)} placeholder="e.g. Business & Management" />
              </Field>
              <Field label="Study Level" name="studyLevel" required error={errors.studyLevel}>
                <Select value={form.studyLevel} onValueChange={(v) => set("studyLevel", v)}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {STUDY_LEVELS.map((l) => (
                      <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Intake Month" name="intakeMonth" required error={errors.intakeMonth}>
                <Select value={form.intakeMonth} onValueChange={(v) => set("intakeMonth", v)}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m) => (
                      <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Intake Year" name="intakeYear" required error={errors.intakeYear}>
                <Input type="number" inputMode="numeric" value={form.intakeYear} onChange={(e) => set("intakeYear", e.target.value)} />
              </Field>
            </div>

            {/* Anti-spam consent. Three states, not a checkbox: a checkbox left
                unticked cannot be told apart from one they were never shown,
                and that distinction is what makes the record defensible. */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/40 p-3.5 space-y-2">
              <Label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                May we email them? <span className="text-red-500">*</span>
              </Label>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                Canadian anti-spam law requires permission before sending marketing email.
                Ask the student directly — leaving this unanswered means we cannot email them.
              </p>
              <div className="flex flex-wrap gap-2 pt-0.5">
                {([
                  { v: "yes", label: "Yes, they agreed" },
                  { v: "no", label: "No, they declined" },
                  // No "Didn't ask" here: this page is only ever used with the
                  // student in front of you, so the honest answer is yes or no.
                ] as const).map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    onClick={() => set("marketingConsent", o.v)}
                    className={cn(
                      "px-3 py-1.5 rounded-md text-xs font-medium border transition-colors",
                      form.marketingConsent === o.v
                        ? "bg-[#1E3A5F] text-white border-[#1E3A5F]"
                        : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-700 dark:hover:bg-slate-800/60"
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              {errors.marketingConsent && (
                <p className="text-xs text-red-600 dark:text-red-400">{errors.marketingConsent}</p>
              )}

              {/* The other three channels. The office form has asked for all
                  four since spec §1; this page asked only about email, so an
                  event lead arrived with three channels blank and no way to
                  tell "declined" from "never asked". */}
              <div className="pt-2 space-y-2 border-t border-slate-200 dark:border-slate-800">
                {([
                  { key: "phoneContactConsent", label: "Telephone calls" },
                  { key: "smsContactConsent", label: "SMS" },
                  { key: "whatsappContactConsent", label: "WhatsApp" },
                ] as const).map((ch) => (
                  <div key={ch.key} className="flex items-center justify-between gap-3">
                    <Label className="text-[11px] font-normal text-slate-600 dark:text-slate-400">
                      {ch.label} <span className="text-red-500">*</span>
                      {errors[ch.key] && (
                        <span className="block text-[11px] text-red-600 dark:text-red-400">
                          {errors[ch.key]}
                        </span>
                      )}
                    </Label>
                    <div className="flex gap-1.5">
                      {([
                        { v: "yes", label: "Yes" },
                        { v: "no", label: "No" },
                      ] as const).map((o) => (
                        <button
                          key={o.v}
                          type="button"
                          onClick={() => set(ch.key, o.v)}
                          className={cn(
                            "px-2 py-1 rounded text-[11px] font-medium border transition-colors",
                            form[ch.key] === o.v
                              ? "bg-[#1E3A5F] text-white border-[#1E3A5F]"
                              : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-700 dark:hover:bg-slate-800/60"
                          )}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}

                <label className="flex items-start gap-2 pt-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.doNotContact}
                    onChange={(e) => set("doNotContact", e.target.checked)}
                    className="mt-0.5"
                  />
                  <span className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                    <span className="font-medium">Do not contact</span> — the student has asked
                    us to stop entirely. Overrides every channel above, whatever they say.
                  </span>
                </label>
              </div>
            </div>

            {/* -- Pipeline Details: the rep's own notes --------------------
                Collapsed by default. See `pipelineOpen` above: this form is
                filled in with the student watching, and these are judgements
                about them rather than answers from them. */}
            <div>
              <button
                type="button"
                onClick={() => setPipelineOpen((o) => !o)}
                aria-expanded={pipelineOpen}
                aria-controls="offline-pipeline-details"
                className="flex w-full items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              >
                {pipelineOpen
                  ? <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                  : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                Pipeline Details
                <span className="ml-1 font-normal normal-case tracking-normal text-slate-400 dark:text-slate-500">
                  (To be filled by university rep)
                </span>
              </button>

              {pipelineOpen && (
                <div id="offline-pipeline-details">
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-3 mb-3">
                    Filled in as the student progresses. Each stage asks only for what
                    it needs.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Lead Temperature" name="leadTemperature" neededToProgress>
                      <Select value={form.leadTemperature} onValueChange={(v) => set("leadTemperature", v)}>
                        <SelectTrigger><SelectValue placeholder="Not assessed yet" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>Not assessed yet</SelectItem>
                          {LEAD_TEMPERATURES.map((t) => (
                            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Intended Destination" name="intendedDestination" neededToProgress error={errors.intendedDestination}>
                      <Combobox
                        options={COUNTRY_NAME_OPTIONS}
                        value={form.intendedDestination}
                        onChange={(v) => set("intendedDestination", v)}
                        placeholder="Select destination..."
                        searchPlaceholder="Search country..."
                        emptyText="No country matches that."
                        invalid={!!errors.intendedDestination}
                      />
                    </Field>
                    <Field label="Preferred Country" name="preferredCountry">
                      <Combobox
                        options={COUNTRY_NAME_OPTIONS}
                        value={form.preferredCountry}
                        onChange={(v) => set("preferredCountry", v)}
                        placeholder="Confirmed after counselling"
                        searchPlaceholder="Search country..."
                        emptyText="No country matches that."
                      />
                    </Field>
                    <Field label="Budget Range" name="budgetRange">
                      <Select value={form.budgetRange} onValueChange={(v) => set("budgetRange", v)}>
                        <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>Not asked</SelectItem>
                          {BUDGET_RANGES.map((b) => (
                            <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Current Qualification" name="currentQualification">
                      <Input value={form.currentQualification} onChange={(e) => set("currentQualification", e.target.value)} placeholder="e.g. BSc Computer Science" />
                    </Field>
                    <Field label="Highest Academic Qualification" name="academicQualification">
                      <Input value={form.academicQualification} onChange={(e) => set("academicQualification", e.target.value)} placeholder="e.g. BSc 2:1" />
                    </Field>
                    <Field label="English Proficiency" name="englishStatus">
                      <Select value={form.englishStatus} onValueChange={(v) => set("englishStatus", v)}>
                        <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>Not asked</SelectItem>
                          {ENGLISH_STATUSES.map((s) => (
                            <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Enrolment Date" name="enrolmentDate">
                      <Input type="date" value={form.enrolmentDate} onChange={(e) => set("enrolmentDate", e.target.value)} />
                    </Field>
                    <Field label="Counselling Outcome" name="counsellingOutcomeEnum">
                      <Select value={form.counsellingOutcomeEnum} onValueChange={(v) => set("counsellingOutcomeEnum", v)}>
                        <SelectTrigger><SelectValue placeholder="Not recorded" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>Not recorded</SelectItem>
                          {COUNSELLING_OUTCOMES.map((c) => (
                            <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <div className="sm:col-span-2">
                      <Field label="Counselling Notes" name="counsellingOutcome">
                        <Textarea
                          rows={2}
                          value={form.counsellingOutcome}
                          onChange={(e) => set("counsellingOutcome", e.target.value)}
                          placeholder="What was agreed on the counselling call?"
                        />
                      </Field>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* -- Assignment & Source --------------------------------------
                Stays visible, as on the office form. `sourceId` is a hard New
                Lead gate requirement, and a field the gate names has to be
                reachable without first finding a collapsed section. None of
                these three is a judgement about the student, so there is
                nothing here they should not see. */}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3">Assignment &amp; Source</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Source" name="sourceId" neededToProgress>
                  <Select value={form.sourceId} onValueChange={(v) => set("sourceId", v)}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>None</SelectItem>
                      {(reference?.sources ?? []).map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Assigned ICR" name="assignedICRId">
                  <Select value={form.assignedICRId} onValueChange={(v) => set("assignedICRId", v)}>
                    <SelectTrigger><SelectValue placeholder="Select ICR..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Unassigned</SelectItem>
                      {(reference?.icrUsers ?? []).map((u) => (
                        <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                {/* Offline-only. The office form has no Event picker because a
                    lead typed up at a desk is not standing at a stand; this is
                    the whole reason the page exists, so it stays. */}
                <Field label="Event" name="eventId">
                  <Select value={form.eventId} onValueChange={(v) => set("eventId", v)}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>None</SelectItem>
                      {(reference?.events ?? []).map((ev) => (
                        <SelectItem key={ev.id} value={ev.id}>
                          {ev.name} — {ev.city}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Institution" name="institutionId">
                  <Select value={form.institutionId} onValueChange={(v) => set("institutionId", v)}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>None</SelectItem>
                      {(reference?.institutions ?? []).map((i) => (
                        <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </div>

            <Field label="Notes" name="notes">
              <Textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Anything worth remembering about this conversation" />
            </Field>

            <div className="flex justify-end">
              {/* The full-device block does not apply while correcting: fixing
                  a rejected lead replaces one that is already counted. */}
              <Button
                type="submit"
                disabled={saving || (full && !editingId)}
                className="gap-1.5 bg-[#1E3A5F] hover:bg-[#1E3A5F]/90"
              >
                {editingId ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {saving ? "Saving..." : editingId ? "Save correction" : "Save to device"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Queue */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Held on this device ({queue.length})
            </h2>
            {failedCount > 0 && (
              <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30">
                {failedCount} need attention
              </Badge>
            )}
            <Button variant="ghost" size="sm" onClick={reloadQueue} className="ml-auto h-7 gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>

          {queue.length === 0 ? (
            <p className="text-xs text-slate-400 dark:text-slate-500 py-6 text-center">
              Nothing captured yet. Leads saved here stay on the device until you upload them.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {queue.map((q) => (
                <div key={q.captureId} className="py-2.5 flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                      {String(q.data.firstName ?? "")} {String(q.data.lastName ?? "")}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {String(q.data.email ?? "")} · {String(q.data.phone ?? "")}
                    </p>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                      {new Date(q.capturedAt).toLocaleString("en-GB")}
                    </p>
                    {q.status === "failed" && q.lastError && (
                      <p className="text-xs text-red-600 dark:text-red-400 mt-1">{q.lastError}</p>
                    )}
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "shrink-0 text-[10px]",
                      q.status === "failed"
                        ? "bg-red-50 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30"
                        : "bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700"
                    )}
                  >
                    {q.status === "failed" ? "Rejected" : "Waiting"}
                  </Badge>
                  {q.status === "failed" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-slate-400 hover:text-[#1E3A5F] dark:text-slate-500 dark:hover:text-sky-300 shrink-0"
                      onClick={() => startEditing(q)}
                      title="Correct and resend"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-slate-400 hover:text-red-600 dark:text-slate-500 dark:hover:text-red-400 shrink-0"
                    onClick={() => discard(q.captureId)}
                    title="Remove from this device"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  name,
  required,
  /**
   * Required by the New Lead GATE, but not to capture the lead.
   *
   * Deliberately not a red asterisk — the same call the office form makes. A
   * booth capture must never be blocked by a question the ICR has not had the
   * conversation to answer; this says what is coming instead of pretending the
   * field does not matter.
   */
  neededToProgress,
  error,
  children,
}: {
  label: string;
  /**
   * Published as `data-field`, exactly as the office form's `FormField` does.
   *
   * Addressing a control by its position in the DOM is what the country test
   * used to do here, and moving two fields into the collapsed Pipeline Details
   * section silently repointed it at the Lead source dropdown — a Radix
   * `SelectTrigger` also carries `role="combobox"`, so the wrong control was
   * found rather than no control. A stable hook makes that class of break
   * impossible.
   */
  name?: string;
  required?: boolean;
  neededToProgress?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5" data-field={name}>
      <Label className="text-xs font-medium text-slate-700 dark:text-slate-300">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </Label>
      {children}
      {neededToProgress && !error && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Needed before this student can move past New Lead.
        </p>
      )}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
