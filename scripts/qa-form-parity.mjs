/**
 * The offline capture sheet asks for the same things as the office form.
 *
 *   npx tsx scripts/qa-form-parity.mjs
 *
 * ★ WHY THIS IS A SOURCE CHECK AND NOT A BROWSER ONE.
 *
 * The two forms drift by OMISSION, and an omission is invisible to a test that
 * drives a screen: nothing errors, nothing looks wrong, the field is simply not
 * there. Somebody adds a question to the office form — as happened with lead
 * temperature, and before that with three of the four consent channels — and
 * the booth keeps collecting leads that are missing it. Nobody finds out until
 * a student is stuck at New Lead months later.
 *
 * So this reads both files and compares the field keys directly. It is the only
 * check here that fails the moment the two diverge, rather than the first time
 * somebody notices.
 *
 * The same reasoning covers the sync route: a field can exist on both forms and
 * still be dropped on upload, because `capturedLeadSchema` is not `.strict()`
 * and silently discards what it does not list.
 *
 * Read-only: no server, no database, no fixtures.
 */
import fs from "node:fs";
import { startSection, expect, summary } from "./qa-lib.mjs";

const ONLINE = "app/(dashboard)/students/_components/lead-form.tsx";
const OFFLINE = "app/(dashboard)/students/offline/_components/offline-capture-client.tsx";
const SYNC = "app/api/leads/offline-sync/route.ts";

/** Every `name="…"` on a <FormField> / <Field> in the file. */
function fieldKeys(file) {
  const src = fs.readFileSync(file, "utf8");
  const keys = new Set();
  for (const m of src.matchAll(/<(?:Form)?Field\b[^>]*?\bname="([a-zA-Z]+)"/g)) {
    keys.add(m[1]);
  }
  return keys;
}

/**
 * Differences that are deliberate, each with the reason it is allowed.
 *
 * An allowlist rather than a loose comparison: a new gap has to be argued for
 * here, in writing, instead of quietly joining a tolerated set.
 */
const OFFLINE_ONLY = {
  eventId:
    "the booth is AT an event; a lead typed up at a desk is not, so the office form has no Event picker",
};
const ONLINE_ONLY = {
  // (none — the office form must not ask anything the booth cannot)
};

try {
  startSection("Both forms can be read");
  for (const f of [ONLINE, OFFLINE, SYNC]) {
    expect(fs.existsSync(f), `${f.split("/").pop()} exists`);
  }

  const online = fieldKeys(ONLINE);
  const offline = fieldKeys(OFFLINE);

  expect(online.size > 20, `the office form exposes ${online.size} fields`);
  expect(offline.size > 20, `the offline sheet exposes ${offline.size} fields`);

  // ── The headline ─────────────────────────────────────────────────────────
  startSection("The offline sheet asks for everything the office form does");
  {
    const missing = [...online].filter((k) => !offline.has(k) && !(k in ONLINE_ONLY));
    expect(missing.length === 0,
      "★ no question on the office form is absent from the booth",
      `missing offline: ${missing.join(", ")}`);
  }

  startSection("…and nothing extra that is not accounted for");
  {
    const extra = [...offline].filter((k) => !online.has(k) && !(k in OFFLINE_ONLY));
    expect(extra.length === 0,
      "★ every offline-only field has a stated reason",
      `unexplained offline-only: ${extra.join(", ")}`);
    for (const [k, why] of Object.entries(OFFLINE_ONLY)) {
      expect(offline.has(k), `  ${k} is still there — ${why}`);
    }
  }

  // ── The upload has to carry them ─────────────────────────────────────────
  startSection("Every captured field survives the upload");
  {
    const sync = fs.readFileSync(SYNC, "utf8");
    // The schema object only; the write below it would otherwise make an
    // unlisted key look listed.
    const schema = sync.slice(
      sync.indexOf("const capturedLeadSchema"),
      sync.indexOf("const syncSchema")
    );
    expect(schema.length > 200, "the captured-lead schema was located");

    // Keys the device sends that are not identity/queue bookkeeping.
    const SKIP = new Set(["notes"]); // free text, already covered below
    const unlisted = [...offline].filter(
      (k) => !SKIP.has(k) && !new RegExp(`\\b${k}\\s*:`).test(schema)
    );
    expect(unlisted.length === 0,
      "★ the sync schema lists every field the sheet collects",
      `NOT listed, so stripped in silence on upload: ${unlisted.join(", ")}`);

    // And each one has to be written, not merely accepted.
    const write = sync.slice(sync.indexOf("db.lead.create"), sync.indexOf("leadActivity.create"));
    const unwritten = [...offline].filter(
      (k) => !new RegExp(`\\b${k}\\s*:`).test(write)
    );
    expect(unwritten.length === 0,
      "★ …and writes every one of them to the student record",
      `accepted but never written: ${unwritten.join(", ")}`);
  }

  // ── Shared option lists, not two hand-written copies ─────────────────────
  startSection("The two forms share their option lists");
  {
    const on = fs.readFileSync(ONLINE, "utf8");
    const off = fs.readFileSync(OFFLINE, "utf8");
    for (const list of [
      "LEAD_TEMPERATURES", "BUDGET_RANGES", "ENGLISH_STATUSES",
      "STUDY_LEVELS", "COUNSELLING_OUTCOMES", "LEAD_CHANNELS",
    ]) {
      expect(on.includes(list) && off.includes(list),
        `${list} comes from lib/lead-options.ts on both`,
        `online=${on.includes(list)} offline=${off.includes(list)}`);
    }
    // ★ The channel list used to be eleven hand-written <SelectItem>s. A second
    // copy on the offline sheet is how a value drifts from the Prisma enum, and
    // a drifted value is stripped by zod and reads back as "it didn't save".
    expect(!/SelectItem value="AGENT_REFERRAL"/.test(on + off),
      "★ no hand-written copy of the channel list survives");
  }
} catch (e) {
  console.error("FATAL:", e.message);
  process.exitCode = 1;
} finally {
  summary();
}
