/**
 * QA — Add Contract now captures all contract fields.
 * Real browser + super-admin login. Fills every field and asserts each one
 * landed in the DB (type, currency, noticePeriodDays, paymentStructure,
 * ownerId, documentUrl, plus the originals).
 *
 *   BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-contract-fields.mjs
 */
import { chromium } from "playwright";
import { db, createAndLogin, destroyUser, TAG, BASE } from "./qa-lib.mjs";

const AFRICA = "d46440e9-6cc3-4ab8-be49-8eac11f59e81";
let pass = 0, fail = 0;
function expect(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

async function run() {
  console.log(`[qa] target=${BASE}`);
  const admin = await createAndLogin({ role: "SUPER_ADMIN" });
  const ownerName = `${TAG} SUPER_ADMIN`; // createAndLogin sets name = `${TAG} ${role}`
  const inst = await db.institution.create({
    data: { name: `${TAG} Client`, country: "Canada", type: "Other", accountStatus: "ACTIVE", regionId: AFRICA, createdById: admin.user.id },
    select: { id: true },
  });
  let browser;
  try {
    browser = await chromium.launch();
    const ctx = await browser.newContext();
    await ctx.addCookies([...admin.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: new URL(BASE).hostname, path: "/" })));
    const page = await ctx.newPage();
    await page.goto(`${BASE}/institutions/${inst.id}`, { waitUntil: "networkidle" });

    await page.getByRole("tab", { name: /Contracts/ }).click();
    await page.getByRole("button", { name: "Add Contract" }).click();
    await page.getByLabel(/^Title/).waitFor({ timeout: 8000 });

    await page.getByLabel(/^Title/).fill("MSA 2026");
    // Type
    await page.getByText("Select type").click();
    await page.getByRole("option", { name: "Recruitment" }).click();
    // Value + currency
    await page.getByLabel("Contract Value").fill("50000");
    await page.getByLabel("Currency").fill("EUR");
    // Dates
    await page.getByLabel(/Start Date/).fill("2026-01-01");
    await page.getByLabel(/End Date/).fill("2027-01-01");
    // Notice period
    await page.getByLabel(/Notice Period/).fill("90");
    // Owner (wait for the option to load from owner-options)
    await page.getByText("Select owner").click();
    await page.getByRole("option", { name: ownerName }).waitFor({ timeout: 8000 });
    await page.getByRole("option", { name: ownerName }).click();
    // Document link + payment structure + notes
    await page.getByLabel(/Document Link/).fill("https://example.com/msa.pdf");
    await page.getByLabel(/Payment Structure/).fill("50% on signing, 50% on enrolment");
    await page.getByLabel(/^Notes/).fill("Test contract");

    await page.getByRole("button", { name: "Create Contract" }).click();
    // Wait for the row to show
    await page.getByRole("cell", { name: "MSA 2026" }).first().waitFor({ timeout: 8000 }).catch(() => {});

    const c = await db.contract.findFirst({ where: { institutionId: inst.id }, orderBy: { createdAt: "desc" } });
    expect("contract row created", !!c);
    if (c) {
      expect("title saved", c.title === "MSA 2026");
      expect("type saved (RECRUITMENT)", c.type === "RECRUITMENT", `(got ${c.type})`);
      expect("value saved (50000)", Number(c.value) === 50000, `(got ${c.value})`);
      expect("currency saved (EUR)", c.currency === "EUR", `(got ${c.currency})`);
      expect("notice period saved (90)", c.noticePeriodDays === 90, `(got ${c.noticePeriodDays})`);
      expect("owner saved", c.ownerId === admin.user.id, `(got ${c.ownerId})`);
      expect("document link saved", c.documentUrl === "https://example.com/msa.pdf", `(got ${c.documentUrl})`);
      expect("payment structure saved", (c.paymentStructure ?? "").includes("50% on signing"), `(got ${c.paymentStructure})`);
      expect("notes saved", c.notes === "Test contract");
      expect("dates saved", c.startDate.toISOString().slice(0, 10) === "2026-01-01" && c.endDate.toISOString().slice(0, 10) === "2027-01-01");
    }
  } finally {
    if (browser) await browser.close();
    await db.contract.deleteMany({ where: { institutionId: inst.id } }).catch(() => {});
    await db.institution.delete({ where: { id: inst.id } }).catch(() => {});
    await destroyUser(admin);
  }
  console.log(`\n  ${pass} passed, ${fail} failed`);
  await db.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error("qa crashed", e); await db.$disconnect().catch(() => {}); process.exit(1); });
