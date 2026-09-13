/**
 * A hands-on driver for testing production by clicking, one step at a time.
 *
 *   MS_EMAIL=.. MS_PASSWORD=.. MS_SECRET=.. npx tsx scripts/manual-step.mjs login
 *   npx tsx scripts/manual-step.mjs open /students/<id>
 *   npx tsx scripts/manual-step.mjs dump
 *   npx tsx scripts/manual-step.mjs click "Edit Lead"
 *
 * The session is saved to tmp/manual-state.json between runs, so signing in
 * happens once and each later step starts where the last one finished.
 *
 * Written because a single long script kept failing on a guessed selector and
 * reporting it as a product bug. Every command here ENDS BY DUMPING what is
 * actually on screen — the visible buttons, the current stage, the blockers —
 * so the next step is written against the page rather than against a hope.
 *
 * `state` is deliberately not deleted on failure: when something goes wrong the
 * session is exactly what is needed to look at it.
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.MS_BASE ?? "https://illumestudentservices.cloud";
const STATE = "tmp/manual-state.json";
const LAST = "tmp/manual-last.json";

const [, , cmd, ...args] = process.argv;
mkdirSync("tmp", { recursive: true });

const lastUrl = existsSync(LAST) ? JSON.parse(readFileSync(LAST, "utf8")).url : `${BASE}/dashboard`;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 1200 },
  ...(existsSync(STATE) ? { storageState: STATE } : {}),
});
const page = await ctx.newPage();

const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 140)));
page.on("response", (r) => {
  if (r.status() >= 400 && /\/api\//.test(r.url())) {
    errors.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
  }
});

/** Everything needed to decide the next move. */
async function dump() {
  await page.waitForTimeout(2500);
  const url = page.url();
  const body = await page.locator("body").innerText();

  const buttons = [...new Set(
    await page.locator("button:visible").evaluateAll((els) =>
      els.map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim()).filter(Boolean)
    )
  )];

  const stageBlock = body.match(/To move to ([^\n]+):\n([\s\S]{0,500}?)(?:\n\s*\n|Close as:)/);
  const journeys = body.match(/(\d+) institution journey/)?.[1];

  console.log("URL:", url);
  console.log("\nBUTTONS:", JSON.stringify(buttons));
  if (stageBlock) {
    console.log(`\nGATE — to reach ${stageBlock[1]}:`);
    for (const l of stageBlock[2].split("\n").map((x) => x.replace(/^[•\s]+/, "").trim()).filter(Boolean)) {
      console.log("   -", l);
    }
  } else {
    console.log("\nGATE: (no blocker panel on screen)");
  }
  if (journeys !== undefined) console.log("\nJOURNEYS:", journeys);

  const dlg = page.locator('[role="dialog"]').first();
  if (await dlg.isVisible().catch(() => false)) {
    const dt = await dlg.innerText();
    console.log("\nDIALOG OPEN. First 40 lines:");
    console.log(dt.split("\n").filter(Boolean).slice(0, 40).map((l) => "   " + l).join("\n"));
    const fields = await dlg.evaluate((root) => {
      const out = [];
      for (const el of root.querySelectorAll("input, textarea, select, [role='combobox']")) {
        out.push({
          tag: el.tagName.toLowerCase(),
          name: el.getAttribute("name") ?? "",
          type: el.getAttribute("type") ?? el.getAttribute("role") ?? "",
          ph: el.getAttribute("placeholder") ?? "",
          label: el.closest("div")?.querySelector("label")?.textContent?.trim() ?? "",
        });
      }
      return out;
    });
    console.log("\nDIALOG FIELDS:", JSON.stringify(fields));
  }

  if (errors.length) console.log("\nERRORS:", JSON.stringify([...new Set(errors)]));
  writeFileSync(LAST, JSON.stringify({ url }), "utf8");
}

try {
  if (cmd === "login") {
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 90000 });
    await page.locator('input[type="email"]').fill(process.env.MS_EMAIL);
    await page.locator('input[type="password"]').fill(process.env.MS_PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL(/verify-2fa/, { timeout: 60000 });
    const { totpGenerate } = await import("../lib/totp.ts");
    await page.locator('input[inputmode="numeric"]').fill(await totpGenerate(process.env.MS_SECRET));
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL((u) => !/verify-2fa|login/.test(u.pathname), { timeout: 90000 });
    console.log("signed in");
    await dump();
  } else if (cmd === "open") {
    await page.goto(`${BASE}${args[0]}`, { waitUntil: "networkidle", timeout: 90000 });
    await dump();
  } else if (cmd === "dump") {
    await page.goto(lastUrl, { waitUntil: "networkidle", timeout: 90000 });
    await dump();
  } else if (cmd === "click") {
    await page.goto(lastUrl, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(2000);
    await page.getByRole("button", { name: new RegExp(args[0], "i") }).first().click();
    await dump();
  } else if (cmd === "create-student") {
    const stamp = Date.now().toString().slice(-6);
    const student = {
      firstName: "ZZManual",
      lastName: `Test${stamp}`,
      email: `zz.manual.${stamp}@example.invalid`,
      phone: `+15551${stamp}`,
      nationality: "Indian",
      countryOfResidence: "India",
      interestedProgram: "Business Administration",
      intakeYear: "2026",
      intendedDestination: "Canada",
      preferredCountry: "Canada",
      currentQualification: "BSc Computer Science",
      academicQualification: "BSc 2:1",
      counsellingOutcome: "Discussed programme options; student wants to apply for Sept 2026.",
    };

    const replies = [];
    page.on("response", async (r) => {
      if (r.request().method() === "POST" && /\/api\/leads$/.test(r.url())) {
        try { replies.push(`${r.status()} ${(await r.text()).slice(0, 400)}`); } catch { /* consumed */ }
      }
    });

    await page.goto(`${BASE}/students`, { waitUntil: "networkidle", timeout: 90000 });
    await page.getByRole("button", { name: /add student|new student|add lead/i }).first().click();
    await page.waitForTimeout(2500);
    const d = page.locator('[role="dialog"]').first();

    for (const [k, v] of Object.entries(student)) {
      const f = d.locator(`[name="${k}"]`).first();
      if (await f.isVisible().catch(() => false)) await f.fill(v);
      else console.log(`   (no field: ${k})`);
    }
    // Every dropdown gets a real value — Source included, which the gate needs.
    for (const sel of await d.locator("select").all()) {
      for (const o of await sel.locator("option").all()) {
        const v = await o.getAttribute("value");
        if (v && v !== "none") { await sel.selectOption(v); break; }
      }
    }
    await d.getByRole("button", { name: /create|save|add/i }).last().click();
    await page.waitForTimeout(6000);

    const id = replies.join(" ").match(/"id":"([0-9a-f-]{20,})"/)?.[1];
    console.log("CREATE REPLIES:", replies.map((r) => r.slice(0, 90)));
    console.log("NEW STUDENT ID:", id ?? "(none)");
    console.log("STUDENT:", JSON.stringify(student, null, 1));
    if (id) {
      await page.goto(`${BASE}/students/${id}`, { waitUntil: "networkidle", timeout: 90000 });
    }
    await dump();
  } else if (cmd === "set-outcome") {
    // Sets the Counselling Outcome dropdown through Edit Lead, which uses
    // PATCH — the route that has always accepted counsellingOutcomeEnum.
    await page.goto(lastUrl, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(2500);
    await page.getByRole("button", { name: /edit lead/i }).first().click();
    await page.waitForTimeout(2500);
    const d = page.locator('[role="dialog"]').first();

    for (const sel of await d.locator("select").all()) {
      const lbl = await sel.evaluate((e) => e.closest("div")?.querySelector("label")?.textContent ?? "");
      if (!/counselling outcome/i.test(lbl)) continue;
      const opts = await sel.locator("option").allTextContents();
      console.log("COUNSELLING OUTCOME OPTIONS:", JSON.stringify(opts));
      const values = await sel.locator("option").evaluateAll((os) =>
        os.map((o) => ({ v: o.getAttribute("value"), t: o.textContent?.trim() }))
      );
      const proceed = values.find((x) => /proceed/i.test(x.t ?? ""));
      if (proceed?.v) {
        await sel.selectOption(proceed.v);
        console.log("SELECTED:", proceed.t, "=", proceed.v);
      } else {
        console.log("NO 'proceed' OPTION FOUND");
      }
    }
    // The status alone is not enough to act on — the reason is in the body.
    const bodies = [];
    page.on("response", async (r) => {
      if (r.request().method() !== "PATCH" || !/\/api\/leads\//.test(r.url())) return;
      try {
        bodies.push(`${r.status()} REQ=${r.request().postData()?.slice(0, 900)} RES=${(await r.text()).slice(0, 900)}`);
      } catch { /* consumed */ }
    });

    await d.getByRole("button", { name: /save|update/i }).last().click();
    await page.waitForTimeout(4000);
    for (const b of bodies) console.log("\nPATCH:", b);
    await page.goto(lastUrl, { waitUntil: "networkidle", timeout: 90000 });
    await dump();
  } else if (cmd === "set-eligibility") {
    // The eligibility outcome lives on the JOURNEY, not the person — spec §6.
    await page.goto(lastUrl, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(3000);
    let done = false;
    for (const sel of await page.locator("select:visible").all()) {
      const opts = await sel.locator("option").evaluateAll((os) =>
        os.map((o) => ({ v: o.getAttribute("value"), t: o.textContent?.trim() }))
      );
      if (!opts.some((o) => /provisionally eligible|^eligible$/i.test(o.t ?? ""))) continue;
      console.log("ELIGIBILITY OPTIONS:", JSON.stringify(opts.map((o) => o.t)));
      const pick = opts.find((o) => /^eligible$/i.test(o.t ?? "")) ?? opts.find((o) => /provisionally/i.test(o.t ?? ""));
      if (pick?.v) { await sel.selectOption(pick.v); console.log("SELECTED:", pick.t); done = true; }
      break;
    }
    if (!done) console.log("NO ELIGIBILITY CONTROL FOUND ON THE PAGE");
    await page.waitForTimeout(3500);
    await page.goto(lastUrl, { waitUntil: "networkidle", timeout: 90000 });
    await dump();
  } else if (cmd === "activity") {
    // activity <schedule|log> "<description>" [typeLabelRegex]
    const [mode, description, typeRe] = args;
    await page.goto(lastUrl, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(2500);
    await page.getByRole("button", { name: /add activity/i }).first().click();
    await page.waitForTimeout(1500);

    const d = page.locator('[role="dialog"]').filter({ hasText: /add activity/i }).first();
    await d.getByRole("button", { name: mode === "schedule" ? /schedule for later/i : /log something done/i }).click();
    await page.waitForTimeout(500);

    // Type list, so the right kind can be picked when a gate asks for one.
    await d.getByRole("combobox").first().click();
    await page.waitForTimeout(800);
    const opts = await page.getByRole("option").allTextContents();
    console.log("ACTIVITY TYPES:", JSON.stringify(opts));
    const wanted = typeRe
      ? page.getByRole("option").filter({ hasText: new RegExp(typeRe, "i") }).first()
      : page.getByRole("option").first();
    await wanted.click();
    await page.waitForTimeout(500);

    await d.locator('input[placeholder*="Course options"], input[placeholder*="e.g."]').first().fill(description);
    if (mode === "schedule") {
      await d.locator('input[type="date"]').fill(new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
    }
    await d.getByRole("button", { name: mode === "schedule" ? /^schedule$/i : /^log$/i }).click();
    await page.waitForTimeout(3500);
    await page.goto(lastUrl, { waitUntil: "networkidle", timeout: 90000 });
    await dump();
  } else if (cmd === "advance") {
    await page.goto(lastUrl, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(2500);
    await page.getByRole("button", { name: new RegExp(`^${args[0]}$`, "i") }).first().click();
    await page.waitForTimeout(4000);
    await page.goto(lastUrl, { waitUntil: "networkidle", timeout: 90000 });
    await dump();
  } else if (cmd === "add-interest") {
    await page.goto(lastUrl, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(2500);
    await page.getByRole("button", { name: /add interest/i }).first().click();
    await page.waitForTimeout(2500);
    // Enumerate across the WHOLE page, not a guessed container. Scoping this to
    // a `.filter({hasText})` locator returned an empty list twice and was very
    // nearly written up as "the interest form has no fields" — when the form
    // was there all along and the selector was wrong.
    const fields = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll("select:not([hidden]), input, textarea, [role='combobox']")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        out.push({
          tag: el.tagName.toLowerCase(),
          name: el.getAttribute("name") ?? "",
          type: el.getAttribute("type") ?? el.getAttribute("role") ?? "",
          ph: el.getAttribute("placeholder") ?? "",
          label: el.closest("div")?.querySelector("label")?.textContent?.trim().slice(0, 40) ?? "",
          opts: el.tagName === "SELECT"
            ? [...el.querySelectorAll("option")].slice(0, 4).map((o) => o.textContent?.trim())
            : undefined,
        });
      }
      return out;
    });
    console.log("VISIBLE FORM CONTROLS:", JSON.stringify(fields, null, 1));

    if (args[0] === "fill") {
      const instSel = page.locator("select").filter({ hasText: /select institution/i }).first();
      for (const o of await instSel.locator("option").all()) {
        const v = await o.getAttribute("value");
        if (v && v !== "none" && v !== "") { await instSel.selectOption(v); break; }
      }
      await page.locator('input[placeholder="Programme"]').first().fill("Business Administration");
      await page.locator('input[placeholder="Intake year"]').first().fill("2026");
      await page.locator('input[placeholder="Intake month"]').first().fill("9");
      await page.getByRole("button", { name: /create interest/i }).first().click();
      await page.waitForTimeout(4000);
      await page.goto(lastUrl, { waitUntil: "networkidle", timeout: 90000 });
    }
    await dump();
  } else {
    console.error("commands: login | open | dump | click | create-student | activity | advance | add-interest");
    process.exit(2);
  }
  await ctx.storageState({ path: STATE });
} catch (e) {
  console.error("STEP FAILED:", e?.message?.split("\n")[0] ?? String(e));
  try { await dump(); } catch { /* ignore */ }
  try { await ctx.storageState({ path: STATE }); } catch { /* ignore */ }
} finally {
  await browser.close();
}
