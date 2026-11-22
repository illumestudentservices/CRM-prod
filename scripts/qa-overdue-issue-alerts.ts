/**
 * QA for the overdue client-issue alert (lib/overdue-issue-alerts.ts).
 *
 * Proves: only OPEN issues past their deadline fire; only the issue's primary
 * owner is told (not the RM / nobody else); future, resolved and no-deadline
 * issues are ignored; a second run does not re-notify (de-dup); dry-run writes
 * nothing.
 *
 *   npx tsx --env-file=.env.local scripts/qa-overdue-issue-alerts.ts
 */
import { db, createAndLogin, destroyUser, TAG } from "./qa-lib.mjs";
import { runOverdueIssueAlerts } from "@/lib/overdue-issue-alerts";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string, extra = "") => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m + (extra ? " → " + extra : "")); } };

const daysFromNow = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

async function main() {
  const admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  const owner = await createAndLogin({ role: "ACCOUNT_MANAGER", withEmployee: true });
  const other = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true });
  const issueIds: string[] = [];
  let instId = "";

  const mkIssue = async (label: string, extra: Record<string, unknown>) => {
    const i = await db.clientIssue.create({
      data: {
        institutionId: instId,
        title: `${TAG} ${label}`,
        category: "SERVICE_DELIVERY",
        status: "OPEN",
        ownerId: owner.user.id,
        createdById: admin.user.id,
        ...extra,
      },
      select: { id: true },
    });
    issueIds.push(i.id);
    return i.id;
  };
  const ownerOverdueNotifs = () =>
    db.notification.findMany({ where: { userId: owner.user.id, type: "ISSUE_OVERDUE" }, select: { id: true, link: true, message: true } });

  try {
    const inst = await db.institution.create({
      data: { name: `${TAG} Overdue U`, country: "QA", type: "UNIVERSITY", createdById: admin.user.id, accountManagerId: owner.user.id, regionalManagerId: other.user.id },
      select: { id: true },
    });
    instId = inst.id;

    const overdueId = await mkIssue("overdue", { targetResolutionAt: daysFromNow(-3) });
    const futureId = await mkIssue("future", { targetResolutionAt: daysFromNow(5) });
    const resolvedId = await mkIssue("resolved", { status: "RESOLVED", resolvedAt: new Date(), targetResolutionAt: daysFromNow(-3) });
    const noDeadlineId = await mkIssue("no-deadline", { targetResolutionAt: null });

    // ── Run 1 ────────────────────────────────────────────────────────────────
    const r1 = await runOverdueIssueAlerts({ dryRun: false });
    ok(r1.overdue === 1, "exactly 1 issue counted as overdue", JSON.stringify(r1));
    ok(r1.notified === 1, "exactly 1 owner notified", JSON.stringify(r1));

    const notifs = await ownerOverdueNotifs();
    ok(notifs.length === 1, "owner has exactly 1 ISSUE_OVERDUE notice", `got ${notifs.length}`);
    ok(!!notifs[0] && notifs[0].link!.includes(overdueId), "notice points at the overdue issue", notifs[0]?.link ?? "");
    ok(!!notifs[0] && notifs[0].message.includes("Overdue U"), "message names the institution", notifs[0]?.message ?? "");
    ok(!notifs.some((n) => n.link!.includes(futureId) || n.link!.includes(resolvedId) || n.link!.includes(noDeadlineId)),
      "future / resolved / no-deadline issues did NOT fire");

    // primary-owner-only: the RM (and anyone else) gets nothing
    const otherNotifs = await db.notification.count({ where: { userId: other.user.id, type: "ISSUE_OVERDUE" } });
    ok(otherNotifs === 0, "non-owner (RM) is NOT notified — primary owner only", `got ${otherNotifs}`);

    // ── Run 2 — de-dup ─────────────────────────────────────────────────────────
    const r2 = await runOverdueIssueAlerts({ dryRun: false });
    ok(r2.notified === 0 && r2.skipped === 1, "second run re-notifies nobody (de-duped)", JSON.stringify(r2));
    ok((await ownerOverdueNotifs()).length === 1, "still exactly 1 notice after re-run");

    // ── Dry-run writes nothing ────────────────────────────────────────────────
    const extraOverdue = await mkIssue("overdue-2", { targetResolutionAt: daysFromNow(-2) });
    const before = (await ownerOverdueNotifs()).length;
    const rDry = await runOverdueIssueAlerts({ dryRun: true });
    ok(rDry.notified === 1 && rDry.dryRun, "dry-run reports it WOULD notify the new one", JSON.stringify(rDry));
    const after = (await ownerOverdueNotifs()).length;
    ok(after === before, "dry-run created no notification rows", `before ${before} after ${after}`);
    ok(!(await ownerOverdueNotifs()).some((n) => n.link!.includes(extraOverdue)), "no row for the dry-run issue");
  } finally {
    await db.notification.deleteMany({ where: { userId: owner.user.id, type: "ISSUE_OVERDUE" } }).catch(() => {});
    for (const id of issueIds) await db.clientIssue.delete({ where: { id } }).catch(() => {});
    if (instId) await db.institution.delete({ where: { id: instId } }).catch(() => {});
    for (const u of [admin, owner, other]) await destroyUser(u).catch(() => {});
    console.log(`\nTOTAL ${pass} pass / ${fail} fail`);
    await db.$disconnect();
    process.exit(fail ? 1 : 0);
  }
}
main().catch(async (e) => { console.error("[fatal]", e?.stack || e); await db.$disconnect(); process.exit(1); });
