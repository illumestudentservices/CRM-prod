/**
 * Does the announcement feature actually work?
 *
 *   node --import tsx --env-file=.env.local scripts/qa-announcements.mjs
 *
 * Written to answer that question rather than to pass. Several of the
 * assertions below are expected to FAIL on the current code, and each failing
 * one names a specific defect found by reading the route and its two UIs:
 *
 *   1. GET ignores isGlobal and regionId entirely, so an announcement aimed at
 *      one region is served to the whole company.
 *   2. The HR tab reads `isRead`, which the API never sends — it sends
 *      `readReceipts[]`. So an announcement stays blue and unread forever,
 *      however many times it is marked read. The dashboard card reads the
 *      receipts correctly, so the two screens disagree about the same row.
 *   3. The route hard-codes ANNOUNCE_ROLES instead of asking
 *      effectiveHasPermission, so it disagrees with PERMISSION_MATRIX (which
 *      grants VP_GLOBAL_SALES write) and ignores every DB override.
 *   4. There is no PATCH and no DELETE. A posted announcement cannot be edited
 *      or withdrawn, only left to expire — and expiresAt is not on the form.
 *   5. authorId is a bare String with no relation, and GET selects no author,
 *      so neither screen can say who posted it.
 *
 * A failure here is a finding, not a broken test.
 */
import {
  db, createAndLogin, destroyUser, api, apiRaw,
  startSection, expect, summary, TAG, BASE,
} from "./qa-lib.mjs";

const ctxs = [];
const posted = [];

async function main() {
  console.log(`BASE = ${BASE}\n`);

  // ── Who may post ──────────────────────────────────────────────────────────
  startSection("Who is allowed to post");

  const admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  ctxs.push(admin);

  const mk = (extra = {}) => ({
    title: `${TAG} announcement`,
    content: "Body text for the QA announcement.",
    ...extra,
  });

  const asAdmin = await api(admin.jar, "POST", "/api/hr/announcements", mk());
  expect(asAdmin.status === 201, "SUPER_ADMIN can post", `status ${asAdmin.status}`);
  if (asAdmin.payload?.announcement?.id) posted.push(asAdmin.payload.announcement.id);

  const employee = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  ctxs.push(employee);
  const asEmp = await api(employee.jar, "POST", "/api/hr/announcements", mk());
  expect(asEmp.status === 403, "EMPLOYEE cannot post", `status ${asEmp.status}`);

  const rm = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true });
  ctxs.push(rm);
  const asRm = await api(rm.jar, "POST", "/api/hr/announcements", mk());
  expect(asRm.status === 403, "REGIONAL_MANAGER cannot post", `status ${asRm.status}`);

  const exec = await createAndLogin({ role: "HQ_EXECUTIVE", withEmployee: true });
  ctxs.push(exec);
  const asExec = await api(exec.jar, "POST", "/api/hr/announcements", mk());
  expect(asExec.status === 201, "HQ_EXECUTIVE can post", `status ${asExec.status}`);
  if (asExec.payload?.announcement?.id) posted.push(asExec.payload.announcement.id);

  // PERMISSION_MATRIX grants VP_GLOBAL_SALES announcements:["read","write"],
  // but the route's hard-coded list leaves it out.
  const vp = await createAndLogin({ role: "VP_GLOBAL_SALES", withEmployee: true });
  ctxs.push(vp);
  const asVp = await api(vp.jar, "POST", "/api/hr/announcements", mk());
  expect(asVp.status === 201,
    "*** VP_GLOBAL_SALES can post, as PERMISSION_MATRIX says ***",
    `status ${asVp.status} — the route hard-codes its own role list`);
  if (asVp.payload?.announcement?.id) posted.push(asVp.payload.announcement.id);

  // ── Reading ───────────────────────────────────────────────────────────────
  startSection("Everyone can read a global announcement");

  const seen = await api(employee.jar, "GET", "/api/hr/announcements");
  expect(seen.status === 200, "the feed loads for a plain employee", `status ${seen.status}`);
  const ours = (seen.payload?.announcements ?? []).filter((a) => a.title.startsWith(TAG));
  expect(ours.length >= 1, "and a global announcement reaches them", `${ours.length} seen`);

  // redirect: "manual" matters. proxy.ts answers an unauthenticated API call
  // with a 307 to /login, and fetch follows it by default — so the naive
  // version of this check reads the LOGIN PAGE's 200 and reports an auth hole
  // that is not there. Verified by hand: the body is HTML, with no feed in it.
  const anon = await fetch(`${BASE}/api/hr/announcements`, { redirect: "manual" });
  expect(anon.status === 307 || anon.status === 401,
    "signed out is turned away, not served the feed", `status ${anon.status}`);
  const anonBody = await anon.text();
  expect(!anonBody.includes('"announcements"'),
    "and no announcement data comes back", "the feed leaked to an anonymous caller");

  // ── Region targeting ──────────────────────────────────────────────────────
  startSection("An announcement aimed at one region stays in that region");

  const regions = await db.region.findMany({ select: { id: true, name: true }, take: 2 });
  if (regions.length < 2) {
    expect(false, "two regions exist to test with", `${regions.length} found`);
  } else {
    const [regA, regB] = regions;

    const targeted = await api(admin.jar, "POST", "/api/hr/announcements", mk({
      title: `${TAG} region-only`,
      isGlobal: false,
      regionId: regA.id,
    }));
    expect(targeted.status === 201,
      `a ${regA.name}-only announcement is accepted`, `status ${targeted.status}`);
    const targetedId = targeted.payload?.announcement?.id;
    if (targetedId) posted.push(targetedId);

    // Put a reader in the OTHER region.
    const outsider = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
    ctxs.push(outsider);
    await db.user.update({ where: { id: outsider.user.id }, data: { regionId: regB.id } });

    const theirFeed = await api(outsider.jar, "GET", "/api/hr/announcements");
    const leaked = (theirFeed.payload?.announcements ?? []).some((a) => a.id === targetedId);
    expect(!leaked,
      `*** a ${regA.name}-only announcement is NOT shown to someone in ${regB.name} ***`,
      leaked ? "it was shown — GET never filters on isGlobal or regionId" : "correctly hidden");

    // And the stored row should at least record the intent.
    if (targetedId) {
      const row = await db.announcement.findUnique({
        where: { id: targetedId }, select: { isGlobal: true, regionId: true },
      });
      expect(row?.isGlobal === false && row?.regionId === regA.id,
        "the targeting is at least stored correctly",
        `isGlobal=${row?.isGlobal} regionId=${row?.regionId === regA.id ? "set" : "wrong"}`);
    }
  }

  // ── Read receipts ─────────────────────────────────────────────────────────
  startSection("Marking one read actually sticks");

  const target = ours[0];
  if (!target) {
    expect(false, "an announcement to mark read", "none visible");
  } else {
    const mark = await api(employee.jar, "POST", `/api/hr/announcements/${target.id}/read`);
    expect(mark.status === 200, "marking read returns 200", `status ${mark.status}`);

    const row = await db.announcementRead.findUnique({
      where: { announcementId_userId: { announcementId: target.id, userId: employee.user.id } },
      select: { readAt: true },
    });
    expect(!!row, "a receipt row is written", row ? "written" : "missing");

    const after = await api(employee.jar, "GET", "/api/hr/announcements");
    const again = (after.payload?.announcements ?? []).find((a) => a.id === target.id);

    // The dashboard card's contract.
    expect((again?.readReceipts ?? []).length === 1,
      "the feed reports the receipt in readReceipts[] (dashboard card reads this)",
      `${(again?.readReceipts ?? []).length} receipt(s)`);

    // The HR tab's contract — a different field, which nothing ever sets.
    expect(again?.isRead === true,
      "*** the feed also sets isRead, which the HR tab renders on ***",
      `isRead is ${JSON.stringify(again?.isRead)} — the HR tab will show it unread forever`);

    // Nobody else's receipt should appear in my copy.
    const adminView = await api(admin.jar, "GET", "/api/hr/announcements");
    const adminCopy = (adminView.payload?.announcements ?? []).find((a) => a.id === target.id);
    expect((adminCopy?.readReceipts ?? []).length === 0,
      "and another user's copy does not carry my receipt",
      `${(adminCopy?.readReceipts ?? []).length} receipt(s) leaked`);
  }

  // ── Expiry ────────────────────────────────────────────────────────────────
  startSection("Expiry");

  const past = await api(admin.jar, "POST", "/api/hr/announcements", mk({
    title: `${TAG} expired`,
    expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
  }));
  if (past.payload?.announcement?.id) posted.push(past.payload.announcement.id);
  const feedAfter = await api(employee.jar, "GET", "/api/hr/announcements");
  const expiredShown = (feedAfter.payload?.announcements ?? []).some(
    (a) => a.id === past.payload?.announcement?.id);
  expect(!expiredShown, "an already-expired announcement is not served",
    expiredShown ? "it was served" : "correctly hidden");

  const future = await api(admin.jar, "POST", "/api/hr/announcements", mk({
    title: `${TAG} future expiry`,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  }));
  if (future.payload?.announcement?.id) posted.push(future.payload.announcement.id);
  const feed2 = await api(employee.jar, "GET", "/api/hr/announcements");
  expect((feed2.payload?.announcements ?? []).some(
    (a) => a.id === future.payload?.announcement?.id),
    "one expiring tomorrow is still served", "missing");

  // ── Can a mistake be undone? ──────────────────────────────────────────────
  startSection("Withdrawing or correcting a posted announcement");

  const victim = posted[0];
  if (victim) {
    const patched = await api(admin.jar, "PATCH", `/api/hr/announcements/${victim}`, { title: "edited" });
    expect(patched.status !== 404 && patched.status !== 405,
      "*** a typo in an announcement can be corrected (PATCH) ***",
      `status ${patched.status} — no PATCH route exists`);

    const deleted = await api(admin.jar, "DELETE", `/api/hr/announcements/${victim}`);
    expect(deleted.status !== 404 && deleted.status !== 405,
      "*** an announcement posted by mistake can be withdrawn (DELETE) ***",
      `status ${deleted.status} — no DELETE route exists`);
  }

  // ── Who wrote it? ─────────────────────────────────────────────────────────
  startSection("The reader can see who posted it");

  const feed3 = await api(employee.jar, "GET", "/api/hr/announcements");
  const one = (feed3.payload?.announcements ?? []).find((a) => a.title.startsWith(TAG));
  expect(!!one?.author || !!one?.authorName,
    "*** the feed names the author ***",
    `only authorId=${one?.authorId ? "a raw uuid" : "nothing"} — Announcement has no author relation`);

  // ── Validation ────────────────────────────────────────────────────────────
  startSection("Validation");

  const empty = await api(admin.jar, "POST", "/api/hr/announcements", { title: "", content: "" });
  expect(empty.status === 422, "an empty title and body is rejected", `status ${empty.status}`);

  const noBody = await api(admin.jar, "POST", "/api/hr/announcements", { title: "x" });
  expect(noBody.status === 422, "a missing body is rejected", `status ${noBody.status}`);

  const junk = await apiRaw(admin.jar, "POST", "/api/hr/announcements", "{not json");
  expect(junk.status === 400, "unparseable JSON gives 400 not 500", `status ${junk.status}`);

  const longTitle = await api(admin.jar, "POST", "/api/hr/announcements",
    mk({ title: "T".repeat(5000) }));
  if (longTitle.payload?.announcement?.id) posted.push(longTitle.payload.announcement.id);
  expect(longTitle.status === 422,
    "a 5,000-character title is rejected rather than stored",
    `status ${longTitle.status} — title has no max length`);

  const badRegion = await api(admin.jar, "POST", "/api/hr/announcements",
    mk({ isGlobal: false, regionId: "not-a-real-region" }));
  if (badRegion.payload?.announcement?.id) posted.push(badRegion.payload.announcement.id);
  expect(badRegion.status >= 400,
    "a regionId that does not exist is rejected",
    `status ${badRegion.status} — regionId has no foreign key`);

  // ── Does anybody find out? ────────────────────────────────────────────────
  startSection("Notification");
  expect(false,
    "*** posting an announcement notifies staff somehow (email or in-app) ***",
    "nothing is sent — the only way to learn of one is to open the dashboard");
}

let code = 1;
try { await main(); code = summary(); }
catch (e) {
  console.error("\nFATAL:", e.message, "\n", (e.stack ?? "").split("\n").slice(0, 4).join("\n"));
}
finally {
  startSection("Teardown");
  if (posted.length) {
    const { count } = await db.announcement.deleteMany({ where: { id: { in: posted } } });
    console.log(`     removed ${count} QA announcement(s)`);
  }
  const strays = await db.announcement.deleteMany({ where: { title: { startsWith: TAG } } });
  if (strays.count) console.log(`     removed ${strays.count} stray QA announcement(s)`);
  for (const c of ctxs) await destroyUser(c);
  await db.$disconnect();
}
process.exit(code === 0 ? 0 : 1);
