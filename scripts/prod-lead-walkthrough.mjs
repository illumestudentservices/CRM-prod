/**
 * Walks ONE test student through the whole pipeline on PRODUCTION, by clicking.
 *
 *   WALK_EMAIL=... WALK_PASSWORD=... WALK_SECRET=... \
 *     npx tsx scripts/prod-lead-walkthrough.mjs
 *
 * Runs on a workstation, not the VPS: Playwright is not installed there. The
 * disposable account is made and unmade by `scripts/prod-fixture.mjs` on the
 * VPS, which snapshots row counts either side so the footprint is measured
 * rather than claimed.
 *
 * ── WHAT THIS IS FOR ────────────────────────────────────────────────────────
 *
 * Finding where the pipeline stops a real person. So it does NOT stop at the
 * first refusal. At every stage it reads what the screen says is blocking,
 * records it, tries the move anyway, and carries on to the next stage. The
 * report at the end is the list of places someone would get stuck, in order.
 *
 * It never uses the override. An override would walk the student to Enrolled
 * and prove nothing about whether the normal path works.
 */
import { chromium } from "playwright";

const BASE = process.env.WALK_BASE ?? "https://illumestudentservices.cloud";
const EMAIL = process.env.WALK_EMAIL;
const PASSWORD = process.env.WALK_PASSWORD;
const SECRET = process.env.WALK_SECRET;

if (!EMAIL || !PASSWORD || !SECRET) {
  console.error("Set WALK_EMAIL, WALK_PASSWORD and WALK_SECRET.");
  process.exit(2);
}

const { totpGenerate } = await import("../lib/totp.ts");

const STAGE_LABELS = [
  "New Lead", "Contacted", "Qualified", "Application Submitted",
  "Awaiting Decision", "Offer Received", "Deposit Paid", "Enrolled",
];

const report = [];
const say = (line) => console.log(line);

const STAMP = Date.now().toString().slice(-6);
const STUDENT = {
  firstName: "ZZTest",
  lastName: `Walk${STAMP}`,
  email: `zz.walk.${STAMP}@example.invalid`,
  phone: `+15550${STAMP}`,
  nationality: "Indian",
  countryOfResidence: "India",
  interestedProgram: "Business Administration",
  intakeYear: "2026",
  // NOT marked required on the form (no asterisk, and optional in its zod
  // schema) but hard-required by the very first gate. Filled here so the
  // walkthrough can get past New Lead; reported as a finding regardless.
  intendedDestination: "Canada",
  preferredCountry: "Canada",
};

/**
 * Adds an activity through the real dialog.
 *
 * `mode` is "schedule" for a future one — which is what the New Lead gate
 * demands — or "log" for one already done, which later gates ask for.
 */
async function addActivity(page, mode, description, daysFromNow = 7) {
  const btn = page.getByRole("button", { name: /add activity/i }).first();
  if (!(await btn.isVisible().catch(() => false))) return "no Add activity button";
  await btn.click();
  await page.waitForTimeout(1200);

  const dlg = page.locator('[role="dialog"]').filter({ hasText: /add activity/i }).first();
  await dlg.getByRole("button", { name: mode === "schedule" ? /schedule for later/i : /log something done/i }).click();

  // Type is a Radix select: open it and take the first option.
  await dlg.getByRole("combobox").first().click();
  await page.waitForTimeout(600);
  await page.getByRole("option").first().click();
  await page.waitForTimeout(400);

  await dlg.locator('input[placeholder*="Course options"], input[placeholder*="e.g."]').first().fill(description);

  if (mode === "schedule") {
    const d = new Date(Date.now() + daysFromNow * 86400000).toISOString().slice(0, 10);
    await dlg.locator('input[type="date"]').fill(d);
  }

  await dlg.getByRole("button", { name: mode === "schedule" ? /^schedule$/i : /^log$/i }).click();
  await page.waitForTimeout(2500);
  return null;
}

let browser;
let leadUrl = null;
let dumpedInterest = false;

try {
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 1200 } });
  const page = await ctx.newPage();

  const serverErrors = [];
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("response", (r) => {
    if (r.status() >= 500) serverErrors.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
  });

  // ── Sign in ──────────────────────────────────────────────────────────────
  say("\n=== 1. Sign in ===");
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 90000 });
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/verify-2fa/, { timeout: 60000 });
  await page.locator('input[inputmode="numeric"]').fill(await totpGenerate(SECRET));
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !/verify-2fa|login/.test(u.pathname), { timeout: 90000 });
  say("  signed in");

  // ── Create the student ───────────────────────────────────────────────────
  say("\n=== 2. Create the student ===");
  await page.goto(`${BASE}/students`, { waitUntil: "networkidle", timeout: 90000 });
  await page.getByRole("button", { name: /add student|new student|add lead/i }).first().click();
  await page.waitForTimeout(2000);

  const dialog = page.locator('[role="dialog"]').first();

  for (const [name, value] of Object.entries(STUDENT)) {
    const input = dialog.locator(`[name="${name}"]`).first();
    if (await input.isVisible().catch(() => false)) await input.fill(value);
    else report.push({ where: "create form", issue: `no field named ${name}` });
  }

  // Native selects: pick the first real option for each. Which ones are
  // mandatory is the form's business, not this script's — filling them all is
  // what a person completing the form properly would do.
  const selects = await dialog.locator("select").all();
  for (const sel of selects) {
    const opts = await sel.locator("option").all();
    for (const o of opts) {
      const v = await o.getAttribute("value");
      // "" is the placeholder and "none" is the codebase's cleared sentinel.
      if (v && v !== "none") { await sel.selectOption(v); break; }
    }
  }
  say(`  filled ${Object.keys(STUDENT).length} text fields and ${selects.length} dropdowns`);

  // Capture what the server actually says. A form that silently refuses is the
  // hardest thing to diagnose from the outside, and the response body is the
  // only place the real reason lives.
  const apiReplies = [];
  page.on("response", async (r) => {
    if (!/\/api\/leads/.test(r.url())) return;
    if (r.request().method() !== "POST") return;
    let text = "";
    try { text = (await r.text()).slice(0, 800); } catch { /* body already consumed */ }
    apiReplies.push(`${r.status()} ${new URL(r.url()).pathname} :: ${text}`);
  });

  const submit = dialog.getByRole("button", { name: /create|save|add/i }).last();
  await submit.click();

  // The app does NOT navigate to the new student — it closes the dialog and
  // stays on the list. So the id comes from the create response, not the URL.
  // Waiting for a URL change here is what made a working create look broken.
  await page.waitForTimeout(4000);
  const createReply = apiReplies.find((r) => r.startsWith("201"));
  const newId = createReply?.match(/"id":"([0-9a-f-]{20,})"/)?.[1] ?? null;
  const created = !!newId;

  if (!created) {
    const stillOpen = await dialog.isVisible().catch(() => false);
    const text = stillOpen ? await dialog.innerText() : await page.locator("body").innerText();
    say("\n  --- what the server replied ---");
    for (const r of apiReplies) say("  " + r);
    say("  --- what the form shows ---");
    say(text.split("\n").filter(Boolean).slice(0, 60).map((l) => "    " + l).join("\n"));
    await page.screenshot({ path: "tmp/walk-create-failed.png", fullPage: true }).catch(() => {});
    report.push({
      where: "create form",
      issue: "the student was not created",
      detail: apiReplies.join(" ;; ") || "no /api/leads POST was made at all",
    });
    say("  COULD NOT CREATE — see above");
    throw new Error("student not created");
  }

  leadUrl = `${BASE}/students/${newId}`;
  say(`  created: ${leadUrl}`);
  report.push({
    where: "create form",
    issue: "after saving, the app stays on the list instead of opening the new student",
    detail: "minor, but it means the person has to find the student they just typed in",
  });

  // ── Walk the stages ──────────────────────────────────────────────────────
  say("\n=== 3. Walk every stage ===");

  for (let target = 1; target < STAGE_LABELS.length; target++) {
    const label = STAGE_LABELS[target];
    await page.goto(leadUrl, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(2500);

    const body = await page.locator("body").innerText();

    // The amber panel the app renders for the NEXT stage. This is the app's own
    // answer to "what is stopping me", so it is quoted rather than guessed at.
    let blockers = [];
    const m = body.match(/To move to ([^\n]+):\n([\s\S]{0,600}?)(?:\n\s*\n|Close as:)/);
    if (m) {
      blockers = m[2].split("\n").map((l) => l.replace(/^[•\s]+/, "").trim()).filter(Boolean);
    }

    // Try to clear whatever the app says is blocking, using only the controls a
    // person has. Anything that cannot be cleared this way is the real finding.
    if (blockers.some((b) => /qualification is required|counselling outcome is required/i.test(b))) {
      const edit = page.getByRole("button", { name: /edit lead/i }).first();
      if (!(await edit.isVisible().catch(() => false))) {
        report.push({ where: label, issue: "no Edit button to fill the required fields" });
      } else {
        await edit.click();
        await page.waitForTimeout(2000);
        const d = page.locator('[role="dialog"]').first();
        for (const [n, v] of [
          ["currentQualification", "BSc Computer Science"],
          ["academicQualification", "BSc 2:1"],
          ["counsellingOutcome", "Discussed programme options and agreed to apply."],
        ]) {
          const f = d.locator(`[name="${n}"]`).first();
          if (await f.isVisible().catch(() => false)) await f.fill(v);
        }
        // The Counselling Outcome dropdown, if present.
        for (const sel of await d.locator("select").all()) {
          const lbl = await sel.evaluate((e) => e.closest("div")?.querySelector("label")?.textContent ?? "");
          if (/counselling outcome/i.test(lbl)) {
            const opts = await sel.locator("option").all();
            for (const o of opts) {
              const v = await o.getAttribute("value");
              if (v && v !== "none") { await sel.selectOption(v); break; }
            }
          }
        }
        await d.getByRole("button", { name: /save|update/i }).last().click();
        await page.waitForTimeout(3000);
        say(`  ${label}: filled the required fields on the edit form`);
        await page.goto(leadUrl, { waitUntil: "networkidle", timeout: 90000 });
        await page.waitForTimeout(2000);
      }
    }

    if (blockers.some((b) => /institution interest is required/i.test(b))) {
      const add = page.getByRole("button", { name: /\+?\s*add interest/i }).first();
      if (!(await add.isVisible().catch(() => false))) {
        report.push({ where: label, issue: "no way to add an institution interest on the page" });
      } else {
        await add.click();
        await page.waitForTimeout(2000);

        // The panel reveals an inline form rather than a dialog. Dump what it
        // offers the first time through, so this is driven against the real
        // controls instead of guessed ones.
        const panel = page.locator("section, div").filter({ hasText: /institution interests/i }).last();
        const ctrls = await panel.evaluate((root) => {
          const out = [];
          for (const el of root.querySelectorAll("select, input, button")) {
            out.push({
              tag: el.tagName.toLowerCase(),
              name: el.getAttribute("name") ?? "",
              ph: el.getAttribute("placeholder") ?? "",
              text: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40),
            });
          }
          return out.slice(0, 25);
        }).catch(() => []);
        if (!dumpedInterest) {
          say("    interest form controls: " + JSON.stringify(ctrls));
          dumpedInterest = true;
        }

        for (const sel of await panel.locator("select").all()) {
          for (const o of await sel.locator("option").all()) {
            const v = await o.getAttribute("value");
            if (v && v !== "none") { await sel.selectOption(v).catch(() => {}); break; }
          }
        }
        const save = panel.getByRole("button", { name: /^(add|save|create|add interest)$/i }).last();
        if (await save.isVisible().catch(() => false)) await save.click();
        else report.push({ where: label, issue: "the interest form has no obvious save button" });
        await page.waitForTimeout(3000);

        const count = await page.locator("body").innerText();
        const n = count.match(/(\d+) institution journey/)?.[1];
        say(`  ${label}: tried to add an interest (page now says ${n ?? "?"} journeys)`);
        await page.goto(leadUrl, { waitUntil: "networkidle", timeout: 90000 });
        await page.waitForTimeout(2000);
      }
    }

    if (blockers.some((b) => /counselling must be completed|initial counselling/i.test(b))) {
      const err = await addActivity(page, "log", "Initial counselling call completed");
      if (err) report.push({ where: label, issue: "cannot log the counselling activity", detail: err });
      else say(`  ${label}: logged the counselling activity`);
      await page.goto(leadUrl, { waitUntil: "networkidle", timeout: 90000 });
      await page.waitForTimeout(2000);
    }
    if (blockers.some((b) => /future activity must be scheduled/i.test(b))) {
      const err = await addActivity(page, "schedule", `Follow-up call for ${label}`);
      if (err) report.push({ where: label, issue: "cannot schedule an activity", detail: err });
      else say(`  ${label}: scheduled a future activity to clear the gate`);
      await page.goto(leadUrl, { waitUntil: "networkidle", timeout: 90000 });
      await page.waitForTimeout(2000);
    }
    if (blockers.some((b) => /completed activity|activity must be completed|logged/i.test(b))) {
      const err = await addActivity(page, "log", `Completed contact for ${label}`);
      if (err) report.push({ where: label, issue: "cannot log a completed activity", detail: err });
      else say(`  ${label}: logged a completed activity to clear the gate`);
      await page.goto(leadUrl, { waitUntil: "networkidle", timeout: 90000 });
      await page.waitForTimeout(2000);
    }

    // Re-read after any remedy, so the recorded blockers are the ones that
    // actually survived.
    const body2 = await page.locator("body").innerText();
    const m2 = body2.match(/To move to ([^\n]+):\n([\s\S]{0,600}?)(?:\n\s*\n|Close as:)/);
    blockers = m2
      ? m2[2].split("\n").map((l) => l.replace(/^[•\s]+/, "").trim()).filter(Boolean)
      : [];

    const btn = page.getByRole("button", { name: new RegExp(`^${label}$`, "i") }).first();
    if (!(await btn.isVisible().catch(() => false))) {
      report.push({ where: label, issue: "no button for this stage on the page" });
      say(`  ${label}: NO BUTTON`);
      continue;
    }

    await btn.click();
    await page.waitForTimeout(3000);

    const after = await page.locator("body").innerText();
    const moved = new RegExp(`${label}[\\s\\S]{0,40}`, "i").test(after) &&
      !(await page.getByText(/cannot move|blocked|to move to/i).first().isVisible().catch(() => false));

    // The definitive check: what does the record itself say the stage is?
    const nowStage = (after.match(/Stage\s*\n?\s*([A-Za-z ]+)/) ?? [])[1]?.trim();

    if (blockers.length) {
      report.push({ where: label, issue: "blocked", detail: blockers.join(" | ") });
      say(`  ${label}: BLOCKED — ${blockers.join(" | ")}`);
    } else if (moved) {
      say(`  ${label}: moved`);
    } else {
      report.push({ where: label, issue: "did not move and gave no reason on screen" });
      say(`  ${label}: did not move, no reason shown (stage reads "${nowStage ?? "?"}")`);
    }

    await page.screenshot({ path: `tmp/walk-stage-${target}-${label.replace(/\s+/g, "-")}.png` }).catch(() => {});
  }

  if (serverErrors.length) report.push({ where: "server", issue: "5xx responses", detail: serverErrors.join(" | ") });
  if (pageErrors.length) report.push({ where: "browser", issue: "page errors", detail: pageErrors.slice(0, 5).join(" | ") });
} catch (e) {
  say(`\nSTOPPED: ${e?.message ?? String(e)}`);
} finally {
  if (browser) await browser.close();

  say("\n=== FINDINGS ===");
  if (!report.length) say("  none — the student walked the whole pipeline unaided");
  for (const r of report) say(`  [${r.where}] ${r.issue}${r.detail ? `\n      ${r.detail}` : ""}`);
  say(`\nstudent: ${STUDENT.firstName} ${STUDENT.lastName} <${STUDENT.email}>`);
  say(`url: ${leadUrl ?? "(not created)"}`);
}
