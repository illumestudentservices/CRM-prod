/**
 * Field Operations: a table row is clickable and opens an editable dialog;
 * editing the title + status and saving updates the activity.
 *
 *   BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-activity-edit-ui.mjs
 */
import { chromium } from "playwright";
import { BASE, createAndLogin, destroyUser, db } from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
const admin = await createAndLogin({ role: "SUPER_ADMIN" });
const tag = `aeu${Date.now().toString().slice(-6)}`;
const oldTitle = `Edit me ${tag}`;
const newTitle = `Edited ${tag}`;
let browser, inst, activity;
let fail = 0;
const ok = (n, c, x = "") => { if (c) console.log(`  ✓ ${n}`); else { fail++; console.log(`  ✗ ${n} ${x}`); } };

try {
  inst = await db.institution.create({ data: { name: `ZZ ${tag}`, country: "Canada", type: "College", createdById: admin.user.id } });
  activity = await db.activity.create({
    data: { type: "CLIENT_MEETING", title: oldTitle, date: new Date(), status: "PLANNED", userId: admin.user.id, institutionId: inst.id },
  });

  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([...admin.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })));
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("response", (r) => { if (r.status() >= 500) errs.push(`HTTP ${r.status()}`); });

  await page.goto(`${BROWSER_BASE}/field-operations`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(2500);

  // Click the activity row.
  await page.getByText(oldTitle).first().click();
  await page.waitForTimeout(600);
  const dialog = page.getByRole("dialog");
  ok("clicking a row opens the Edit dialog", (await dialog.getByText("Edit Activity").count()) >= 1, errs.join("|"));
  ok("edit dialog has a Status field", (await dialog.getByText(/^Status/).count()) >= 1);

  // Change the title and save.
  const titleInput = dialog.getByRole("textbox").first();
  await titleInput.fill(newTitle);
  await titleInput.blur();           // let React commit the controlled value
  await page.waitForTimeout(250);
  const patchDone = page.waitForResponse(
    (r) => r.url().includes("/api/activities/") && r.request().method() === "PATCH",
    { timeout: 15000 }
  );
  await dialog.getByRole("button", { name: /Save changes/i }).first().click();
  const patch = await patchDone;
  ok("PATCH returned 200", patch.status() === 200, `HTTP ${patch.status()}`);

  // Confirm persisted in the DB (authoritative).
  await page.waitForTimeout(500);
  const fresh = await db.activity.findUnique({ where: { id: activity.id }, select: { title: true } });
  ok("edit persisted to DB", fresh?.title === newTitle, `db title=${fresh?.title}`);

  // And the list reflects it after a reload.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  const body = await page.locator("body").innerText();
  ok("updated title shows in the list", body.includes(newTitle), "new title missing after reload");
  ok("old title no longer shows", !body.includes(oldTitle));
  ok("no pageerror / 500 during edit", errs.length === 0, [...new Set(errs)].join("|"));
} catch (e) {
  fail++; console.error("CRASH:", e?.stack || e);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (activity) await db.activity.delete({ where: { id: activity.id } }).catch(() => {});
  if (inst) await db.institution.delete({ where: { id: inst.id } }).catch(() => {});
  await destroyUser(admin).catch(() => {});
  await db.$disconnect().catch(() => {});
  console.log(fail ? `\n  ${fail} failed` : "\n  all passed");
  process.exit(fail ? 1 : 0);
}
