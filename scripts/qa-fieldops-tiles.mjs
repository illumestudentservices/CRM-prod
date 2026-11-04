/**
 * QA — Field Operations figure tiles are clickable.
 *
 * As an ICR (who sees the 5-tile role dashboard), seeds 6 activities and drives
 * /field-operations, asserting:
 *   - role-dashboard tiles (Planned this week / Completed this week / Upcoming /
 *     Overdue / Completion rate) deep-link to ?view=… and filter the list
 *   - ActivitiesClient stat cards (Total / This Month / top-2 by type) filter
 * 3× for stability.
 *
 *   BREVO_API_KEY= BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-fieldops-tiles.mjs
 */
import { chromium } from "playwright";
import { db, BASE, createAndLogin, destroyUser } from "./qa-lib.mjs";

let pass = 0, fail = 0;
function expect(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}
const dayOff = (n) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(12, 0, 0, 0); return d; };

async function run() {
  const ctx = await createAndLogin({ role: "ICR", withEmployee: true });
  const uid = ctx.user.id;
  const tag = ctx.user.name.split(" ")[0];

  const T = {
    pFut2: `${tag} planned-future`,   // PLANNED +2d
    pPast2: `${tag} planned-past`,    // PLANNED -2d
    ipPast1: `${tag} inprog-past`,    // IN_PROGRESS -1d
    cRec3: `${tag} completed-recent`, // COMPLETED -3d
    cOld40: `${tag} completed-old`,   // COMPLETED -40d
    pFar20: `${tag} planned-far`,     // PLANNED +20d
  };
  const ids = [];
  async function act(title, type, status, date) {
    const a = await db.activity.create({ data: { title, type, status, date, userId: uid } });
    ids.push(a.id);
  }
  await act(T.pFut2, "SCHOOL_VISIT", "PLANNED", dayOff(2));
  await act(T.pPast2, "SCHOOL_VISIT", "PLANNED", dayOff(-2));
  await act(T.ipPast1, "SCHOOL_VISIT", "IN_PROGRESS", dayOff(-1));
  await act(T.cRec3, "SCHOOL_VISIT", "COMPLETED", dayOff(-3));
  await act(T.cOld40, "AGENT_MEETING", "COMPLETED", dayOff(-40));
  await act(T.pFar20, "AGENT_MEETING", "PLANNED", dayOff(20));

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    await context.addCookies([...ctx.jar.cookies.entries()].map(([name, value]) => ({ name, value, url: BASE })));
    const page = await context.newPage();

    async function shown() {
      const out = {};
      for (const [k, title] of Object.entries(T)) out[k] = (await page.getByText(title, { exact: true }).count()) > 0;
      return out;
    }
    const only = (s, keys) =>
      keys.every((k) => s[k]) && Object.keys(T).filter((k) => !keys.includes(k)).every((k) => !s[k]);

    for (let round = 1; round <= 3; round++) {
      console.log(`\n── round ${round} ──`);
      await page.goto(`${BASE}/field-operations`, { waitUntil: "domcontentloaded" });
      await page.getByText(T.pFut2, { exact: true }).first().waitFor({ timeout: 20000 });

      // ── Role-dashboard tiles (links → ?view=) ──
      const tile = async (name, viewParam, keys, label) => {
        await page.getByRole("link", { name }).first().click();
        await page.waitForURL(new RegExp(`view=${viewParam}`), { timeout: 10000 });
        await page.waitForTimeout(350);
        expect(label, only(await shown(), keys), `(got ${JSON.stringify(await shown())})`);
      };
      await tile(/Planned this week/, "plannedWeek", ["pFut2", "pPast2"], "Planned this week → planned within ±7d");
      await tile(/Completed this week/, "completedWeek", ["cRec3"], "Completed this week → recently completed");
      await tile(/Upcoming/, "upcoming", ["pFut2", "pFar20"], "Upcoming → planned in the future");
      await tile(/Overdue/, "overdue", ["pPast2", "ipPast1"], "Overdue → planned/in-progress in the past");
      await tile(/Completion rate/, "completed", ["cRec3", "cOld40"], "Completion rate → completed activities");

      // ── Stat cards (buttons) ──
      await page.getByRole("button", { name: /Total Activities/ }).first().click();
      await page.waitForTimeout(350);
      expect("Total Activities → all 6", only(await shown(), Object.keys(T)));

      await page.getByRole("button", { name: /This Month/ }).first().click();
      await page.waitForTimeout(350);
      expect("This Month → this month's activities (not 40d-old)", only(await shown(), ["pFut2", "pPast2", "ipPast1", "cRec3", "pFar20"]));

      await page.getByRole("button", { name: /School Visit/ }).first().click();
      await page.waitForTimeout(350);
      expect("School Visit card → only school visits", only(await shown(), ["pFut2", "pPast2", "ipPast1", "cRec3"]));

      await page.getByRole("button", { name: /Agent Meeting/ }).first().click();
      await page.waitForTimeout(350);
      expect("Agent Meeting card → only agent meetings", only(await shown(), ["cOld40", "pFar20"]));
    }
  } finally {
    await browser.close();
    for (const id of ids) await db.activity.delete({ where: { id } }).catch(() => {});
    await destroyUser(ctx).catch(() => {});
    await db.$disconnect().catch(() => {});
  }
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error("qa crashed", e); await db.$disconnect().catch(() => {}); process.exit(1); });
