/**
 * QA — Contacts & Documents add/edit/delete on a client (institution) page.
 * Real browser, real super-admin login, real DB. Seeds a throwaway client,
 * then drives the Contacts and Documents tabs end to end.
 *
 *   BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-client-contacts-docs.mjs
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
  const inst = await db.institution.create({
    data: { name: `${TAG} Client`, country: "Canada", type: "Other", accountStatus: "ACTIVE", regionId: AFRICA, createdById: admin.user.id },
    select: { id: true },
  });
  let browser;
  try {
    browser = await chromium.launch();
    const ctx = await browser.newContext();
    const host = new URL(BASE).hostname;
    await ctx.addCookies([...admin.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: host, path: "/" })));
    const page = await ctx.newPage();
    page.on("dialog", (d) => d.accept()); // auto-accept confirm() on delete
    await page.goto(`${BASE}/institutions/${inst.id}`, { waitUntil: "networkidle" });

    // Appears: resolves true once the row is visible.
    const appears = async (name) => {
      try { await page.getByRole("cell", { name }).first().waitFor({ timeout: 8000 }); return true; }
      catch { return false; }
    };
    // Gone: resolves true once no such row is in the table.
    const gone = async (name) => {
      try {
        await page.waitForFunction(
          (n) => ![...document.querySelectorAll("td")].some((c) => c.textContent?.trim() === n),
          name, { timeout: 8000 },
        );
        return true;
      } catch { return false; }
    };

    // ── Contacts ────────────────────────────────────────────────────────
    await page.getByRole("tab", { name: /Contacts/ }).click();
    await page.getByRole("button", { name: "Add Contact" }).click();
    await page.getByLabel(/^Name/).waitFor({ timeout: 8000 });
    await page.getByLabel(/^Name/).fill("Ian McRae");
    await page.getByLabel("Title").fill("Partnerships Director");
    await page.getByLabel("Email").fill("ian@borderpass.ai");
    await page.getByLabel("Phone").fill("+1 555 0100");
    await page.getByRole("button", { name: "Add Contact" }).last().click();
    expect("contact appears in the table", await appears("Ian McRae"));
    expect("contact title shows", await page.getByText("Partnerships Director").count() > 0);

    // Edit
    await page.getByRole("button", { name: "Edit contact" }).first().click();
    await page.getByLabel("Title").waitFor({ timeout: 8000 });
    await page.getByLabel("Title").fill("Senior Director of Strategic Partnerships");
    await page.getByRole("button", { name: "Save Changes" }).click();
    await page.getByText("Senior Director of Strategic Partnerships").first().waitFor({ timeout: 8000 }).catch(() => {});
    expect("edited title shows", await page.getByText("Senior Director of Strategic Partnerships").count() > 0);

    // Delete
    await page.getByRole("button", { name: "Delete contact" }).first().click();
    expect("contact removed after delete", await gone("Ian McRae"));
    const contactsInDb = await db.institutionContact.count({ where: { institutionId: inst.id } });
    expect("no contact rows left in DB", contactsInDb === 0, `(got ${contactsInDb})`);

    // ── Documents ───────────────────────────────────────────────────────
    await page.getByRole("tab", { name: /Documents/ }).click();
    await page.getByRole("button", { name: "Add Document" }).click();
    await page.getByLabel(/^Name/).waitFor({ timeout: 8000 });
    await page.getByLabel(/^Name/).fill("Signed Agreement 2026");
    await page.getByLabel(/^Link/).fill("https://example.com/agreement.pdf");
    await page.getByRole("button", { name: "Add Document" }).last().click();
    expect("document appears in the table", await appears("Signed Agreement 2026"));
    const docsInDb = await db.institutionDocument.count({ where: { institutionId: inst.id } });
    expect("document row written to DB", docsInDb === 1, `(got ${docsInDb})`);

    // Delete document
    await page.getByRole("button", { name: "Delete document" }).first().click();
    expect("document removed after delete", await gone("Signed Agreement 2026"));
    expect("no document rows left in DB", (await db.institutionDocument.count({ where: { institutionId: inst.id } })) === 0);
  } finally {
    if (browser) await browser.close();
    await db.institutionContact.deleteMany({ where: { institutionId: inst.id } }).catch(() => {});
    await db.institutionDocument.deleteMany({ where: { institutionId: inst.id } }).catch(() => {});
    await db.institution.delete({ where: { id: inst.id } }).catch(() => {});
    await destroyUser(admin);
  }
  console.log(`\n  ${pass} passed, ${fail} failed`);
  await db.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error("qa crashed", e); await db.$disconnect().catch(() => {}); process.exit(1); });
