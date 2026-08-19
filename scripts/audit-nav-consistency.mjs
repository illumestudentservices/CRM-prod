/**
 * Cross-checks the FIVE places that independently decide what a role can reach.
 *
 *   1. PERMISSION_MATRIX   lib/permissions.ts        resource × action
 *   2. NAV_PERMISSIONS     lib/permissions.ts        module → roles  (proxy.ts route gate)
 *   3. NAV_RESOURCE_MAP    lib/effective-permissions.ts  module → resource (sidebar)
 *   4. PATH_TO_MODULE      proxy.ts                  url prefix → module
 *   5. NAV_ITEMS           components/layout/app-shell-client.tsx  sidebar links
 *
 * Nothing derives these from each other, so they drift, and every past drift
 * has produced the same symptom: a link the user can see and a route that
 * bounces them to /dashboard, or worse, the reverse.
 *
 * Run:  node scripts/audit-nav-consistency.mjs
 * Exits non-zero when a role's sidebar and route gate disagree.
 */
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// ─── Extract each source without importing (these files pull in the DB) ────

function extractNavItems() {
  const src = read("components/layout/app-shell-client.tsx");
  const block = src.slice(src.indexOf("const NAV_ITEMS"), src.indexOf("const ROLE_LABELS"));
  return [...block.matchAll(/key:\s*"([a-z_]+)",\s*label:\s*"([^"]+)",\s*href:\s*"([^"]+)"/g)]
    .map((m) => ({ key: m[1], label: m[2], href: m[3] }));
}

function extractPathToModule() {
  const src = read("proxy.ts");
  const block = src.slice(src.indexOf("const PATH_TO_MODULE"), src.indexOf("function moduleForPath"));
  return [...block.matchAll(/\["(\/[a-z-]+)",\s*"([a-z_]+)"\]/g)].map((m) => ({ prefix: m[1], key: m[2] }));
}

function extractNavResourceMap() {
  const src = read("lib/effective-permissions.ts");
  const block = src.slice(src.indexOf("const NAV_RESOURCE_MAP"), src.indexOf("export async function getEffectiveNavKeys"));
  const out = {};
  for (const m of block.matchAll(/^\s{2}([a-z_]+):\s*(.+?),?\s*$/gm)) {
    const [, key, val] = m;
    if (val.includes("super_admin_only")) out[key] = "super_admin_only";
    else if (val.startsWith("null")) out[key] = null;
    else {
      const r = val.match(/resource:\s*"([a-z_]+)"/);
      if (r) out[key] = { resource: r[1] };
    }
  }
  return out;
}

const permSrc = read("lib/permissions.ts");

function extractMatrix() {
  const block = permSrc.slice(
    permSrc.indexOf("export const PERMISSION_MATRIX"),
    permSrc.indexOf("export function hasPermission")
  );
  const matrix = {};
  const roleRe = /^  ([A-Z_]+):\s*\{$/gm;
  const starts = [...block.matchAll(roleRe)].map((m) => ({ role: m[1], at: m.index }));
  starts.forEach((s, i) => {
    const body = block.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : block.length);
    const res = {};
    for (const m of body.matchAll(/^\s{4}([a-z_]+):\s*\[([^\]]*)\]/gm)) {
      res[m[1]] = [...m[2].matchAll(/"([a-z]+)"/g)].map((x) => x[1]);
    }
    matrix[s.role] = res;
  });
  return matrix;
}

function extractNavPermissions() {
  const block = permSrc.slice(
    permSrc.indexOf("export const NAV_PERMISSIONS"),
    permSrc.indexOf("export type { Role, Resource, Action }")
  );
  const out = {};
  // Strip comments first — role names appear in prose and would be picked up.
  const clean = block.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of clean.matchAll(/([a-z_]+):\s*\[([^\]]*)\]/g)) {
    out[m[1]] = [...m[2].matchAll(/"([A-Z_]+)"/g)].map((x) => x[1]);
  }
  return out;
}

const NAV_ITEMS = extractNavItems();
const PATH_TO_MODULE = extractPathToModule();
const NAV_RESOURCE_MAP = extractNavResourceMap();
const MATRIX = extractMatrix();
const NAV_PERMISSIONS = extractNavPermissions();
const ROLES = Object.keys(MATRIX);

console.log(
  `parsed: ${ROLES.length} roles, ${Object.keys(NAV_PERMISSIONS).length} nav keys, ` +
  `${NAV_ITEMS.length} sidebar items, ${PATH_TO_MODULE.length} path prefixes, ` +
  `${Object.keys(NAV_RESOURCE_MAP).length} resource mappings\n`
);

const findings = [];
const add = (sev, area, msg) => findings.push({ sev, area, msg });

// ─── 1. Sidebar items must have a route gate ───────────────────────────────
for (const item of NAV_ITEMS) {
  const gated = PATH_TO_MODULE.some((p) => item.href === p.prefix || item.href.startsWith(p.prefix + "/"));
  if (!gated) {
    add("HIGH", "proxy",
      `sidebar item "${item.key}" (${item.href}) has no PATH_TO_MODULE entry — ` +
      `proxy.ts applies NO module gate to it, so NAV_PERMISSIONS.${item.key} is unenforced at the route`);
  }
}

// ─── 2. Every nav key needs a resource mapping, or it vanishes from sidebar ─
for (const key of Object.keys(NAV_PERMISSIONS)) {
  if (!(key in NAV_RESOURCE_MAP)) {
    add("MED", "sidebar",
      `NAV_PERMISSIONS.${key} has no NAV_RESOURCE_MAP entry — getEffectiveNavKeys() drops it for every role`);
  }
}
for (const key of Object.keys(NAV_RESOURCE_MAP)) {
  if (!(key in NAV_PERMISSIONS) && key !== "executive_dashboard" && key !== "activities_field") {
    add("LOW", "sidebar", `NAV_RESOURCE_MAP.${key} has no NAV_PERMISSIONS entry`);
  }
}

// ─── 3. The real one: sidebar visibility vs route gate, per role ───────────
//
// getEffectiveNavKeys() decides the sidebar from the MATRIX. proxy.ts decides
// the route from NAV_PERMISSIONS. When they disagree the user gets a link that
// bounces, or a hidden module they can still open by typing the URL.
for (const role of ROLES) {
  for (const item of NAV_ITEMS) {
    const mapping = NAV_RESOURCE_MAP[item.key];
    let sidebarShows;
    if (mapping === "super_admin_only") sidebarShows = role === "SUPER_ADMIN";
    else if (mapping === null || mapping === undefined) sidebarShows = mapping === null;
    else sidebarShows = (MATRIX[role]?.[mapping.resource] ?? []).includes("read");

    // proxy.ts only gates a path it can map to a module. An href with no
    // PATH_TO_MODULE prefix is waved through for every role no matter what
    // NAV_PERMISSIONS says, so it must not be reported as "redirects".
    const gated = PATH_TO_MODULE.some(
      (p) => item.href === p.prefix || item.href.startsWith(p.prefix + "/")
    );
    const allowed = NAV_PERMISSIONS[item.key];
    const proxyAllows = gated && allowed ? allowed.includes(role) : true;

    if (sidebarShows && !proxyAllows) {
      add("HIGH", "drift",
        `${role}: sidebar SHOWS "${item.label}" (${item.href}) but proxy.ts redirects to /dashboard — ` +
        `matrix grants ${mapping?.resource}:read, NAV_PERMISSIONS.${item.key} omits the role`);
    }
    if (!sidebarShows && proxyAllows && allowed && gated) {
      add("MED", "drift",
        `${role}: sidebar HIDES "${item.label}" (${item.href}) but proxy.ts lets the role in — ` +
        `NAV_PERMISSIONS.${item.key} lists it, matrix does not grant ${mapping?.resource}:read`);
    }
  }
}

// ─── 4. Actions granted on a resource the role cannot read ─────────────────
for (const role of ROLES) {
  for (const [resource, actions] of Object.entries(MATRIX[role] ?? {})) {
    if (actions.length > 0 && !actions.includes("read")) {
      add("MED", "matrix",
        `${role}: holds [${actions.join(", ")}] on "${resource}" without "read" — ` +
        `can act on records it cannot list`);
    }
  }
}

// ─── Report ────────────────────────────────────────────────────────────────
const order = { HIGH: 0, MED: 1, LOW: 2 };
findings.sort((a, b) => order[a.sev] - order[b.sev] || a.area.localeCompare(b.area));

if (findings.length === 0) {
  console.log("NAV CONSISTENCY: clean — all five sources agree.");
  process.exit(0);
}
let last = "";
for (const f of findings) {
  if (f.sev !== last) { console.log(`\n─── ${f.sev} ───`); last = f.sev; }
  console.log(`  [${f.area}] ${f.msg}`);
}
const high = findings.filter((f) => f.sev === "HIGH").length;
console.log(`\nNAV CONSISTENCY: ${findings.length} finding(s), ${high} high`);
process.exit(high > 0 ? 1 : 0);
