/**
 * The help widget's search, exercised against real questions.
 *
 *   node --import tsx --env-file=.env scripts/qa-assistant.mjs
 *
 * Two things are being tested, and the second matters more:
 *
 *   1. Does it find the right screen for the way people actually type?
 *   2. Does it refuse to disclose features the asker cannot access — and, for
 *      the one externally-held role, refuse to reveal that they exist at all?
 *
 * No login is needed: the search is a pure function of the query and the role,
 * which is the point of doing it deterministically.
 */

import { startSection, expect, ok, fail, summary } from "./qa-lib.mjs";

const { answer } = await import("../lib/assistant-search.ts");
const { FEATURE_CATALOGUE } = await import("../lib/assistant-catalog.ts");
const { detectIntent } = await import("../lib/assistant-stats.ts");
const { db } = await import("./qa-lib.mjs");

/** [question, expected top match key] — phrased as staff would type them. */
const PHRASINGS = [
  ["where are my students", "students"],
  ["leads", "students"],
  ["applicants", "students"],
  ["where do I see the pipeline", "students"],
  ["universities we represent", "institutions"],
  ["clients", "institutions"],
  ["how do I log a call", "activities"],
  ["my to do list", "tasks"],
  ["book a trip", "travel"],
  ["travel requests", "travel"],
  ["handover", "icr_transition"],
  ["someone is leaving", "icr_transition"],
  ["transition report", "icr_transition"],
  ["quarterly plan", "recruitment_planning"],
  ["budget", "recruitment_planning"],
  ["risk register", "risk_compliance"],
  ["counsellors", "stakeholders"],
  ["school visits", "field_operations"],
  ["holiday", "hr"],
  ["timesheets", "hr"],
  ["change my password", "account"],
  ["deleted records", "recycle_bin"],
  ["users and roles", "settings"],
  ["whatsapp messages", "whatsapp"],
];

async function main() {
  startSection("Finding the right screen (SUPER_ADMIN)");
  let hits = 0;
  for (const [q, expectedKey] of PHRASINGS) {
    const r = await answer(q, "SUPER_ADMIN");
    const top = r.matches[0]?.key;
    const good = r.kind === "found" && top === expectedKey;
    if (good) hits++;
    expect(good, `"${q}" -> ${expectedKey}`, `got ${r.kind}${top ? " / " + top : ""}`);
  }
  ok(`${hits}/${PHRASINGS.length} phrasings resolved to the intended screen`);

  startSection("Questions asking for a number get a number");
  {
    // Intent detection is pure, so it is checked without touching the database.
    const shouldCount = [
      ["how many students do I have", "pipeline"],
      ["number of leads", "pipeline"],
      ["how many clients", "clients"],
      ["what's on my plate", "my_work"],
      ["my outstanding tasks", "my_work"],
    ];
    for (const [q, expected] of shouldCount) {
      expect(detectIntent(q) === expected, `"${q}" is a ${expected} question`,
        String(detectIntent(q)));
    }
  }
  {
    // The other half: a plain navigation question must NOT be hijacked into a
    // count. "students" means "take me to Students", not "tell me how many".
    for (const q of ["students", "where are my students", "leads", "clients", "my to do list"]) {
      expect(detectIntent(q) === null,
        `*** "${q}" stays a navigation question ***`, String(detectIntent(q)));
    }
  }
  {
    // End to end, against the mirror, as a real role.
    const icr = await db.user.findFirst({ where: { role: "ICR" }, select: { id: true } });
    const admin = await db.user.findFirst({ where: { role: "SUPER_ADMIN" }, select: { id: true } });
    if (admin) {
      const r = await answer("how many students do I have", "SUPER_ADMIN", admin.id);
      expect(r.kind === "stats", "*** a count question returns figures ***", r.kind);
      expect((r.stats?.lines?.length ?? 0) > 0, "the figures are populated",
        JSON.stringify(r.stats?.lines?.slice(0, 2)));
      expect(r.stats?.route === "/students",
        "*** the figures link back to the screen they came from ***", r.stats?.route);
    }
    if (icr) {
      // Scope check: an ICR's pipeline count must not be the whole table.
      const all = await db.lead.count({ where: { deletedAt: null } });
      const r = await answer("how many students", "ICR", icr.id);
      const total = Number(r.stats?.lines?.[0]?.value ?? "-1");
      expect(r.kind === "stats" && total <= all,
        "*** an ICR's count is scoped, not the whole table ***", `${total} of ${all}`);
    }
  }
  {
    // Not entitled -> falls through to the normal answer rather than reporting
    // zero, which would read as "there are none".
    const emp = await db.user.findFirst({ where: { role: "EMPLOYEE" }, select: { id: true } });
    const r = await answer("how many students do I have", "EMPLOYEE", emp?.id ?? "x");
    expect(r.kind !== "stats",
      "*** a role without access is not given a figure ***", r.kind);
  }

  startSection("A figures answer is a success, not a miss");
  {
    // The route escalates anything that is not an answer. "stats" IS an answer,
    // and treating it as a miss emailed IT about questions the widget handled.
    const admin = await db.user.findFirst({ where: { role: "SUPER_ADMIN" }, select: { id: true } });
    if (admin) {
      const r = await answer("how many students do I have", "SUPER_ADMIN", admin.id);
      expect(r.kind === "stats", "a count question answers with figures", r.kind);
      expect(["found", "stats"].includes(r.kind),
        "*** and counts as answered, so it is not escalated ***", r.kind);
    }
  }

  startSection("Typos still find the screen");
  {
    const typos = [
      ["studnets", "students"],
      ["trasnition", "icr_transition"],
      ["instutions", "institutions"],
      ["analitics", "analytics"],
      ["complaince", "risk_compliance"],
    ];
    for (const [q, expected] of typos) {
      const r = await answer(q, "SUPER_ADMIN");
      expect(r.kind === "found" && r.matches[0]?.key === expected,
        `misspelt "${q}" still finds ${expected}`,
        `${r.kind} / ${r.matches[0]?.key ?? "-"}`);
    }
  }
  {
    // The guard on the other side: fuzzy matching must not turn a real word
    // into a different real word. Short tokens get no slack for this reason.
    const r = await answer("marks", "SUPER_ADMIN");
    expect(r.matches[0]?.key !== "tasks",
      "*** a short real word is not fuzzily matched to another ***",
      r.matches[0]?.key ?? "-");
  }
  {
    // And correct spelling must still win outright.
    const r = await answer("tasks", "SUPER_ADMIN");
    expect(r.matches[0]?.key === "tasks",
      "*** an exact match outranks any near-miss ***", r.matches[0]?.key ?? "-");
  }

  startSection("Things inside a module");
  {
    const subs = [
      ["where do I add a contract", "contracts"],
      ["renewal date", "contracts"],
      ["raise a complaint about a client", "client_issues"],
      ["book time off", "leave"],
      ["annual leave", "leave"],
      ["log my hours", "timesheet_entries"],
      ["offer received", "applications"],
      ["student withdrew", "close_student"],
      ["visa refused", "close_student"],
      ["bulk reassign", "reassign"],
      ["grant permission", "permissions"],
      ["budget item", "plan_budget"],
    ];
    for (const [q, expected] of subs) {
      const r = await answer(q, "SUPER_ADMIN");
      expect(r.kind === "found" && r.matches[0]?.key === expected,
        `"${q}" -> ${expected}`, `${r.kind} / ${r.matches[0]?.key ?? "-"}`);
    }
  }
  {
    // Sub-features inherit their parent's resource, so permission filtering
    // must still apply — an employee has no institutions access, so Contracts
    // must not surface for them.
    const r = await answer("where do I add a contract", "EMPLOYEE");
    expect(r.kind !== "found",
      "*** a sub-feature respects the parent's permission ***", r.kind);
  }

  startSection("Newly catalogued modules");
  {
    for (const [q, expected] of [
      ["audit trail", "activity_log"],
      ["who changed what", "activity_log"],
      ["education fair", "events"],
      ["lead source", "sources"],
    ]) {
      const r = await answer(q, "SUPER_ADMIN");
      expect(r.kind === "found" && r.matches[0]?.key === expected,
        `"${q}" -> ${expected}`, `${r.kind} / ${r.matches[0]?.key ?? "-"}`);
    }
  }

  startSection("Genuinely ambiguous words offer both options");
  {
    // "agents" means recruitment partners AND stakeholder agents. Rather than
    // pick one and be wrong half the time, both must appear so the user chooses.
    const r = await answer("agents", "SUPER_ADMIN");
    const keys = r.matches.map((m) => m.key);
    expect(keys.includes("recruitment_network") && keys.includes("stakeholders"),
      "*** an ambiguous term offers both matching modules ***", keys.join(", "));
  }

  startSection("Answers carry a route and what you can do");
  {
    const r = await answer("students", "SUPER_ADMIN");
    expect(r.matches[0]?.route === "/students", "the answer includes a link", r.matches[0]?.route);
    expect(/\/students/.test(r.message), "the message names the path");
    expect(r.matches[0].can.length > 0, "an admin is told they can act, not just view",
      JSON.stringify(r.matches[0].can));
  }
  {
    // Same question, weaker role: the capability sentence must differ.
    const r = await answer("students", "HQ_ANALYTICS");
    expect(r.kind === "found", "analytics can still find students");
    expect(!r.matches[0].can.includes("write"),
      "*** a read-only role is not told it can edit ***", JSON.stringify(r.matches[0].can));
  }

  startSection("Restricted features: exists, but not for you");
  {
    const r = await answer("users and roles", "EMPLOYEE");
    expect(r.kind === "restricted",
      "*** an employee is told Settings exists but is out of reach ***", r.kind);
    expect(r.matches.length === 0, "no link is offered to a screen they cannot open");
    expect(/ask/i.test(r.message), "the answer says who to ask", r.message.slice(0, 80));
  }
  {
    const r = await answer("student pipeline", "EMPLOYEE");
    expect(r.kind === "restricted", "an employee cannot reach students", r.kind);
  }

  startSection("External role: restricted features are not disclosed at all");
  {
    // The sharp case. An INSTITUTION_CLIENT is a partner university, not staff.
    // Telling them "HR exists but you can't see it" leaks the shape of Illume's
    // internal systems, so it must be indistinguishable from "no such thing".
    const internalOnly = ["timesheets", "users and roles", "risk register", "handover"];
    for (const q of internalOnly) {
      const r = await answer(q, "INSTITUTION_CLIENT");
      expect(r.kind !== "restricted",
        `*** "${q}" is not disclosed to an external client ***`, r.kind);
      const leaked = r.matches.filter((m) =>
        ["hr", "settings", "risk_compliance", "icr_transition"].includes(m.key)
      );
      expect(leaked.length === 0,
        `*** no internal module leaks for "${q}" ***`, leaked.map((l) => l.key).join(","));
    }
  }
  {
    // A miss must look identical whether the feature is absent or withheld.
    const absent = await answer("zzzz nonexistent thing", "INSTITUTION_CLIENT");
    const withheld = await answer("timesheets", "INSTITUTION_CLIENT");
    expect(absent.kind === withheld.kind,
      "*** absent and withheld are indistinguishable to an external role ***",
      `${absent.kind} vs ${withheld.kind}`);
  }

  startSection("A miss is still useful");
  {
    const r = await answer("qwertyuiop", "ICR");
    expect(r.kind === "not_found", "unmatched question reports not found", r.kind);
    expect(r.matches.length > 0,
      "*** a miss still lists what the user CAN reach ***", `${r.matches.length}`);
    // ICR legitimately holds erp:read, so HR appearing here is correct — the
    // original assertion was wrong about the matrix, not about the code.
    // Settings is the module an ICR genuinely cannot reach.
    const forbidden = r.matches.filter((m) => ["settings", "recycle_bin"].includes(m.key));
    expect(forbidden.length === 0,
      "*** the fallback list never includes inaccessible screens ***",
      forbidden.map((f) => f.key).join(","));
  }

  startSection("Every role gets a coherent answer");
  {
    const roles = [
      "SUPER_ADMIN", "HQ_EXECUTIVE", "HQ_ANALYTICS", "REGIONAL_MANAGER", "ICR",
      "INSTITUTION_CLIENT", "HR_MANAGER", "EMPLOYEE", "ACCOUNT_MANAGER",
      "ADMISSIONS_SUPPORT", "VP_GLOBAL_SALES",
    ];
    for (const role of roles) {
      const r = await answer("students", role);
      const sane = ["found", "restricted", "not_found"].includes(r.kind) && !!r.message;
      expect(sane, `${role} gets a usable answer`, r.kind);
      // Whatever the outcome, a link must never point at something they cannot open.
      expect(r.matches.every((m) => !!m.route), `${role}: every match has a route`);
    }
  }

  startSection("Catalogue integrity");
  {
    const keys = FEATURE_CATALOGUE.map((e) => e.key);
    expect(new Set(keys).size === keys.length, "no duplicate catalogue keys");
    expect(FEATURE_CATALOGUE.every((e) => e.aliases.length > 0),
      "every feature has at least one alias");
    expect(FEATURE_CATALOGUE.every((e) => e.route.startsWith("/")),
      "every route is absolute");
  }
}

try {
  await main();
} catch (e) {
  console.error("\n[harness crashed]", e?.message ?? "", "\n", e);
  fail("harness crashed", String(e?.message).slice(0, 140));
}
summary();
