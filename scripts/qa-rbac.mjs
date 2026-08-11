#!/usr/bin/env node
/**
 * RBAC matrix + IDOR + auth-bypass suite.
 *
 * Creates one disposable user per role, then for each role probes every
 * dashboard page and a representative slice of the API. The assertion is
 * two-sided and that matters:
 *
 *   • a role that SHOULD have access must not be blocked (over-restriction
 *     is a silent outage — users just see "Forbidden" and file a ticket)
 *   • a role that should NOT have access must be refused, and refused with
 *     403/redirect rather than 500 or, worse, a 200 with real rows in it
 *
 * Then it checks the things a permissions matrix can't:
 *   • IDOR — can a low-privilege user read/mutate a record by guessing its id
 *   • privilege escalation — can a non-admin promote themselves
 *   • unauthenticated access — is every API closed without a session
 */

import {
  db, TAG, api, createAndLogin, destroyUser, Jar,
  startSection, ok, fail, expect, summary, BASE, sleep,
} from "./qa-lib.mjs";
// Mirrored from lib/permissions.ts (TS can't be imported at runtime here).
// If the two drift, this suite will report false failures — which is the
// intended tripwire: the matrix is security config and should not change
// silently.
const NAV_PERMISSIONS = {
  dashboard: ["SUPER_ADMIN", "HQ_EXECUTIVE", "HQ_ANALYTICS", "REGIONAL_MANAGER", "ICR", "INSTITUTION_CLIENT", "HR_MANAGER", "EMPLOYEE"],
  students: ["SUPER_ADMIN", "HQ_EXECUTIVE", "HQ_ANALYTICS", "REGIONAL_MANAGER", "ICR"],
  institutions: ["SUPER_ADMIN", "HQ_EXECUTIVE", "HQ_ANALYTICS", "REGIONAL_MANAGER", "ICR", "INSTITUTION_CLIENT"],
  analytics: ["SUPER_ADMIN", "HQ_EXECUTIVE", "HQ_ANALYTICS", "REGIONAL_MANAGER", "ICR"],
  reports: ["SUPER_ADMIN", "HQ_EXECUTIVE", "HQ_ANALYTICS", "REGIONAL_MANAGER", "ICR", "INSTITUTION_CLIENT"],
  hr: ["SUPER_ADMIN", "HR_MANAGER", "EMPLOYEE", "REGIONAL_MANAGER", "ICR"],
  risk_compliance: ["SUPER_ADMIN", "HQ_EXECUTIVE", "HQ_ANALYTICS", "REGIONAL_MANAGER", "ICR"],
  knowledge: ["SUPER_ADMIN", "HR_MANAGER", "HQ_EXECUTIVE", "HQ_ANALYTICS", "REGIONAL_MANAGER", "ICR", "EMPLOYEE"],
  whatsapp: ["SUPER_ADMIN", "HQ_EXECUTIVE", "REGIONAL_MANAGER", "ICR"],
  tasks: ["SUPER_ADMIN", "REGIONAL_MANAGER", "ICR", "HR_MANAGER", "EMPLOYEE"],
  settings: ["SUPER_ADMIN"],
  activity_log: ["SUPER_ADMIN"],
  recycle_bin: ["SUPER_ADMIN"],
  recruitment_network: ["SUPER_ADMIN", "HQ_EXECUTIVE", "HQ_ANALYTICS", "REGIONAL_MANAGER", "ICR"],
  recruitment_planning: ["SUPER_ADMIN", "HQ_EXECUTIVE", "REGIONAL_MANAGER", "ICR"],
  market_intelligence: ["SUPER_ADMIN", "HQ_EXECUTIVE", "HQ_ANALYTICS", "REGIONAL_MANAGER", "ICR"],
  field_operations: ["SUPER_ADMIN", "HQ_EXECUTIVE", "HQ_ANALYTICS", "REGIONAL_MANAGER", "ICR"],
};

// Roles to exercise. SUPER_ADMIN is the control.
const ROLES = [
  "SUPER_ADMIN",
  "HQ_EXECUTIVE",
  "HQ_ANALYTICS",
  "REGIONAL_MANAGER",
  "ICR",
  "INSTITUTION_CLIENT",
  "HR_MANAGER",
  "EMPLOYEE",
];

// page path → NAV_PERMISSIONS key
const PAGES = [
  ["/dashboard", "dashboard"],
  ["/students", "students"],
  ["/institutions", "institutions"],
  ["/recruitment-network/partners", "recruitment_network"],
  ["/market-intelligence", "market_intelligence"],
  ["/field-operations", "field_operations"],
  ["/recruitment-planning", "recruitment_planning"],
  ["/analytics", "analytics"],
  ["/reports", "reports"],
  ["/tasks", "tasks"],
  ["/hr", "hr"],
  ["/risk-compliance", "risk_compliance"],
  ["/knowledge", "knowledge"],
  ["/whatsapp", "whatsapp"],
  ["/activity-log", "activity_log"],
  ["/settings", "settings"],
  ["/recycle-bin", "recycle_bin"],
];

// Endpoints only SUPER_ADMIN may touch.
const ADMIN_ONLY_APIS = [
  ["GET", "/api/settings/users"],
  ["GET", "/api/settings/permissions"],
  ["GET", "/api/recycle-bin"],
  ["GET", "/api/activity-log"],
];

async function main() {
  const sessions = {};
  const control = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });

  // Reference rows for IDOR probes
  const aLead = await db.lead.findFirst({ where: { deletedAt: null }, select: { id: true } });
  const aInst = await db.institution.findFirst({ where: { deletedAt: null }, select: { id: true } });

  try {
    process.stdout.write(`[setup] creating one user per role…\n`);
    for (const role of ROLES) {
      try {
        sessions[role] = await createAndLogin({ role, withEmployee: true });
        process.stdout.write(`  · ${role}\n`);
      } catch (e) {
        process.stdout.write(`  ✗ ${role}: ${e.message}\n`);
      }
    }

    // ══════════════════════════════════════════════════════════════════
    startSection("Page access matches NAV_PERMISSIONS");
    {
      for (const [path, navKey] of PAGES) {
        const allowed = NAV_PERMISSIONS[navKey] ?? [];
        for (const role of ROLES) {
          const s = sessions[role];
          if (!s) continue;
          const r = await api(s.jar, "GET", path);
          const shouldSee = allowed.includes(role);
          // 200 = rendered. 3xx = redirected away (denied, or a module alias).
          const got200 = r.status === 200;

          const loc = r.headers.get("location") ?? "";
          // A redirect that stays inside the same module is the module working
          // as designed, not a denial — e.g. EMPLOYEE hitting /hr is sent to
          // their own /hr/employees/<id> profile.
          const redirectedWithinModule =
            r.status >= 300 && r.status < 400 && loc.startsWith(path);

          if (r.status >= 500) {
            fail(`${role} → ${path}`, `500`);
          } else if (shouldSee && !got200 && !redirectedWithinModule) {
            // Redirect to login means the session broke, not an RBAC result.
            if (loc.includes("/login")) fail(`${role} → ${path}`, "bounced to login (session lost)");
            else fail(`${role} → ${path}`, `allowed by matrix but got ${r.status} → ${loc}`);
          } else if (!shouldSee && got200) {
            fail(`${role} → ${path}`, `DENIED by matrix but rendered 200`);
          } else {
            ok(`${role.padEnd(19)} ${path.padEnd(34)} ${shouldSee ? "allow" : "deny "} → ${r.status}`);
          }
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════
    startSection("Admin-only APIs refuse every non-admin role");
    {
      for (const [method, path] of ADMIN_ONLY_APIS) {
        for (const role of ROLES) {
          const s = sessions[role];
          if (!s) continue;
          const r = await api(s.jar, method, path);
          if (role === "SUPER_ADMIN") {
            expect(r.ok, `SUPER_ADMIN can ${method} ${path}`, `got ${r.status}`);
          } else if (r.status >= 500) {
            fail(`${role} ${method} ${path}`, "500");
          } else if (r.ok) {
            fail(`${role} ${method} ${path}`, `LEAKED — got 200`);
          } else {
            ok(`${role.padEnd(19)} blocked from ${path} → ${r.status}`);
          }
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════
    startSection("Write-permission enforcement");
    {
      // EMPLOYEE and INSTITUTION_CLIENT must not be able to create core records.
      const writeProbes = [
        ["/api/leads", {
          firstName: `${TAG}X`, lastName: "Y", email: `${TAG.toLowerCase()}.rbac@e.test`,
          phone: "+15550003333", nationality: "T", countryOfResidence: "T",
          interestedProgram: "P", studyLevel: "UNDERGRADUATE", intakeYear: 2027, intakeMonth: 9,
        }],
        ["/api/institutions", { name: `${TAG} RBAC Inst`, country: "T", type: "University" }],
        ["/api/sources", { name: `${TAG} RBAC Partner`, type: "AGENT", country: "T" }],
      ];
      for (const [path, body] of writeProbes) {
        for (const role of ["EMPLOYEE", "INSTITUTION_CLIENT", "HQ_ANALYTICS"]) {
          const s = sessions[role];
          if (!s) continue;
          const r = await api(s.jar, "POST", path, body);
          if (r.status >= 500) {
            fail(`${role} POST ${path}`, "500");
          } else if (r.ok || r.status === 201) {
            fail(`${role} POST ${path}`, `CREATED — read-only role could write`);
            // clean it up immediately
            const id = r.payload?.id ?? r.payload?.data?.id;
            if (id) await db.$executeRawUnsafe(`DELETE FROM ${path.includes("leads") ? "leads" : path.includes("institutions") ? "institutions" : "sources"} WHERE id = '${id}'`).catch(() => {});
          } else {
            ok(`${role.padEnd(19)} cannot POST ${path} → ${r.status}`);
          }
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════
    startSection("IDOR — direct object reference by id");
    {
      // A low-privilege role tries to read and mutate records it has no
      // relationship to, by id.
      const victims = [
        ...(aLead ? [["GET", `/api/leads/${aLead.id}`, "lead"]] : []),
        ...(aInst ? [["GET", `/api/institutions/${aInst.id}`, "institution"]] : []),
        ...(aLead ? [["PATCH", `/api/leads/${aLead.id}`, "lead (write)"]] : []),
        ...(aLead ? [["DELETE", `/api/leads/${aLead.id}`, "lead (delete)"]] : []),
      ];
      for (const role of ["EMPLOYEE", "INSTITUTION_CLIENT", "HR_MANAGER"]) {
        const s = sessions[role];
        if (!s) continue;
        for (const [method, path, what] of victims) {
          const body = method === "PATCH" ? { interestedProgram: `${TAG}-IDOR` } : undefined;
          const r = await api(s.jar, method, path, body);
          if (r.status >= 500) {
            fail(`${role} ${method} ${what}`, "500");
          } else if (r.ok) {
            fail(`${role} ${method} ${what}`, `IDOR — got ${r.status}`);
          } else {
            ok(`${role.padEnd(19)} ${method.padEnd(6)} ${what.padEnd(18)} refused → ${r.status}`);
          }
        }
      }
      // Confirm nothing was actually mutated by the PATCH attempts
      if (aLead) {
        const row = await db.lead.findUnique({ where: { id: aLead.id } });
        expect(row?.interestedProgram !== `${TAG}-IDOR`, "IDOR PATCH did not mutate the record");
        expect(row?.deletedAt == null, "IDOR DELETE did not delete the record");
      }
    }

    // ══════════════════════════════════════════════════════════════════
    startSection("Privilege escalation");
    {
      for (const role of ["EMPLOYEE", "ICR", "HR_MANAGER"]) {
        const s = sessions[role];
        if (!s) continue;
        // Try to promote self to SUPER_ADMIN
        const r = await api(s.jar, "PATCH", `/api/settings/users/${s.user.id}`, { role: "SUPER_ADMIN" });
        if (r.status >= 500) fail(`${role} self-promotion`, "500");
        else if (r.ok) fail(`${role} self-promotion`, `ALLOWED — got ${r.status}`);
        else ok(`${role.padEnd(19)} cannot self-promote → ${r.status}`);

        const after = await db.user.findUnique({ where: { id: s.user.id }, select: { role: true } });
        expect(after?.role === role, `${role} role unchanged in DB after escalation attempt`, `now ${after?.role}`);

        // Try to reset another user's MFA
        const r2 = await api(s.jar, "POST", `/api/settings/users/${control.user.id}/reset-2fa`);
        if (r2.ok) fail(`${role} reset another user's MFA`, "ALLOWED");
        else ok(`${role.padEnd(19)} cannot reset others' MFA → ${r2.status}`);
      }
    }

    // ══════════════════════════════════════════════════════════════════
    startSection("Unauthenticated access is refused");
    {
      const empty = new Jar();
      const probes = [
        "/api/leads", "/api/institutions", "/api/sources", "/api/tasks",
        "/api/settings/users", "/api/recycle-bin", "/api/hr/employees",
        "/api/activity-log", "/api/reports", "/api/risks",
      ];
      for (const p of probes) {
        const r = await api(empty, "GET", p);
        if (r.ok) fail(`unauthenticated GET ${p}`, `LEAKED — got ${r.status}`);
        else if (r.status >= 500) fail(`unauthenticated GET ${p}`, "500");
        else ok(`unauthenticated ${p.padEnd(28)} refused → ${r.status}`);
      }
      // A page should redirect to login, not render
      const page = await api(empty, "GET", "/dashboard");
      const loc = page.headers.get("location") ?? "";
      expect(page.status >= 300 && page.status < 400 && loc.includes("/login"),
        "unauthenticated /dashboard redirects to /login", `${page.status} → ${loc}`);
    }

    // ══════════════════════════════════════════════════════════════════
    startSection("Record enumeration (403 vs 404 consistency)");
    {
      // A nonexistent id and a real-but-forbidden id should look the same to
      // an unauthorised caller, otherwise the difference confirms existence.
      const s = sessions.EMPLOYEE;
      if (s && aLead) {
        const real = await api(s.jar, "GET", `/api/leads/${aLead.id}`);
        const fake = await api(s.jar, "GET", `/api/leads/00000000-0000-0000-0000-000000000000`);
        expect(real.status === fake.status,
          "existing-but-forbidden and nonexistent return the same status",
          `real=${real.status} fake=${fake.status}`);
      }
    }

  } finally {
    process.stdout.write(`\n[cleanup]\n`);
    await db.$executeRawUnsafe(`DELETE FROM leads WHERE "firstName" LIKE '${TAG}%'`).catch(() => {});
    await db.$executeRawUnsafe(`DELETE FROM institutions WHERE name LIKE '${TAG}%'`).catch(() => {});
    await db.$executeRawUnsafe(`DELETE FROM sources WHERE name LIKE '${TAG}%'`).catch(() => {});
    for (const role of Object.keys(sessions)) await destroyUser(sessions[role]);
    await destroyUser(control);
    process.stdout.write(`[cleanup] done\n`);
  }

  const f = summary();
  process.exit(f > 0 ? 1 : 0);
}

main().catch((e) => { console.error("\nHARNESS ERROR:", e); process.exit(2); })
  .finally(() => db.$disconnect());
