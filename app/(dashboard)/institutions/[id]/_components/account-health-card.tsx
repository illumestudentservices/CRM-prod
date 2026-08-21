"use client";

import * as React from "react";
import { Loader2, ShieldAlert, CheckCircle2, AlertTriangle, HelpCircle } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { HEALTH_LABELS } from "@/lib/account-health";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

/**
 * Account health, and the intervention the spec requires with it.
 *
 * The health rating and the whole AccountIntervention model were built and
 * tested and had no user interface at all, so nobody could record that an
 * account was at risk. This is that interface.
 *
 * Spec §11: "When Amber or Red is selected, require: Reason, Corrective action,
 * Action owner, Review date." The API enforces that transactionally; this form
 * refuses to submit without them so the user is told before the round trip
 * rather than after it.
 */

type Health = "GREEN" | "AMBER" | "RED" | "GREY";

/**
 * The wording comes from lib/account-health.ts rather than being spelled out
 * here, so this panel and the client list cannot drift apart. They had already
 * started to: the list called RED "At risk" while the client list the regional
 * team maintains calls it "Alarmed", and the same client read differently
 * depending on which screen you were on. The labels now carry both the colour
 * and the client list's word — "Red — Alarmed".
 */
const HEALTH: Record<Health, { label: string; hint: string; badge: "success" | "warning" | "destructive" | "secondary"; Icon: typeof CheckCircle2 }> = {
  GREEN: { label: HEALTH_LABELS.GREEN.full, hint: HEALTH_LABELS.GREEN.hint, badge: "success", Icon: CheckCircle2 },
  AMBER: { label: HEALTH_LABELS.AMBER.full, hint: HEALTH_LABELS.AMBER.hint, badge: "warning", Icon: AlertTriangle },
  RED: { label: HEALTH_LABELS.RED.full, hint: HEALTH_LABELS.RED.hint, badge: "destructive", Icon: ShieldAlert },
  GREY: { label: HEALTH_LABELS.GREY.full, hint: HEALTH_LABELS.GREY.hint, badge: "secondary", Icon: HelpCircle },
};

/** Amber and Red are the two that demand an intervention. */
const REQUIRES_INTERVENTION: Health[] = ["AMBER", "RED"];

interface Intervention {
  id: string;
  reason: string;
  correctiveAction: string;
  reviewDate: string | null;
  resolvedAt: string | null;
  actionOwner?: { id: string; name: string | null } | null;
}

interface Props {
  institutionId: string;
  /** Whether this user may change the rating (institutions.set_health). */
  canSetHealth: boolean;
  onChanged?: () => void;
}

export function AccountHealthCard({ institutionId, canSetHealth, onChanged }: Props) {
  const { toast } = useToast();
  const [health, setHealth] = React.useState<Health | null>(null);
  const [interventions, setInterventions] = React.useState<Intervention[]>([]);
  const [owners, setOwners] = React.useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = React.useState(true);

  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [choice, setChoice] = React.useState<Health>("GREEN");
  const [reason, setReason] = React.useState("");
  const [correctiveAction, setCorrectiveAction] = React.useState("");
  const [actionOwnerId, setActionOwnerId] = React.useState("none");
  const [reviewDate, setReviewDate] = React.useState("");

  const load = React.useCallback(async () => {
    const res = await fetch(`/api/institutions/${institutionId}/health`);
    if (!res.ok) { setLoading(false); return; }
    const d = await res.json();
    // The route wraps its payload: { data: { health, openInterventions } }.
    // Reading d.health directly returned undefined, so the card showed Grey for
    // every client and never listed an intervention — the component looked
    // built and displayed nothing true.
    const payload = d.data ?? d;
    setHealth((payload.health ?? "GREY") as Health);
    setInterventions(payload.openInterventions ?? []);
    setLoading(false);
  }, [institutionId]);

  React.useEffect(() => { load(); }, [load]);

  // Only fetched when the dialog opens — the owner list is irrelevant until
  // somebody is actually choosing one.
  React.useEffect(() => {
    if (!open) return;
    // /api/users does not exist — it was invented, so this fetch 404'd and the
    // picker sat empty with only its placeholder. owner-options is a narrow
    // endpoint added for exactly this, readable by anyone who can open a client.
    fetch("/api/institutions/owner-options")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list = Array.isArray(d) ? d : (d?.data ?? []);
        setOwners(list.map((u: { id: string; name: string }) => ({ id: u.id, name: u.name })));
      })
      .catch(() => {});
  }, [open]);

  const needsIntervention = REQUIRES_INTERVENTION.includes(choice);
  const valid = needsIntervention
    ? reason.trim().length >= 3 &&
      correctiveAction.trim().length >= 3 &&
      actionOwnerId !== "none" &&
      !!reviewDate
    : true;

  async function submit() {
    setSaving(true);
    try {
      const res = await fetch(`/api/institutions/${institutionId}/health`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          health: choice,
          ...(needsIntervention
            ? {
                intervention: {
                  reason: reason.trim(),
                  correctiveAction: correctiveAction.trim(),
                  actionOwnerId,
                  reviewDate: new Date(`${reviewDate}T00:00:00.000Z`).toISOString(),
                },
              }
            : {}),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: d.error ?? "Could not update account health", variant: "destructive" });
        return;
      }
      toast({ title: `Account health set to ${HEALTH[choice].label.split(" — ")[0]}` });
      setOpen(false);
      setReason(""); setCorrectiveAction(""); setActionOwnerId("none"); setReviewDate("");
      await load();
      onChanged?.();
    } finally {
      setSaving(false);
    }
  }

  const current = health ?? "GREY";
  const cfg = HEALTH[current];
  const openInterventions = interventions.filter((i) => !i.resolvedAt);

  return (
    <div className="border rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-lg bg-slate-100 dark:bg-slate-500/15 flex items-center justify-center shrink-0">
            <cfg.Icon className="h-5 w-5 text-slate-600 dark:text-slate-300" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
              Account Health
              {!loading && <Badge variant={cfg.badge}>{cfg.label.split(" — ")[0]}</Badge>}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 max-w-md">
              {loading ? "Checking…" : cfg.hint}
            </p>
          </div>
        </div>
        {canSetHealth ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => { setChoice(current); setOpen(true); }}
          >
            Change
          </Button>
        ) : (
          // Said out loud rather than hiding the control silently, so an
          // Account Manager who cannot change it knows why.
          <p className="text-xs text-slate-400 dark:text-slate-500 max-w-[14rem] text-right">
            Your role cannot change the rating.
          </p>
        )}
      </div>

      {openInterventions.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wide">
            Open interventions
          </p>
          {openInterventions.map((i) => (
            <div key={i.id} className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10 p-2.5">
              <p className="text-xs font-medium text-amber-900 dark:text-amber-200">{i.reason}</p>
              <p className="text-xs text-amber-800 dark:text-amber-300 mt-0.5">{i.correctiveAction}</p>
              <p className="text-[11px] text-amber-700 dark:text-amber-300/80 mt-1">
                {i.actionOwner?.name ? `Owner: ${i.actionOwner.name}` : "No owner recorded"}
                {i.reviewDate ? ` · review ${formatDate(i.reviewDate)}` : ""}
              </p>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Set account health</DialogTitle></DialogHeader>

          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label>Status *</Label>
              <Select value={choice} onValueChange={(v) => setChoice(v as Health)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(HEALTH) as Health[]).map((h) => (
                    <SelectItem key={h} value={h}>{HEALTH[h].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {needsIntervention && (
              <>
                <div className="flex gap-2 rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/30 p-2.5">
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-900 dark:text-amber-200">
                    Amber and Red need a corrective action on record. Without it the rating is
                    a label nobody has to act on.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Reason *</Label>
                  <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Enrolments 40% below the agreed target for two consecutive intakes." />
                </div>
                <div className="space-y-1.5">
                  <Label>Corrective action *</Label>
                  <Textarea rows={2} value={correctiveAction} onChange={(e) => setCorrectiveAction(e.target.value)}
                    placeholder="e.g. Weekly pipeline review with the ICR team until the gap closes." />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Action owner *</Label>
                    <Select value={actionOwnerId} onValueChange={setActionOwnerId}>
                      <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Choose an owner</SelectItem>
                        {owners.map((o) => (
                          <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Review date *</Label>
                    <Input type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} />
                  </div>
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={!valid || saving}
              onClick={submit}
              className="bg-[#1E3A5F] hover:bg-[#1E3A5F]/90 text-white gap-1.5"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
