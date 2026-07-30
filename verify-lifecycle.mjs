import { signIn, BASE, loadEnv } from "./test-helper.mjs";

const env = loadEnv();
const J = { "Content-Type": "application/json" };
let pass = 0, fail = 0;
const ck = (l, c, d = "") => { c ? pass++ : fail++; console.log(`  ${c ? "PASS" : "FAIL"}  ${l}${d ? "  - " + d : ""}`); };

/**
 * Is this browser session still valid?
 *
 * Must use an endpoint the account can actually reach. The first version asked
 * /api/settings/users, which is Super Admin only — an ICR gets 403 whether
 * signed in or not, so "session refused" would have passed even if revocation
 * did nothing. /api/auth/session reflects the token itself and returns an empty
 * object once it is rejected.
 */
async function stillIn(page) {
  const r = await page.request.get(`${BASE}/api/auth/session`, { maxRedirects: 0 });
  if (r.status() !== 200) return false;
  const body = await r.json().catch(() => null);
  return !!body?.user?.email;
}
async function canLoadApp(page) {
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2500);
  return !page.url().includes("/login");
}

const adm = await signIn({ as: "adm" });

// Put the victim back to active/undeleted so a re-run starts from a known
// state. The suite deliberately leaves them restored-but-inactive at the end,
// which would otherwise make the next run fail at the first sign-in.
{
  await adm.page.request.post(`${BASE}/api/settings/users/${env.VIC_ID}`).catch(() => {});
  const res = await adm.page.request.patch(`${BASE}/api/settings/users`, {
    headers: J,
    data: { id: env.VIC_ID, isActive: true },
  });
  console.log(`reset victim to active: ${res.status()}\n`);
}

console.log("GUARDRAILS");

// Self-deactivation and self-deletion must be refused.
let r = await adm.page.request.patch(`${BASE}/api/settings/users`, {
  headers: J, data: { id: env.ADM_ID, isActive: false },
});
ck("cannot deactivate yourself", r.status() === 400, (await r.json()).error?.slice(0, 60));

r = await adm.page.request.delete(`${BASE}/api/settings/users/${env.ADM_ID}`);
ck("cannot delete yourself", r.status() === 400, (await r.json()).error?.slice(0, 60));

// The victim (ICR) must not be able to reach admin endpoints at all.
const vic = await signIn({ as: "vic" });
r = await vic.page.request.delete(`${BASE}/api/settings/users/${env.ADM_ID}`);
ck("non-admin cannot delete anyone", r.status() === 403);

// ── Deactivation kills a LIVE session ────────────────────────────────────
console.log("\nDEACTIVATION — live session must die");
ck("victim is signed in beforehand", await stillIn(vic.page));

r = await adm.page.request.patch(`${BASE}/api/settings/users`, {
  headers: J, data: { id: env.VIC_ID, isActive: false },
});
ck("admin deactivates the victim", r.status() === 200);

// No reload, no waiting for expiry — the very next request must fail.
const outAfterDeactivate = !(await stillIn(vic.page));
ck("victim's live session is refused IMMEDIATELY", outAfterDeactivate);
ck("victim is bounced to login on navigation", !(await canLoadApp(vic.page)));

// And they cannot sign in again.
let reLogin = "ok";
try { const s = await signIn({ as: "vic" }); await s.browser.close(); }
catch (e) { reLogin = String(e).slice(0, 60); }
ck("victim cannot sign back in", reLogin !== "ok", reLogin);
await vic.browser.close();

// ── Reactivate, then test DELETE ─────────────────────────────────────────
console.log("\nDELETE — soft, recoverable, and signs them out");
r = await adm.page.request.patch(`${BASE}/api/settings/users`, {
  headers: J, data: { id: env.VIC_ID, isActive: true },
});
ck("admin reactivates the victim", r.status() === 200);

const vic2 = await signIn({ as: "vic" });
ck("victim can sign in again after reactivation", await stillIn(vic2.page));

r = await adm.page.request.delete(`${BASE}/api/settings/users/${env.VIC_ID}`);
const delBody = await r.json();
ck("admin deletes the victim", r.status() === 200, `window=${delBody.recoveryWindowDays}d`);
ck("recovery window is 30 days", delBody.recoveryWindowDays === 30);

ck("deleted user's live session is refused IMMEDIATELY", !(await stillIn(vic2.page)));
await vic2.browser.close();

// ── Visibility ───────────────────────────────────────────────────────────
console.log("\nVISIBILITY");
let list = await (await adm.page.request.get(`${BASE}/api/settings/users`)).json();
ck("deleted user is hidden from the main list",
   !(list.users ?? []).some((u) => u.id === env.VIC_ID));

let bin = await (await adm.page.request.get(`${BASE}/api/settings/users?deleted=true`)).json();
const inBin = (bin.users ?? []).find((u) => u.id === env.VIC_ID);
ck("deleted user appears in the recovery bin", !!inBin);
ck("bin records when it was deleted", !!inBin?.deletedAt);

// ── Restore ──────────────────────────────────────────────────────────────
console.log("\nRESTORE");
r = await adm.page.request.post(`${BASE}/api/settings/users/${env.VIC_ID}`);
const restored = await r.json();
ck("restore succeeds", r.status() === 200);
ck("restored account is INACTIVE, not silently re-enabled", restored.user?.isActive === false);
ck("restored account is no longer deleted", restored.user?.deletedAt === null);

let stillOut = "blocked";
try { const s = await signIn({ as: "vic" }); await s.browser.close(); stillOut = "SIGNED IN"; }
catch { /* expected */ }
ck("restored-but-inactive user still cannot sign in", stillOut === "blocked");

list = await (await adm.page.request.get(`${BASE}/api/settings/users`)).json();
ck("restored user is back in the main list",
   (list.users ?? []).some((u) => u.id === env.VIC_ID));

r = await adm.page.request.post(`${BASE}/api/settings/users/${env.VIC_ID}`);
ck("restoring a non-deleted account is refused", r.status() === 400);

// ── UI ───────────────────────────────────────────────────────────────────
console.log("\nUI");
await adm.page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded", timeout: 60000 });
await adm.page.waitForTimeout(4000);
const usersTab = adm.page.locator('button:has-text("Users")').first();
if (await usersTab.count()) { await usersTab.click(); await adm.page.waitForTimeout(2500); }
const txt = await adm.page.evaluate(() => document.body.innerText);
ck("users tab renders", /Role|Status|User/i.test(txt));

const editBtn = adm.page.locator("table button").first();
if (await editBtn.count()) {
  await editBtn.click();
  await adm.page.waitForTimeout(1500);
  let d = await adm.page.evaluate(() => document.body.innerText);
  ck("edit dialog offers Delete account", /Delete account/i.test(d));
  ck("dialog explains the recovery window", /30 days/i.test(d));

  // The full warning only appears after arming the confirmation.
  const del = adm.page.locator('button:has-text("Delete account")').first();
  if (await del.count()) {
    await del.click();
    await adm.page.waitForTimeout(900);
    d = await adm.page.evaluate(() => document.body.innerText);
    ck("confirmation says history is kept",
       /leads, reports and audit history are kept/i.test(d));
    ck("confirmation warns about immediate sign-out", /signed out immediately/i.test(d));
  }
  await adm.page.keyboard.press("Escape");
}

console.log(`\n${pass} passed, ${fail} failed`);
await adm.browser.close();
process.exit(fail ? 1 : 0);
