"use client";

import * as React from "react";
import {
  AlertTriangle,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { BUDGET_RANGES, ENGLISH_STATUSES, STUDY_LEVELS, MONTHS } from "@/lib/lead-options";
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
  interestedProgram: string;
  studyLevel: string;
  intakeYear: string;
  intakeMonth: string;
  intendedDestination: string;
  sourceId: string;
  eventId: string;
  institutionId: string;
  preferredCountry: string;
  budgetRange: string;
  englishStatus: string;
  notes: string;
  /** "" = not asked, "yes"/"no" = an answer was actually given. */
  marketingConsent: "" | "yes" | "no";
}

function emptyForm(): FormState {
  return {
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    nationality: "",
    countryOfResidence: "",
    interestedProgram: "",
    studyLevel: "",
    intakeYear: String(new Date().getFullYear() + 1),
    intakeMonth: "",
    intendedDestination: "",
    sourceId: NONE,
    eventId: NONE,
    institutionId: NONE,
    preferredCountry: "",
    budgetRange: NONE,
    englishStatus: NONE,
    notes: "",
    marketingConsent: "",
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
    interestedProgram: f.interestedProgram.trim(),
    studyLevel: f.studyLevel,
    intakeYear: Number(f.intakeYear),
    intakeMonth: Number(f.intakeMonth),
    intendedDestination: opt(f.intendedDestination),
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
  };
}

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
  const sel = (v: unknown) => (v == null || v === "" ? NONE : String(v));
  return {
    firstName: s(data.firstName),
    lastName: s(data.lastName),
    email: s(data.email),
    phone: s(data.phone),
    nationality: s(data.nationality),
    countryOfResidence: s(data.countryOfResidence),
    interestedProgram: s(data.interestedProgram),
    studyLevel: s(data.studyLevel),
    intakeYear: s(data.intakeYear) || String(new Date().getFullYear() + 1),
    intakeMonth: s(data.intakeMonth),
    intendedDestination: s(data.intendedDestination),
    sourceId: sel(data.sourceId),
    eventId: sel(data.eventId),
    institutionId: sel(data.institutionId),
    preferredCountry: s(data.preferredCountry),
    budgetRange: sel(data.budgetRange),
    englishStatus: sel(data.englishStatus),
    notes: s(data.notes),
    marketingConsent:
      data.marketingConsent === true ? "yes" : data.marketingConsent === false ? "no" : "",
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

  function cancelEditing() {
    setEditingId(null);
    setForm(emptyForm());
    setErrors({});
  }

  function startEditing(q: QueuedCapture) {
    setEditingId(q.captureId);
    setForm(formFromCapture(q.data));
    setErrors({});
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
          <CloudOff className="h-8 w-8 mx-auto text-slate-300" />
          <p className="text-sm font-medium text-slate-900">
            This browser cannot store leads offline
          </p>
          <p className="text-xs text-slate-500">
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
              ? "bg-green-50 text-green-700 border-green-200"
              : "bg-amber-50 text-amber-800 border-amber-200"
          )}
        >
          {online ? <Cloud className="h-3 w-3" /> : <CloudOff className="h-3 w-3" />}
          {online ? "Connected" : "No connection"}
        </Badge>
        <span className="text-xs text-slate-500">
          Capturing as <span className="font-medium text-slate-700">{userName}</span>
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
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-900 leading-relaxed">
            <span className="font-semibold">Not ready for offline yet.</span> Tap “Prepare for
            offline” while you still have a connection, or the Source, Event and Institution
            lists will be empty at the booth — and Lead source is required before a lead can
            progress.
          </p>
        </div>
      )}

      {reference && (
        <p className="text-xs text-slate-500">
          Lists last downloaded {new Date(reference.generatedAt).toLocaleString("en-GB")} ·{" "}
          {reference.sources.length} sources, {reference.events.length} events,{" "}
          {reference.institutions.length} institutions
        </p>
      )}

      <div className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5">
        <AlertTriangle className="h-4 w-4 text-slate-500 shrink-0 mt-0.5" />
        <p className="text-xs text-slate-700 leading-relaxed">{OFFLINE_CAPTURE_WARNING}</p>
      </div>

      {foreign > 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-900 leading-relaxed">
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
              <Pencil className="h-4 w-4 text-amber-600" />
            ) : (
              <UserPlus className="h-4 w-4 text-[#1E3A5F]" />
            )}
            <h2 className="text-sm font-semibold text-slate-900">
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
                <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                  Device full
                </Badge>
              )}
            </div>
          </div>

          <p className="text-xs text-slate-500 mb-4">
            Both an email and a phone number are needed — ask for both while the student is
            still with you.
          </p>

          <form onSubmit={saveToDevice} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="First name" required error={errors.firstName}>
                <Input value={form.firstName} onChange={(e) => set("firstName", e.target.value)} placeholder="Nkechi" />
              </Field>
              <Field label="Last name" required error={errors.lastName}>
                <Input value={form.lastName} onChange={(e) => set("lastName", e.target.value)} placeholder="Obi" />
              </Field>
              <Field label="Email" required error={errors.email}>
                <Input type="email" inputMode="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
              </Field>
              <Field label="Phone" required error={errors.phone}>
                <Input type="tel" inputMode="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
              </Field>
              <Field label="Citizenship" required error={errors.nationality}>
                <Input value={form.nationality} onChange={(e) => set("nationality", e.target.value)} placeholder="Nigerian" />
              </Field>
              <Field label="Country of residence" required error={errors.countryOfResidence}>
                <Input value={form.countryOfResidence} onChange={(e) => set("countryOfResidence", e.target.value)} placeholder="Nigeria" />
              </Field>
              <Field label="Intended programme" required error={errors.interestedProgram}>
                <Input value={form.interestedProgram} onChange={(e) => set("interestedProgram", e.target.value)} placeholder="BSc Computer Science" />
              </Field>
              <Field label="Study level" required error={errors.studyLevel}>
                <Select value={form.studyLevel} onValueChange={(v) => set("studyLevel", v)}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {STUDY_LEVELS.map((l) => (
                      <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Intake month" required error={errors.intakeMonth}>
                <Select value={form.intakeMonth} onValueChange={(v) => set("intakeMonth", v)}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m) => (
                      <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Intake year" required error={errors.intakeYear}>
                <Input type="number" inputMode="numeric" value={form.intakeYear} onChange={(e) => set("intakeYear", e.target.value)} />
              </Field>
              <Field label="Intended destination" error={errors.intendedDestination}>
                <Input value={form.intendedDestination} onChange={(e) => set("intendedDestination", e.target.value)} placeholder="Canada" />
              </Field>
              <Field label="Preferred country">
                <Input value={form.preferredCountry} onChange={(e) => set("preferredCountry", e.target.value)} />
              </Field>

              <Field label="Lead source">
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
              <Field label="Event">
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
              <Field label="Institution">
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
              <Field label="Budget range">
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
              <Field label="English status">
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
            </div>

            <Field label="Notes">
              <Textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Anything worth remembering about this conversation" />
            </Field>

            {/* Anti-spam consent. Three states, not a checkbox: a checkbox left
                unticked cannot be told apart from one they were never shown,
                and that distinction is what makes the record defensible. */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-2">
              <Label className="text-xs font-medium text-slate-700">
                May we email them? <span className="text-red-500">*</span>
              </Label>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Canadian anti-spam law requires permission before sending marketing email.
                Ask the student directly — leaving this unanswered means we cannot email them.
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
                    onClick={() => set("marketingConsent", o.v)}
                    className={cn(
                      "px-3 py-1.5 rounded-md text-xs font-medium border transition-colors",
                      form.marketingConsent === o.v
                        ? "bg-[#1E3A5F] text-white border-[#1E3A5F]"
                        : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

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
            <h2 className="text-sm font-semibold text-slate-900">
              Held on this device ({queue.length})
            </h2>
            {failedCount > 0 && (
              <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                {failedCount} need attention
              </Badge>
            )}
            <Button variant="ghost" size="sm" onClick={reloadQueue} className="ml-auto h-7 gap-1.5 text-xs text-slate-500">
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>

          {queue.length === 0 ? (
            <p className="text-xs text-slate-400 py-6 text-center">
              Nothing captured yet. Leads saved here stay on the device until you upload them.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {queue.map((q) => (
                <div key={q.captureId} className="py-2.5 flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900 truncate">
                      {String(q.data.firstName ?? "")} {String(q.data.lastName ?? "")}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                      {String(q.data.email ?? "")} · {String(q.data.phone ?? "")}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {new Date(q.capturedAt).toLocaleString("en-GB")}
                    </p>
                    {q.status === "failed" && q.lastError && (
                      <p className="text-xs text-red-600 mt-1">{q.lastError}</p>
                    )}
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "shrink-0 text-[10px]",
                      q.status === "failed"
                        ? "bg-red-50 text-red-700 border-red-200"
                        : "bg-slate-50 text-slate-600 border-slate-200"
                    )}
                  >
                    {q.status === "failed" ? "Rejected" : "Waiting"}
                  </Badge>
                  {q.status === "failed" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-slate-400 hover:text-[#1E3A5F] shrink-0"
                      onClick={() => startEditing(q)}
                      title="Correct and resend"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-slate-400 hover:text-red-600 shrink-0"
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
