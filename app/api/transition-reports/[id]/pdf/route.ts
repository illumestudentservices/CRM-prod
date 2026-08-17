import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { TRANSITION_SECTIONS, TRANSITION_TYPE_LABELS } from "@/lib/icr-transition";

/**
 * Printable Transition & Handover report (spec §31).
 *
 * Print-styled HTML with window.print(), matching app/api/reports/[id]/pdf.
 * Deliberately no PDF library and no headless browser: the existing report
 * export already works this way, the server has no Chrome to drive, and a
 * second rendering stack would be a lot of surface area for a document the
 * spec itself calls "only an output".
 *
 * §31 is explicit that "the structured CRM record remains the source of truth",
 * so nothing is computed here that is not already stored or already shown on
 * screen.
 *
 * A FINAL report prints from its snapshot (§37), not from live data. Printing a
 * finalised handover months later must reproduce the handover, not today's
 * position — that is the whole reason the snapshot exists.
 */

function esc(text: string): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "<br>");
}

const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "—";

const fmtDateTime = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

    const role = session.user.role as Role;
    if (!(await effectiveHasPermission(role, "icr_transition", "read"))) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    const { id } = await ctx.params;
    const report = await db.transitionReport.findUnique({
      where: { id },
      include: {
        institution: { select: { name: true, country: true } },
        outgoingIcr: { select: { name: true, email: true } },
        incomingIcr: { select: { name: true, email: true } },
        regionalManager: { select: { name: true, email: true } },
        region: { select: { name: true } },
        markets: { select: { market: { select: { name: true } } } },
        sections: true,
        events: {
          orderBy: { createdAt: "asc" },
          include: { actedBy: { select: { name: true, email: true } } },
        },
      },
    });
    if (!report) return new NextResponse("Report not found", { status: 404 });

    // Same entitlement rule as the detail route. A printable copy must not be a
    // way around the row scope.
    const isParticipant =
      report.outgoingIcrId === session.user.id ||
      report.incomingIcrId === session.user.id ||
      report.regionalManagerId === session.user.id ||
      report.clientRelationsDirectorId === session.user.id ||
      report.vpGlobalSalesId === session.user.id;
    const seesEverything = role === "SUPER_ADMIN" || role === "HQ_EXECUTIVE";
    const readsFinalOnly =
      (role === "VP_GLOBAL_SALES" || role === "ACCOUNT_MANAGER") &&
      (report.status === "FINAL" || report.status === "ARCHIVED");
    if (!seesEverything && !isParticipant && !readsFinalOnly) {
      return new NextResponse("Report not found", { status: 404 });
    }

    const byKey = new Map(report.sections.map((s) => [s.section, s]));

    // §37: a finalised report prints what was true at handover.
    const snap = report.snapshot as {
      pipeline?: Array<{ stage: string; lead?: { firstName: string; lastName: string } }>;
      tasks?: Array<{ title: string; status: string; priority: string }>;
      risks?: Array<{ title: string; status: string; impact: number }>;
      counts?: Record<string, number>;
    } | null;

    const accepted = report.events.find((e) => e.toStatus === "ACCEPTED_BY_RM");
    const finalised = report.events.find((e) => e.toStatus === "FINAL");

    const sectionsHtml = TRANSITION_SECTIONS.map((def) => {
      const row = byKey.get(def.key);
      const body = row?.narrative?.trim()
        ? `<p>${esc(row.narrative)}</p>`
        : `<p class="empty">Not completed.</p>`;

      // Only the three sections with a CRM read-out get an appendix table, for
      // the same reason the screen does: printing a table the ICR never spoke
      // to would pad the document without adding handover value.
      let extra = "";
      if (def.key === "ACTIVE_STUDENT_PIPELINE" && snap?.pipeline?.length) {
        extra = `<table><thead><tr><th>Student</th><th>Stage at handover</th></tr></thead><tbody>${
          snap.pipeline.map((p) =>
            `<tr><td>${esc(`${p.lead?.firstName ?? ""} ${p.lead?.lastName ?? ""}`.trim() || "—")}</td>` +
            `<td>${esc(String(p.stage ?? "").replaceAll("_", " "))}</td></tr>`
          ).join("")
        }</tbody></table>`;
      }
      if (def.key === "OUTSTANDING_TASKS_COMMITMENTS" && snap?.tasks?.length) {
        extra = `<table><thead><tr><th>Task</th><th>Priority</th><th>Status</th></tr></thead><tbody>${
          snap.tasks.map((t) =>
            `<tr><td>${esc(t.title)}</td><td>${esc(t.priority)}</td><td>${esc(t.status)}</td></tr>`
          ).join("")
        }</tbody></table>`;
      }
      if (def.key === "OUTSTANDING_ISSUES_RISKS" && snap?.risks?.length) {
        extra = `<table><thead><tr><th>Risk</th><th>Impact</th><th>Status</th></tr></thead><tbody>${
          snap.risks.map((r) =>
            `<tr><td>${esc(r.title)}</td><td>${esc(String(r.impact))}</td><td>${esc(r.status)}</td></tr>`
          ).join("")
        }</tbody></table>`;
      }

      return `<section class="sec">
        <h2>${esc(def.title)}</h2>
        ${body}
        ${extra}
      </section>`;
    }).join("");

    const markets = report.markets.map((m) => m.market.name).join(", ") || "—";
    const title = `Transition & Handover — ${report.outgoingIcr.name ?? report.outgoingIcr.email} — ${report.institution.name}`;

    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Georgia, "Times New Roman", serif; color: #1a1a1a; max-width: 820px;
         margin: 0 auto; padding: 32px; line-height: 1.55; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 0 0 6px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  .sub { color: #555; font-size: 13px; margin-bottom: 20px; }
  .sec { margin-bottom: 20px; }
  .sec p { margin: 0 0 8px; font-size: 13px; white-space: pre-wrap; }
  .empty { color: #999; font-style: italic; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
  th, td { border: 1px solid #ddd; padding: 5px 7px; text-align: left; }
  th { background: #f4f4f4; }
  dl { display: grid; grid-template-columns: 190px 1fr; gap: 3px 12px; font-size: 13px; margin: 0 0 20px; }
  dt { color: #555; }
  dd { margin: 0; }
  .sign { margin-top: 28px; border-top: 2px solid #333; padding-top: 12px; font-size: 13px; }
  .badge { display: inline-block; border: 1px solid #333; padding: 1px 7px; font-size: 11px;
           text-transform: uppercase; letter-spacing: .04em; }
  .note { font-size: 11px; color: #666; margin-top: 22px; border-top: 1px solid #eee; padding-top: 8px; }
  .print-btn { position: fixed; top: 14px; right: 14px; padding: 8px 14px; font-family: system-ui;
               font-size: 13px; cursor: pointer; }
  /* Keep a section and its table together, and never orphan a heading. */
  @media print {
    .print-btn { display: none; }
    body { padding: 0; max-width: none; }
    .sec { page-break-inside: avoid; }
    h2 { page-break-after: avoid; }
  }
</style></head><body>
<button class="print-btn" onclick="window.print()">Print / Save as PDF</button>

<h1>ICR Transition &amp; Handover Report</h1>
<p class="sub">
  ${esc(report.institution.name)} · ${esc(TRANSITION_TYPE_LABELS[report.transitionType])}
  · <span class="badge">${esc(report.status.replaceAll("_", " "))}</span>
</p>

<h2>Assignment Details</h2>
<dl>
  <dt>Outgoing ICR</dt><dd>${esc(report.outgoingIcr.name ?? report.outgoingIcr.email)}</dd>
  <dt>Incoming ICR</dt><dd>${esc(report.incomingIcr?.name ?? report.incomingIcr?.email ?? "Not yet appointed")}</dd>
  <dt>Client institution</dt><dd>${esc(report.institution.name)} (${esc(report.institution.country)})</dd>
  <dt>Region</dt><dd>${esc(report.region?.name ?? "—")}</dd>
  <dt>Market(s)</dt><dd>${esc(markets)}</dd>
  <dt>Regional Manager</dt><dd>${esc(report.regionalManager.name ?? report.regionalManager.email)}</dd>
  <dt>Transition type</dt><dd>${esc(TRANSITION_TYPE_LABELS[report.transitionType])}</dd>
  <dt>Effective date</dt><dd>${fmtDate(report.effectiveTransitionDate)}</dd>
  <dt>Final working day</dt><dd>${fmtDate(report.finalWorkingDay)}</dd>
  <dt>Report due</dt><dd>${fmtDate(report.reportDueDate)}</dd>
</dl>

${sectionsHtml}

<div class="sign">
  <h2>ICR Declaration</h2>
  <p>${
    report.declarationConfirmedAt
      ? `Confirmed complete and accurate by ${esc(report.outgoingIcr.name ?? report.outgoingIcr.email)} on ${fmtDateTime(report.declarationConfirmedAt)}.`
      : `<span class="empty">Not confirmed.</span>`
  }</p>

  <h2>Regional Manager Acceptance</h2>
  <p>${
    accepted
      ? `Accepted by ${esc(accepted.actedBy.name ?? accepted.actedBy.email)} on ${fmtDateTime(accepted.createdAt)}.`
      : `<span class="empty">Not yet accepted.</span>`
  }</p>
  ${finalised ? `<p>Finalised on ${fmtDateTime(finalised.createdAt)}.</p>` : ""}
</div>

<p class="note">
  ${
    snap
      ? `Figures shown are as they stood at handover on ${fmtDateTime(report.snapshotAt)}, not as they are today.`
      : `This report is not yet final; figures reflect the live CRM at the time of printing.`
  }
  The structured CRM record remains the source of truth; this document is an output of it.
  Generated ${fmtDateTime(new Date())}.
</p>

<script>
  // Auto-open the print dialog, matching the existing report export. Delayed so
  // fonts and layout settle first, or the first page can paginate wrongly.
  setTimeout(function () { window.print(); }, 500);
</script>
</body></html>`;

    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[GET transition pdf]", err);
    return new NextResponse("Internal server error", { status: 500 });
  }
}
