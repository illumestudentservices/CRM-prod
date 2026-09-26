/**
 * Emailing a student opens the REP'S mail client — and respects consent.
 *
 *   npx tsx --env-file=.env scripts/qa-email-student-button.mjs
 *
 * ★ THE CONSENT GATE IS THE POINT.
 *
 * A one-line `<a href={mailto}>` would satisfy "reps can email a lead" and is
 * the version that gets someone in trouble. This is a Canadian business
 * contacting prospective students, and the schema records — three-valued, on
 * purpose — whether each person agreed:
 *
 *   doNotContact = true       hard block, no clickable address anywhere
 *   marketingConsent = false  warn and confirm, but allow: replying about
 *                             someone's own application is the service they
 *                             asked for, not a commercial message
 *   marketingConsent = null   silent. Nobody asked, so a warning would be
 *                             FALSE — and warnings that are usually wrong get
 *                             clicked through, including the real one above.
 *
 * Footprint: disposable user and four leads, removed in `finally`.
 */
import { chromium } from "playwright";
import { BASE, db, createAndLogin, destroyUser, startSection, expect, summary } from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
const made = { users: [], leads: [] };
let baseline = {};
let browser;

try {
  startSection("Fixtures — one student for each consent state");
  baseline = { users: await db.user.count(), leads: await db.lead.count() };
  const template = await db.lead.findFirst({ where: { deletedAt: null } });
  expect(!!template, "found a lead to copy required fields from");

  const icr = await createAndLogin({ role: "SUPER_ADMIN" });
  made.users.push(icr);

  const states = [
    ["Normal", { doNotContact: false, marketingConsent: true }],
    ["NeverAsked", { doNotContact: false, marketingConsent: null }],
    ["Declined", { doNotContact: false, marketingConsent: false }],
    ["Blocked", { doNotContact: true, marketingConsent: false }],
  ];
  const leads = {};
  for (const [label, consent] of states) {
    const { id, createdAt, updatedAt, captureId, ...rest } = template;
    const l = await db.lead.create({
      data: {
        ...rest,
        firstName: "ZZMail", lastName: label,
        email: `zzmail-${label.toLowerCase()}-${Date.now()}@illume.local`,
        assignedICRId: icr.user.id, createdById: icr.user.id,
        ...consent,
      },
    });
    leads[label] = l;
    made.leads.push(l.id);
  }
  expect(Object.keys(leads).length === 4, "four students created, one per state");

  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  await ctx.addCookies(
    [...icr.jar.cookies.entries()].map(([name, value]) => ({
      name, value, domain: "localhost", path: "/",
    }))
  );
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on("pageerror", (e) => jsErrors.push(e.message));

  const openLead = async (lead) => {
    await page.goto(`${BROWSER_BASE}/students/${lead.id}`, {
      waitUntil: "networkidle", timeout: 60000,
    });
    await page.waitForFunction(
      () => document.querySelectorAll(".animate-pulse").length === 0, { timeout: 20000 }
    ).catch(() => {});
    await page.waitForTimeout(700);
  };

  // ── Consented ─────────────────────────────────────────────────────────────
  startSection("A student who consented: one click, no friction");
  {
    await openLead(leads.Normal);
    // ★ Assert WHERE it goes, not just that a control exists. The first
    // version of this component was a <button> calling window.location, whose
    // destination is invisible to a test — and which is also unreachable by
    // keyboard and cannot be right-clicked to copy the address. A real anchor
    // fixes all three.
    const link = page.locator(`a[href^="mailto:"]`).filter({ hasText: /Email ZZMail/i });
    expect(await link.count() > 0, "the Email control is a real link");
    const href = await link.first().getAttribute("href");
    expect((href ?? "").startsWith("mailto:"),
      "★ it hands off to a mailto:, not an in-app send", href ?? "none");
    expect((href ?? "").includes(encodeURIComponent(leads.Normal.email)),
      "with the student's address pre-filled", href ?? "");
    expect((href ?? "").includes("subject="),
      "and a subject, so the reply thread is identifiable later");
  }

  // ── Never asked ───────────────────────────────────────────────────────────
  startSection("A student nobody asked: no warning, because there is nothing to warn about");
  {
    await openLead(leads.NeverAsked);
    const body = await page.locator("main").innerText();
    expect(/Email ZZMail/i.test(body), "the button is offered");
    expect(!/declined marketing/i.test(body),
      "★ and NO consent warning is shown",
      "nobody asked them, so a warning would be false — and false warnings get clicked through");
  }

  // ── Declined marketing ────────────────────────────────────────────────────
  startSection("A student who declined marketing: warned, and asked to confirm");
  {
    await openLead(leads.Declined);
    const body = await page.locator("main").innerText();
    expect(/declined marketing/i.test(body),
      "the record says they declined marketing email");

    await page.getByRole("button", { name: /Email ZZMail/i }).click();
    await page.waitForTimeout(600);
    const dialog = page.getByRole("dialog");
    expect(await dialog.count() > 0,
      "★ a confirmation appears rather than opening mail straight away");
    const dText = await dialog.innerText();
    expect(/still appropriate|still fine/i.test(dText),
      "and it explains that replying about their own application is fine",
      "a block here would be wrong — CASL separates a commercial message from answering an enquiry");
    expect(await dialog.getByRole("button", { name: /Cancel/i }).count() > 0,
      "with a way out");
  }

  // ── Do not contact ────────────────────────────────────────────────────────
  startSection("A student who asked not to be contacted: hard block");
  {
    await openLead(leads.Blocked);
    const body = await page.locator("main").innerText();
    expect(/Do not contact/i.test(body), "the record says do not contact");
    expect(await page.getByRole("button", { name: /Email ZZMail/i }).count() === 0,
      "★ there is NO Email button at all");

    // And nothing on the page is a clickable mailto for them either.
    const mailtos = await page.evaluate(() =>
      [...document.querySelectorAll('a[href^="mailto:"]')].map((a) => a.getAttribute("href"))
    );
    expect(!mailtos.some((h) => (h ?? "").includes("zzmail-blocked")),
      "★ and no clickable mailto anywhere on the page",
      "a disabled button beside a live link would be worse than neither");
  }

  // ── The list view obeys the same rules ────────────────────────────────────
  startSection("The list view follows the same rules");
  {
    await page.goto(`${BROWSER_BASE}/students`, { waitUntil: "networkidle", timeout: 60000 });
    await page.getByRole("button", { name: "List", exact: true }).click();
    await page.waitForTimeout(1500);
    // The address is the affordance, so the list needs no extra column.
    const hrefs = await page.evaluate(() =>
      [...document.querySelectorAll('a[href^="mailto:"]')].map((a) => a.getAttribute("href"))
    );
    expect(hrefs.length > 0, `${hrefs.length} addresses are clickable in the table`);
    expect(!hrefs.some((h) => (h ?? "").includes("zzmail-blocked")),
      "★ the do-not-contact student is NOT clickable in the list either",
      "the gate has to hold in every place the address appears");
  }

  expect(jsErrors.length === 0, "no client-side errors", jsErrors.slice(0, 2).join(" | "));
  await page.screenshot({ path: "screenshots/email-student-button.png" });
} catch (e) {
  console.error("FATAL:", e.message);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  for (const id of made.leads) {
    await db.leadActivity.deleteMany({ where: { leadId: id } }).catch(() => {});
    await db.lead.delete({ where: { id } }).catch(() => {});
  }
  await db.lead.deleteMany({ where: { firstName: "ZZMail" } }).catch(() => {});
  for (const u of made.users) await destroyUser(u);

  const after = { users: await db.user.count(), leads: await db.lead.count() };
  startSection("Footprint");
  expect(after.users === baseline.users, `users back to ${baseline.users}`, `now ${after.users}`);
  expect(after.leads === baseline.leads, `leads back to ${baseline.leads}`, `now ${after.leads}`);
  summary();
  await db.$disconnect();
}
