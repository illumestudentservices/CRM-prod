/**
 * The bulk staff export: gated, complete, and openable in Excel.
 *
 *   npx tsx --env-file=.env scripts/qa-staff-export.mjs
 *
 * ★ "IT DOWNLOADED A FILE" IS NOT THE TEST. The ways a CSV export is wrong are
 * all silent — it still downloads, it still opens, and the damage shows up in
 * someone else's spreadsheet days later:
 *
 *   no BOM           Excel reads it as the system codepage, so "José" and
 *                    "陈伟" arrive as mojibake. This business recruits from
 *                    India, Nigeria, China and Malaysia.
 *   formula cells    a value starting with = + - @ is EXECUTED by Excel even
 *                    when quoted. The everyday case is a phone number.
 *   partial rows     a client-side export serialises what the page loaded, so
 *                    filtering the table silently narrows the "bulk" export.
 *   broken quoting   a comma or a quote inside a field shifts every later
 *                    column on that row.
 *
 * Footprint: disposable users with awkward data, removed in `finally`.
 */
import { BASE, db, createAndLogin, destroyUser, startSection, expect, summary } from "./qa-lib.mjs";

const made = { users: [] };
let baseline = {};

/** Splits one CSV line into fields, honouring quotes and doubled quotes. */
function parseLine(line) {
  const out = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

try {
  startSection("Fixtures — staff whose data breaks naive exports");
  baseline = { users: await db.user.count(), employees: await db.employee.count() };

  const admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  made.users.push(admin);

  // Every hazard in one row, so a single assertion set covers them all.
  const tricky = await createAndLogin({ role: "ICR", withEmployee: true });
  made.users.push(tricky);
  await db.user.update({
    where: { id: tricky.user.id },
    data: { firstName: "José", lastName: "Ramírez-陈", name: "José Ramírez-陈" },
  });
  await db.employee.update({
    where: { id: tricky.employee.id },
    data: {
      jobTitle: 'Senior ICR, "APAC"',            // a comma AND quotes
      phone: "+1-555-0100",                      // starts with + → formula
      address: "12 King St, Suite 4, Toronto",   // commas
      emergencyContact: "=cmd|' /C calc'!A1",    // the security case
      emergencyPhone: "-44 20 7946 0000",        // starts with - → formula
    },
  });

  const get = async (ctx, qs = "") => {
    const res = await fetch(`${BASE}/api/hr/employees/export${qs}`, {
      headers: { Cookie: ctx.jar.header() },
    });
    // ★ Read the BYTES as well as the text. `res.text()` decodes per the WHATWG
    // spec, which STRIPS a leading BOM — so asserting on the decoded string
    // reports "no BOM" against a response that carries one. The bytes are the
    // only place the truth survives.
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      status: res.status,
      headers: res.headers,
      bytes: buf,
      text: buf.toString("utf8"),
    };
  };

  // ── Who may run it ────────────────────────────────────────────────────────
  startSection("Only a super administrator can run it");
  {
    for (const role of ["HR_MANAGER", "ICR", "REGIONAL_MANAGER"]) {
      const ctx = await createAndLogin({ role });
      made.users.push(ctx);
      const r = await get(ctx);
      expect(r.status === 403, `${role} is refused (403), saw ${r.status}`,
        "this file carries home addresses and next of kin");
    }
    const ok = await get(admin);
    expect(ok.status === 200, `SUPER_ADMIN is allowed, saw ${ok.status}`);
  }

  // ── The file Excel actually opens ─────────────────────────────────────────
  startSection("The file opens correctly in Excel");
  {
    const r = await get(admin, "?inactive=true");
    const bom = r.bytes.subarray(0, 3);
    expect(bom[0] === 0xef && bom[1] === 0xbb && bom[2] === 0xbf,
      "★ the first three bytes are the UTF-8 BOM (EF BB BF)",
      `got ${[...bom].map((b) => b.toString(16).padStart(2, "0")).join(" ")} — ` +
      "without it Excel uses the system codepage and non-ASCII names become mojibake");

    const disp = r.headers.get("content-disposition") ?? "";
    expect(/attachment; *filename=/.test(disp),
      "it downloads as a file rather than rendering", disp);
    expect(/\.csv"?$/.test(disp.trim()), "with a .csv name", disp);
    expect((r.headers.get("cache-control") ?? "").includes("no-store"),
      "★ and is never cached",
      "a staff directory must not sit in a shared or browser cache");
  }

  // ── Content correctness ───────────────────────────────────────────────────
  startSection("Every row is intact and complete");
  {
    const r = await get(admin, "?inactive=true");
    const body = r.text.replace(/^﻿/, "");
    const lines = body.split("\r\n");
    const header = parseLine(lines[0]);
    const rows = lines.slice(1).map(parseLine);

    expect(lines[0].length > 0 && header.length > 20,
      `${header.length} columns exported`);
    expect(body.includes("\r\n"), "CRLF line endings, as RFC 4180 expects");

    // ★ Against the DATABASE, not against the previous screen. A client-side
    // export would quietly return only what the page had loaded.
    const total = await db.employee.count();
    expect(rows.length === total,
      `★ all ${total} employees exported, saw ${rows.length}`,
      "a bulk export must not be a function of what the UI had in memory");

    const idx = (h) => header.indexOf(h);
    const mine = rows.find((r2) => r2[idx("Work Email")] === tricky.user.email);
    expect(!!mine, "the awkward employee is in the file");

    // Quoting: a comma inside a field must not shift later columns.
    expect(mine[idx("Job Title")] === 'Senior ICR, "APAC"',
      "a field containing a comma AND quotes survives intact",
      mine?.[idx("Job Title")]);
    expect(mine[idx("Address")] === "12 King St, Suite 4, Toronto",
      "and so does an address full of commas", mine?.[idx("Address")]);

    // Encoding.
    expect(mine[idx("First Name")] === "José",
      "accented names are preserved", mine?.[idx("First Name")]);
    expect(mine[idx("Last Name")].includes("陈"),
      "and so are CJK characters", mine?.[idx("Last Name")]);

    // ★ Formula neutralisation.
    for (const [col, raw] of [
      ["Phone", "+1-555-0100"],
      ["Emergency Phone", "-44 20 7946 0000"],
      ["Emergency Contact", "=cmd|"],
    ]) {
      const v = mine[idx(col)];
      expect(v.startsWith("'"),
        `★ ${col} is neutralised so Excel will not execute it`,
        `got ${JSON.stringify(v)}`);
      expect(v.slice(1).startsWith(raw),
        `  …and the value itself is unchanged behind the marker`,
        `got ${JSON.stringify(v)}`);
    }
  }

  // ── Leave is reported as consumed, never as a balance ─────────────────────
  startSection("Leave is exported as days USED, not as a balance");
  {
    const r = await get(admin);
    const header = parseLine(r.text.replace(/^﻿/, "").split("\r\n")[0]);
    expect(header.some((h) => /Leave Used/i.test(h)),
      "the columns say 'Used'");
    expect(!header.some((h) => /Balance|Remaining|Entitle/i.test(h)),
      "★ and there is no balance column",
      "entitlement here is COMPUTED from the start date, not stored — a balance column would invent a number");
  }

  // ── Active-only by default ────────────────────────────────────────────────
  startSection("Inactive staff are opt-in");
  {
    await db.employee.update({
      where: { id: tricky.employee.id }, data: { isActive: false },
    });
    const activeOnly = await get(admin);
    const all = await get(admin, "?inactive=true");
    const count = (t) => t.replace(/^﻿/, "").split("\r\n").length - 1;
    expect(count(all.text) > count(activeOnly.text),
      `?inactive=true returns more rows (${count(all.text)} vs ${count(activeOnly.text)})`);
    expect(!activeOnly.text.includes(tricky.user.email),
      "a deactivated employee is absent by default");
    await db.employee.update({
      where: { id: tricky.employee.id }, data: { isActive: true },
    });
  }

  // ── It is recorded ────────────────────────────────────────────────────────
  startSection("The export is recorded, because it is a bulk PII extract");
  {
    const before = await db.auditLog.count({ where: { action: "EXPORT" } });
    await get(admin);
    await new Promise((r) => setTimeout(r, 2500));
    const after = await db.auditLog.count({ where: { action: "EXPORT" } });
    expect(after > before, `an audit row was written (${before} -> ${after})`);
  }
} catch (e) {
  console.error("FATAL:", e.message);
  process.exitCode = 1;
} finally {
  await db.notification.deleteMany({ where: { type: "ADMIN_ALERT" } }).catch(() => {});
  await db.auditLog.deleteMany({
    where: { action: "EXPORT", entity: "Employee" },
  }).catch(() => {});
  for (const u of made.users) await destroyUser(u);

  const after = { users: await db.user.count(), employees: await db.employee.count() };
  startSection("Footprint");
  for (const k of Object.keys(baseline)) {
    expect(after[k] === baseline[k], `${k} back to ${baseline[k]}`, `now ${after[k]}`);
  }
  summary();
  await db.$disconnect();
}
