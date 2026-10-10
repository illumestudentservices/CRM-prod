/**
 * Does the announcement feature actually work?
 *
 *   node --import tsx --env-file=.env.local scripts/qa-announcements.mjs
 *
 * The first version of this suite was written to FIND defects and nine of its
 * assertions failed. They are all still here, now expected to pass:
 *
 *   1. GET ignored isGlobal and regionId, so a region-targeted announcement
 *      went to the whole company.
 *   2. The HR tab rendered on `isRead`, which the API never sent, so marking
 *      one read never stuck there while the dashboard card showed it fine.
 *   3. The route hard-coded its role list, refusing VP_GLOBAL_SALES (which
 *      PERMISSION_MATRIX grants write) and ignoring DB overrides.
 *   4. No PATCH and no DELETE: a typo was permanent, a mistake unwithdrawable.
 *   5. No author relation, so nothing could say who posted it.
 *   6. No title cap; regionId had no foreign key.
 *   7. Posting notified nobody.
 *
 * The region cases are the ones worth keeping sharp: a leaked announcement
 * looks exactly like a global one, so only a test that puts a reader in the
 * wrong region can tell them apart.
 */
import {
  db, createAndLogin, destroyUser, api, apiRaw,
  startSection, expect, summary, TAG, BASE,
} from "./qa-lib.mjs";

const ctxs = [];
const posted = [];
const track = (res) => {
  const id = res?.payload?.announcement?.id;
  if (id) posted.push(id);
  return id;
};

async function main() {
  console.log(`BASE = ${BASE}\n`);

  const regions = await db.region.findMany({ select: { id: true, name: true }, take: 2 });
  if (regions.length < 2) throw new Error("need two regions to test targeting");
  const [regA, regB] = regions;

  const mk = (extra = {}) => ({
    title: `${TAG} announcement`,
    content: "Body text for the QA announcement.",
    ...extra,
  });

  // ── Who may post ──────────────────────────────────────────────────────────
  startSection("Who is allowed to post");

  const admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  ctxs.push(admin);

  const asAdmin = await api(admin.jar, "POST", "/api/hr/announcements", mk());
  expect(asAdmin.status === 201, "SUPER_ADMIN can post", `status ${asAdmin.status}`);
  track(asAdmin);

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
  track(asExec);

  const vp = await createAndLogin({ role: "VP_GLOBAL_SALES", withEmployee: true });
  ctxs.push(vp);
  const asVp = await api(vp.jar, "POST", "/api/hr/announcements", mk());
  expect(asVp.status === 201,
    "*** VP_GLOBAL_SALES can post, as PERMISSION_MATRIX says ***",
    `status ${asVp.status}`);
  track(asVp);

  startSection("The feed tells the screen what it may do");
  const empFeed = await api(employee.jar, "GET", "/api/hr/announcements");
  expect(empFeed.payload?.canWrite === false,
    "an employee is told they cannot post", `canWrite=${empFeed.payload?.canWrite}`);
  expect(empFeed.payload?.canDelete === false,
    "and cannot delete", `canDelete=${empFeed.payload?.canDelete}`);
  const admFeed = await api(admin.jar, "GET", "/api/hr/announcements");
  expect(admFeed.payload?.canWrite === true && admFeed.payload?.canDelete === true,
    "a super admin is told they can do both",
    `write=${admFeed.payload?.canWrite} delete=${admFeed.payload?.canDelete}`);
  const vpFeed = await api(vp.jar, "GET", "/api/hr/announcements");
  expect(vpFeed.payload?.canWrite === true && vpFeed.payload?.canDelete === false,
    "VP_GLOBAL_SALES may write but not withdraw",
    `write=${vpFeed.payload?.canWrite} delete=${vpFeed.payload?.canDelete}`);

  // ── Reading ───────────────────────────────────────────────────────────────
  startSection("Everyone can read a company-wide announcement");

  const seen = await api(employee.jar, "GET", "/api/hr/announcements");
  expect(seen.status === 200, "the feed loads for a plain employee", `status ${seen.status}`);
  const ours = (seen.payload?.announcements ?? []).filter((a) => a.title.startsWith(TAG));
  expect(ours.length >= 1, "and a global announcement reaches them", `${ours.length} seen`);

  // redirect: "manual" matters. proxy.ts answers an unauthenticated API call
  // with a 307 to /login, and fetch follows it by default — so the naive
  // version of this check reads the LOGIN PAGE's 200 and reports an auth hole
  // that is not there.
  const anon = await fetch(`${BASE}/api/hr/announcements`, { redirect: "manual" });
  expect(anon.status === 307 || anon.status === 401,
    "signed out is turned away, not served the feed", `status ${anon.status}`);
  const anonBody = await anon.text();
  expect(!anonBody.includes('"announcements"'),
    "and no announcement data comes back", "the feed leaked to an anonymous caller");

  // ── Region targeting ──────────────────────────────────────────────────────
  startSection("An announcement aimed at one region stays in that region");

  const targeted = await api(admin.jar, "POST", "/api/hr/announcements", mk({
    title: `${TAG} region-only`,
    isGlobal: false,
    regionId: regA.id,
  }));
  expect(targeted.status === 201,
    `a ${regA.name}-only announcement is accepted`, `status ${targeted.status}`);
  const targetedId = track(targeted);

  const insider = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  ctxs.push(insider);
  await db.user.update({ where: { id: insider.user.id }, data: { regionId: regA.id } });

  const outsider = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  ctxs.push(outsider);
  await db.user.update({ where: { id: outsider.user.id }, data: { regionId: regB.id } });

  const inFeed = await api(insider.jar, "GET", "/api/hr/announcements");
  expect((inFeed.payload?.announcements ?? []).some((a) => a.id === targetedId),
    `*** somebody in ${regA.name} sees it ***`, "it never reached its own region");

  const outFeed = await api(outsider.jar, "GET", "/api/hr/announcements");
  expect(!(outFeed.payload?.announcements ?? []).some((a) => a.id === targetedId),
    `*** somebody in ${regB.name} does NOT see it ***`,
    "it leaked — GET is not filtering on isGlobal/regionId");

  // No region set at all: global only, never everyone else's regional notices.
  const regionless = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  ctxs.push(regionless);
  await db.user.update({ where: { id: regionless.user.id }, data: { regionId: null } });
  const rlFeed = await api(regionless.jar, "GET", "/api/hr/announcements");
  expect(!(rlFeed.payload?.announcements ?? []).some((a) => a.id === targetedId),
    "*** somebody with no region does not see a regional announcement ***",
    "it leaked to a user with no region");
  expect((rlFeed.payload?.announcements ?? []).some((a) => a.title === `${TAG} announcement`),
    "but they still get the company-wide ones", "global announcements missing");

  startSection("A regional announcement cannot be reached by id either");
  const direct = await api(outsider.jar, "GET", `/api/hr/announcements/${targetedId}`);
  expect(direct.status === 404,
    "*** fetching it directly gives 404, not the content ***", `status ${direct.status}`);
  const sneakRead = await api(outsider.jar, "POST", `/api/hr/announcements/${targetedId}/read`);
  expect(sneakRead.status === 404,
    "and it cannot be marked read to confirm it exists", `status ${sneakRead.status}`);

  startSection("The author can still see what they posted");
  const authorFeed = await api(admin.jar, "GET", "/api/hr/announcements");
  expect((authorFeed.payload?.announcements ?? []).some((a) => a.id === targetedId),
    "the person who posted a regional announcement sees it", "the author lost their own post");

  // ── Read receipts ─────────────────────────────────────────────────────────
  startSection("Marking one read actually sticks");

  const target = ours[0];
  const mark = await api(employee.jar, "POST", `/api/hr/announcements/${target.id}/read`);
  expect(mark.status === 200, "marking read returns 200", `status ${mark.status}`);

  const row = await db.announcementRead.findUnique({
    where: { announcementId_userId: { announcementId: target.id, userId: employee.user.id } },
    select: { readAt: true },
  });
  expect(!!row, "a receipt row is written", row ? "written" : "missing");

  const after = await api(employee.jar, "GET", "/api/hr/announcements");
  const again = (after.payload?.announcements ?? []).find((a) => a.id === target.id);
  expect((again?.readReceipts ?? []).length === 1,
    "readReceipts carries it (the old dashboard contract)",
    `${(again?.readReceipts ?? []).length} receipt(s)`);
  expect(again?.isRead === true,
    "*** isRead is set too, so the HR tab agrees with the dashboard ***",
    `isRead is ${JSON.stringify(again?.isRead)}`);

  const adminView = await api(admin.jar, "GET", "/api/hr/announcements");
  const adminCopy = (adminView.payload?.announcements ?? []).find((a) => a.id === target.id);
  expect(adminCopy?.isRead === false && (adminCopy?.readReceipts ?? []).length === 0,
    "and another user's copy does not carry my receipt",
    `isRead=${adminCopy?.isRead}, ${(adminCopy?.readReceipts ?? []).length} receipt(s)`);

  // ── Author ────────────────────────────────────────────────────────────────
  startSection("The reader can see who posted it");
  const one = (after.payload?.announcements ?? []).find((a) => a.title.startsWith(TAG));
  expect(!!one?.authorName,
    "*** the feed names the author ***", `authorName=${JSON.stringify(one?.authorName)}`);

  // ── Notification ──────────────────────────────────────────────────────────
  startSection("Posting tells somebody");

  const before = await db.notification.count({ where: { type: "ANNOUNCEMENT" } });
  const noisy = await api(admin.jar, "POST", "/api/hr/announcements",
    mk({ title: `${TAG} notify-me` }));
  track(noisy);
  // The route notifies fire-and-forget so the post is not held up by it.
  let notifs = 0;
  for (let i = 0; i < 20 && notifs <= before; i++) {
    await new Promise((r) => setTimeout(r, 250));
    notifs = await db.notification.count({ where: { type: "ANNOUNCEMENT" } });
  }
  expect(notifs > before,
    "*** an in-app notification goes out when one is posted ***",
    `${before} before, ${notifs} after`);

  const selfNotified = await db.notification.count({
    where: { type: "ANNOUNCEMENT", userId: admin.user.id, title: `${TAG} notify-me` },
  });
  expect(selfNotified === 0,
    "but not to the person who wrote it", `${selfNotified} sent to the author`);

  const regionalPost = await api(admin.jar, "POST", "/api/hr/announcements",
    mk({ title: `${TAG} region-notify`, isGlobal: false, regionId: regA.id }));
  track(regionalPost);
  let outsiderNotified = -1;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const insiderN = await db.notification.count({
      where: { type: "ANNOUNCEMENT", userId: insider.user.id, title: `${TAG} region-notify` },
    });
    outsiderNotified = await db.notification.count({
      where: { type: "ANNOUNCEMENT", userId: outsider.user.id, title: `${TAG} region-notify` },
    });
    if (insiderN > 0) break;
  }
  expect(outsiderNotified === 0,
    "*** and a regional one does not notify the wrong region ***",
    `${outsiderNotified} sent to someone in ${regB.name}`);

  // ── Editing and withdrawing ───────────────────────────────────────────────
  startSection("Correcting a typo");

  const mine = await api(admin.jar, "POST", "/api/hr/announcements",
    mk({ title: `${TAG} typo` }));
  const mineId = track(mine);

  const patched = await api(admin.jar, "PATCH", `/api/hr/announcements/${mineId}`,
    { title: `${TAG} corrected` });
  expect(patched.status === 200,
    "*** an announcement can be edited ***", `status ${patched.status}`);
  expect(patched.payload?.announcement?.title === `${TAG} corrected`,
    "and the new wording is stored", `${patched.payload?.announcement?.title}`);

  const notMine = await api(exec.jar, "PATCH", `/api/hr/announcements/${mineId}`,
    { title: "hijacked" });
  expect(notMine.status === 403,
    "somebody else's announcement cannot be edited by a non-admin", `status ${notMine.status}`);

  const byEmp = await api(employee.jar, "PATCH", `/api/hr/announcements/${mineId}`,
    { title: "nope" });
  expect(byEmp.status === 403, "nor by someone with no write permission", `status ${byEmp.status}`);

  startSection("Switching one from a region to everyone");
  const flip = await api(admin.jar, "PATCH", `/api/hr/announcements/${targetedId}`,
    { isGlobal: true });
  expect(flip.status === 200, "it can be switched to company-wide", `status ${flip.status}`);
  expect(flip.payload?.announcement?.regionId === null,
    "*** and the stale region is cleared, not left behind ***",
    `regionId=${flip.payload?.announcement?.regionId}`);

  startSection("Withdrawing one");
  const byVp = await api(vp.jar, "DELETE", `/api/hr/announcements/${mineId}`);
  expect(byVp.status === 403,
    "a role with write but not delete cannot withdraw", `status ${byVp.status}`);

  const gone = await api(admin.jar, "DELETE", `/api/hr/announcements/${mineId}`);
  expect(gone.status === 200,
    "*** a super admin can withdraw one ***", `status ${gone.status}`);
  const stillThere = await db.announcement.findUnique({ where: { id: mineId } });
  expect(!stillThere, "and it is really gone", stillThere ? "still in the table" : "deleted");

  const twice = await api(admin.jar, "DELETE", `/api/hr/announcements/${mineId}`);
  expect(twice.status === 404, "withdrawing it again gives 404", `status ${twice.status}`);

  // ── Expiry ────────────────────────────────────────────────────────────────
  startSection("Expiry");

  const past = await api(admin.jar, "POST", "/api/hr/announcements", mk({
    title: `${TAG} expired`,
    expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
  }));
  track(past);
  expect(past.status === 422,
    "an expiry date in the past is refused at the door", `status ${past.status}`);

  const future = await api(admin.jar, "POST", "/api/hr/announcements", mk({
    title: `${TAG} future expiry`,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  }));
  const futureId = track(future);
  const feed2 = await api(employee.jar, "GET", "/api/hr/announcements");
  expect((feed2.payload?.announcements ?? []).some((a) => a.id === futureId),
    "one expiring tomorrow is still served", "missing");

  // Expire it behind the API's back; the feed must drop it.
  await db.announcement.update({
    where: { id: futureId },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  const feed3 = await api(employee.jar, "GET", "/api/hr/announcements");
  expect(!(feed3.payload?.announcements ?? []).some((a) => a.id === futureId),
    "and once it expires it disappears", "an expired announcement is still being served");

  // ── Validation ────────────────────────────────────────────────────────────
  startSection("Validation");

  const empty = await api(admin.jar, "POST", "/api/hr/announcements", { title: "", content: "" });
  expect(empty.status === 422, "an empty title and body is rejected", `status ${empty.status}`);

  const noBody = await api(admin.jar, "POST", "/api/hr/announcements", { title: "x" });
  expect(noBody.status === 422, "a missing body is rejected", `status ${noBody.status}`);

  const spaces = await api(admin.jar, "POST", "/api/hr/announcements",
    { title: "   ", content: "   " });
  track(spaces);
  expect(spaces.status === 422, "and so is whitespace pretending to be content",
    `status ${spaces.status}`);

  const junk = await apiRaw(admin.jar, "POST", "/api/hr/announcements", "{not json");
  expect(junk.status === 400, "unparseable JSON gives 400 not 500", `status ${junk.status}`);

  const longTitle = await api(admin.jar, "POST", "/api/hr/announcements",
    mk({ title: "T".repeat(5000) }));
  track(longTitle);
  expect(longTitle.status === 422,
    "*** a 5,000-character title is rejected rather than stored ***",
    `status ${longTitle.status}`);

  const badRegion = await api(admin.jar, "POST", "/api/hr/announcements",
    mk({ isGlobal: false, regionId: "not-a-real-region" }));
  track(badRegion);
  expect(badRegion.status === 422,
    "*** a regionId that does not exist is rejected, not stored ***",
    `status ${badRegion.status}`);

  const regionlessTargeted = await api(admin.jar, "POST", "/api/hr/announcements",
    mk({ isGlobal: false }));
  track(regionlessTargeted);
  expect(regionlessTargeted.status === 422,
    "*** 'not global' with no region is refused — it would reach nobody ***",
    `status ${regionlessTargeted.status}`);

  startSection("Content is not trusted");
  const xss = await api(admin.jar, "POST", "/api/hr/announcements", mk({
    title: `${TAG} <script>alert(1)</script>`,
    content: "<img src=x onerror=alert(1)>",
  }));
  const xssId = track(xss);
  expect(xss.status === 201, "markup in an announcement is accepted as text", `status ${xss.status}`);
  const stored = await db.announcement.findUnique({ where: { id: xssId }, select: { content: true } });
  expect(stored?.content === "<img src=x onerror=alert(1)>",
    "stored verbatim rather than mangled (React escapes it on render)",
    `${stored?.content}`);

  // ── Reach ─────────────────────────────────────────────────────────────────
  startSection("A regional manager posts to their own region and nowhere else");

  // REGIONAL_MANAGER holds announcements:write but NOT approve, so write lets
  // them post and approve decides how far it goes.
  const rmA = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true });
  ctxs.push(rmA);
  await db.user.update({ where: { id: rmA.user.id }, data: { regionId: regA.id } });

  const rmFeed = await api(rmA.jar, "GET", "/api/hr/announcements");
  expect(rmFeed.payload?.canWrite === true,
    "a regional manager may now post", `canWrite=${rmFeed.payload?.canWrite}`);
  expect(rmFeed.payload?.canApprove === false,
    "*** but is not allowed to address everyone ***",
    `canApprove=${rmFeed.payload?.canApprove}`);
  expect(rmFeed.payload?.myRegionId === regA.id,
    "and the form is told which region is theirs",
    `myRegionId=${rmFeed.payload?.myRegionId}`);

  const rmOwn = await api(rmA.jar, "POST", "/api/hr/announcements",
    mk({ title: `${TAG} rm-own`, isGlobal: false, regionId: regA.id }));
  const rmOwnId = track(rmOwn);
  expect(rmOwn.status === 201,
    `they can post to ${regA.name}, their own region`, `status ${rmOwn.status}`);
  expect(rmOwn.payload?.announcement?.isGlobal === false
    && rmOwn.payload?.announcement?.regionId === regA.id,
    "and it is stored scoped to that region",
    `global=${rmOwn.payload?.announcement?.isGlobal} region=${rmOwn.payload?.announcement?.regionId}`);

  const rmGlobal = await api(rmA.jar, "POST", "/api/hr/announcements",
    mk({ title: `${TAG} rm-global`, isGlobal: true }));
  track(rmGlobal);
  expect(rmGlobal.status === 403,
    "*** they CANNOT post to everyone at Illume ***", `status ${rmGlobal.status}`);

  const rmOther = await api(rmA.jar, "POST", "/api/hr/announcements",
    mk({ title: `${TAG} rm-other`, isGlobal: false, regionId: regB.id }));
  track(rmOther);
  expect(rmOther.status === 403,
    `*** nor to ${regB.name}, somebody else's region ***`, `status ${rmOther.status}`);

  startSection("Editing is not a way around the reach rule");
  const escalate = await api(rmA.jar, "PATCH", `/api/hr/announcements/${rmOwnId}`,
    { isGlobal: true });
  expect(escalate.status === 403,
    "*** they cannot post regionally then widen it to everyone ***",
    `status ${escalate.status}`);
  const moveIt = await api(rmA.jar, "PATCH", `/api/hr/announcements/${rmOwnId}`,
    { isGlobal: false, regionId: regB.id });
  expect(moveIt.status === 403,
    "nor move it into another region", `status ${moveIt.status}`);
  const reword = await api(rmA.jar, "PATCH", `/api/hr/announcements/${rmOwnId}`,
    { title: `${TAG} rm-own reworded` });
  expect(reword.status === 200,
    "but they can still fix their own wording", `status ${reword.status}`);

  startSection("A regional manager with no region cannot post at all");
  const rmNone = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true });
  ctxs.push(rmNone);
  await db.user.update({ where: { id: rmNone.user.id }, data: { regionId: null } });
  const orphan = await api(rmNone.jar, "POST", "/api/hr/announcements",
    mk({ title: `${TAG} rm-noregion`, isGlobal: false, regionId: regA.id }));
  track(orphan);
  expect(orphan.status === 403,
    "*** refused, rather than silently reaching nobody ***", `status ${orphan.status}`);
  expect(/no region/i.test(orphan.payload?.error ?? ""),
    "and the message says why", `${orphan.payload?.error}`);

  startSection("Company-wide roles keep their reach");
  const execFeed = await api(exec.jar, "GET", "/api/hr/announcements");
  expect(execFeed.payload?.canApprove === true,
    "HQ_EXECUTIVE can still address everyone", `canApprove=${execFeed.payload?.canApprove}`);
  const vpGlobal = await api(vp.jar, "POST", "/api/hr/announcements",
    mk({ title: `${TAG} vp-global`, isGlobal: true }));
  track(vpGlobal);
  expect(vpGlobal.status === 201,
    "and VP_GLOBAL_SALES can post company-wide", `status ${vpGlobal.status}`);

  startSection("Clients see nothing");
  const client = await createAndLogin({ role: "INSTITUTION_CLIENT" });
  ctxs.push(client);
  const clientFeed = await api(client.jar, "GET", "/api/hr/announcements");
  expect((clientFeed.payload?.announcements ?? []).length === 0,
    "an institution client gets an empty feed",
    `${(clientFeed.payload?.announcements ?? []).length} shown`);
}

let code = 1;
try { await main(); code = summary(); }
catch (e) {
  console.error("\nFATAL:", e.message, "\n", (e.stack ?? "").split("\n").slice(0, 4).join("\n"));
}
finally {
  startSection("Teardown");
  const ids = [...new Set(posted)];
  if (ids.length) {
    const { count } = await db.announcement.deleteMany({ where: { id: { in: ids } } });
    console.log(`     removed ${count} QA announcement(s)`);
  }
  const strays = await db.announcement.deleteMany({ where: { title: { startsWith: TAG } } });
  if (strays.count) console.log(`     removed ${strays.count} stray QA announcement(s)`);
  const notifs = await db.notification.deleteMany({ where: { title: { startsWith: TAG } } });
  if (notifs.count) console.log(`     removed ${notifs.count} QA notification(s)`);
  for (const c of ctxs) await destroyUser(c);
  await db.$disconnect();
}
process.exit(code === 0 ? 0 : 1);
