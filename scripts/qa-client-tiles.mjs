/**
 * QA — Clients (institutions) stat tiles are clickable and filter the grid.
 *
 * Seeds 4 institutions (+ a renewing contract, + an open issue) and asserts each
 * stat card filters the grid:
 *   Total Clients → clears (was broken: emptied the grid)
 *   Active → ACTIVE clients
 *   Prospects → PROSPECT clients
 *   Renewal Due → clients with a contract expiring ≤90d
 *   Open Issues → clients with >0 open issues
 * 3× for stability. Only asserts about the seeded clients (the grid also holds
 * real ones).
 *
 *   BREVO_API_KEY= BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-client-tiles.mjs
 */
import { chromium } from "playwright";
import { db, BASE, createAndLogin, destroyUser } from "./qa-lib.mjs";

let pass = 0, fail = 0;
function expect(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}
const dayOff = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };

async function run() {
  const ctx = await createAndLogin({ role: "SUPER_ADMIN" });
  const uid = ctx.user.id;
  const tag = ctx.user.name.split(" ")[0];
  const T = {
    active: `${tag} Active U`,
    prospect: `${tag} Prospect U`,
    renewal: `${tag} Renewal U`,
    issues: `${tag} Issues U`,
  };
  const instIds = {};
  let contractId, issueId;
  async function inst(title, accountStatus) {
    const i = await db.institution.create({
      data: { name: title, country: "Testland", type: "UNIVERSITY", accountStatus, createdById: uid },
    });
    return i.id;
  }
  instIds.active = await inst(T.active, "ACTIVE");
  instIds.prospect = await inst(T.prospect, "PROSPECT");
  instIds.renewal = await inst(T.renewal, "ACTIVE");
  instIds.issues = await inst(T.issues, "ACTIVE");
  const contract = await db.contract.create({
    data: {
      institutionId: instIds.renewal, title: `${tag} Contract`,
      startDate: dayOff(-30), endDate: dayOff(30), statusEnum: "ACTIVE", createdById: uid,
    },
  });
  contractId = contract.id;
  const issue = await db.clientIssue.create({
    data: {
      institutionId: instIds.issues, title: `${tag} Issue`, category: "OTHER",
      status: "OPEN", ownerId: uid, createdById: uid,
    },
  });
  issueId = issue.id;

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    await context.addCookies([...ctx.jar.cookies.entries()].map(([name, value]) => ({ name, value, url: BASE })));
    const page = await context.newPage();
    const seen = async (t) => (await page.getByText(t, { exact: true }).count()) > 0;
    const clickCard = async (label) => { await page.getByText(label, { exact: true }).first().click(); await page.waitForTimeout(400); };
    // assert: among the 4 seeded clients, exactly `keys` are shown
    async function onlySeeded(keys) {
      const s = {};
      for (const k of Object.keys(T)) s[k] = await seen(T[k]);
      return keys.every((k) => s[k]) && Object.keys(T).filter((k) => !keys.includes(k)).every((k) => !s[k]);
    }

    for (let round = 1; round <= 3; round++) {
      console.log(`\n── round ${round} ──`);
      await page.goto(`${BASE}/institutions`, { waitUntil: "domcontentloaded" });
      await page.getByText("Total Clients", { exact: true }).first().waitFor({ timeout: 20000 });
      await page.getByText(T.active, { exact: true }).first().waitFor({ timeout: 20000 });

      await clickCard("Active");
      expect("Active → ACTIVE clients only", await onlySeeded(["active", "renewal", "issues"]));

      await clickCard("Prospects");
      expect("Prospects → PROSPECT only", await onlySeeded(["prospect"]));

      await clickCard("Renewal Due");
      expect("Renewal Due → renewing client only", await onlySeeded(["renewal"]));

      await clickCard("Open Issues");
      expect("Open Issues → client with open issue only", await onlySeeded(["issues"]));

      await clickCard("Total Clients");
      expect("Total Clients → all seeded shown (not broken)", await onlySeeded(["active", "prospect", "renewal", "issues"]));
    }
  } finally {
    await browser.close();
    if (issueId) await db.clientIssue.delete({ where: { id: issueId } }).catch(() => {});
    if (contractId) await db.contract.delete({ where: { id: contractId } }).catch(() => {});
    for (const id of Object.values(instIds)) await db.institution.delete({ where: { id } }).catch(() => {});
    await destroyUser(ctx).catch(() => {});
    await db.$disconnect().catch(() => {});
  }
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error("qa crashed", e); await db.$disconnect().catch(() => {}); process.exit(1); });
