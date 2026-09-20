/**
 * Serious actions must reach a super admin.
 *
 *   npx tsx --env-file=.env scripts/qa-admin-alerts.mjs
 *
 * ★ Six operations that DESTROY data, MOVE a lot of it at once, or CHANGE WHO
 * CAN DO WHAT previously notified nobody at all. This proves they now do, and
 * — just as importantly — that routine work does NOT, because an alert channel
 * that fires constantly is the same as no alert channel.
 *
 * Nothing is sent: the provider call is intercepted and counted.
 *
 * Footprint: disposable users and leads, removed in `finally`.
 */
import { db, createAndLogin, destroyUser, startSection, expect, summary } from "./qa-lib.mjs";

const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (typeof url === "string" && url.includes("api.brevo.com")) {
    const b = JSON.parse(init.body);
    sent.push({ to: b.to[0].email, subject: b.subject, html: b.htmlContent });
    return new Response("{}", { status: 201 });
  }
  return realFetch(url, init);
};
process.env.BREVO_API_KEY = "test-key-not-real";

const { notifyAdmins } = await import("@/lib/admin-alerts");

const made = { users: [] };
let baseline = {};

try {
  startSection("Fixtures");
  baseline = { users: await db.user.count(), notifications: await db.notification.count() };
  const admins = await db.user.findMany({
    where: { role: "SUPER_ADMIN", isActive: true, deletedAt: null },
    select: { email: true },
  });
  expect(admins.length > 0, `${admins.length} active super admin(s) to alert`);

  const actor = await createAndLogin({ role: "REGIONAL_MANAGER" });
  made.users.push(actor);

  // ── Every super admin is reached ──────────────────────────────────────────
  startSection("A serious action reaches every super admin");
  {
    sent.length = 0;
    await notifyAdmins({
      action: "RECYCLE_BIN_PURGED",
      actorName: "QA Actor", actorEmail: actor.user.email,
      summary: "a Lead record was destroyed permanently.",
      detail: [["Record type", "Lead"], ["Record", "Mei Ling Tan"]],
      link: "/recycle-bin",
    });

    expect(sent.length === admins.length,
      `all ${admins.length} super admin(s) emailed, saw ${sent.length}`,
      sent.map((s) => s.to).join(", "));
    expect(admins.every((a) => sent.some((s) => s.to === a.email)),
      "every one of them individually, not just the first");

    const mail = sent[0];
    expect(/^\[Admin\]/.test(mail?.subject ?? ""),
      "the subject is prefixed so it can be filed or filtered", mail?.subject);
    expect(mail?.subject.includes("QA Actor"),
      "and names who did it, which is the first thing you want to know",
      mail?.subject);
    expect(/destroyed permanently/i.test(mail?.html ?? ""),
      "the body says what happened in plain words");
    expect(/cannot be restored|no longer be restored/i.test(mail?.html ?? ""),
      "★ and why it matters — a bare action name does not answer 'must I act tonight'");
    expect(mail?.html.includes(actor.user.email),
      "the actor's address is in the detail table");
  }

  // ── The actor is told too, deliberately ───────────────────────────────────
  startSection("A super admin acting is still alerted — including themselves");
  {
    const adminActor = await createAndLogin({ role: "SUPER_ADMIN" });
    made.users.push(adminActor);

    sent.length = 0;
    await notifyAdmins({
      action: "PERMISSIONS_CHANGED",
      actorName: "QA Admin", actorEmail: adminActor.user.email,
      summary: "3 permission overrides saved.",
      link: "/settings",
    });

    expect(sent.some((s) => s.to === adminActor.user.email),
      "★ the acting admin is emailed about their own action",
      "elsewhere we suppress that as noise; here it is the whole point — it is how a stolen session gets noticed");
  }

  // ── In-app too ────────────────────────────────────────────────────────────
  startSection("It also lands in the app, not only the inbox");
  {
    const before = await db.notification.count({ where: { type: "ADMIN_ALERT" } });
    await notifyAdmins({
      action: "USER_DELETED",
      actorName: "QA Actor", actorEmail: actor.user.email,
      summary: "an account was removed.",
    });
    const after = await db.notification.count({ where: { type: "ADMIN_ALERT" } });
    expect(after > before, `${after - before} in-app notifications written`);
  }

  // ── Every action type is describable ──────────────────────────────────────
  startSection("Every alert type has wording, not a bare enum name");
  {
    const ACTIONS = [
      "RECYCLE_BIN_PURGED", "USER_DELETED", "PERMISSIONS_CHANGED",
      "GRANULAR_PERMISSIONS_CHANGED", "MFA_RESET_FOR_USER",
      "WORKLOAD_REASSIGNED", "LEADS_MERGED", "OFFBOARDING_REVOKE_OVERRIDE",
    ];
    for (const action of ACTIONS) {
      sent.length = 0;
      await notifyAdmins({
        action, actorName: "QA Actor", actorEmail: actor.user.email,
        summary: "something happened.",
      });
      const html = sent[0]?.html ?? "";
      expect(sent.length > 0 && !html.includes(action),
        `${action} renders human wording, not the enum`,
        html.includes(action) ? "raw enum leaked into the email" : "");
    }
  }

  // ── The routes are actually wired ─────────────────────────────────────────
  startSection("The six serious routes call it");
  {
    const fs = await import("node:fs");
    const ROUTES = [
      ["app/api/recycle-bin/[id]/route.ts", "RECYCLE_BIN_PURGED"],
      ["app/api/hr/reassignment/route.ts", "WORKLOAD_REASSIGNED"],
      ["app/api/settings/permissions/route.ts", "PERMISSIONS_CHANGED"],
      ["app/api/settings/permissions/granular/route.ts", "GRANULAR_PERMISSIONS_CHANGED"],
      ["app/api/settings/users/[id]/reset-2fa/route.ts", "MFA_RESET_FOR_USER"],
      ["app/api/leads/merge/route.ts", "LEADS_MERGED"],
    ];
    for (const [file, action] of ROUTES) {
      const src = fs.readFileSync(file, "utf8");
      expect(src.includes("notifyAdmins") && src.includes(action),
        `${file.replace("app/api/", "")} raises ${action}`);
      // Not awaited: the operation has already happened and must not fail or
      // wait on an email provider.
      expect(/void notifyAdmins\(/.test(src),
        `  …and does not await it`);
    }
  }

  // ── Routine work stays quiet ──────────────────────────────────────────────
  startSection("Routine work does not trigger an admin alert");
  {
    const fs = await import("node:fs");
    const ROUTINE = [
      "app/api/leads/route.ts",
      "app/api/tasks/route.ts",
      "app/api/hr/leave/route.ts",
    ];
    for (const file of ROUTINE) {
      if (!fs.existsSync(file)) continue;
      expect(!fs.readFileSync(file, "utf8").includes("notifyAdmins"),
        `${file.replace("app/api/", "")} does NOT alert admins`,
        "an alert channel that fires on ordinary work is the same as no alert channel");
    }
  }

  // ── No admin to tell ──────────────────────────────────────────────────────
  startSection("A system with no reachable admin says so");
  {
    // Not simulated by deleting the real admins — that would be a destructive
    // change to the shared mirror. The behaviour is pinned in the source.
    const fs = await import("node:fs");
    const src = fs.readFileSync("lib/admin-alerts.ts", "utf8");
    expect(/NO ACTIVE SUPER ADMIN/.test(src),
      "the no-admin case is logged rather than swallowed",
      "a system with nobody to alert is itself worth knowing about");
    expect(/catch \(err\)/.test(src) && /Never rethrow/.test(src),
      "and a failed alert cannot fail the operation it reports");
  }
} catch (e) {
  console.error("FATAL:", e.message);
  process.exitCode = 1;
} finally {
  globalThis.fetch = realFetch;
  await db.notification.deleteMany({ where: { type: "ADMIN_ALERT" } }).catch(() => {});
  for (const u of made.users) await destroyUser(u);

  const after = { users: await db.user.count(), notifications: await db.notification.count() };
  startSection("Footprint");
  expect(after.users === baseline.users, `users back to ${baseline.users}`, `now ${after.users}`);
  expect(after.notifications === baseline.notifications,
    `notifications back to ${baseline.notifications}`, `now ${after.notifications}`);
  summary();
  await db.$disconnect();
}
