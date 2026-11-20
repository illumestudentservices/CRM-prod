/**
 * API test for the recruitment-partner (agent) Notes thread.
 * GET/POST /api/recruitment-network/partners/:id/notes — 3 rounds:
 *   • a writer (SUPER_ADMIN) adds a note (201) and GET lists it newest-first
 *     with the author resolved
 *   • empty content → 400; unknown partner → 404
 *   • a read-only role (ACCOUNT_MANAGER) can GET (200) but not POST (403)
 *
 *   BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-partner-notes.mjs
 */
import { createAndLogin, destroyUser, db, api } from "./qa-lib.mjs";

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${x}`); } };

const admin = await createAndLogin({ role: "SUPER_ADMIN" });
let reader, partner;
try {
  partner = await db.recruitmentPartner.create({
    data: { name: `QA Agent ${Date.now()}`, type: "AGENT", country: "India", createdById: admin.user.id },
  });
  const base = `/api/recruitment-network/partners/${partner.id}/notes`;

  for (let r = 1; r <= 3; r++) {
    console.log(`\n── round ${r} ──`);
    const post = await api(admin.jar, "POST", base, { content: `note r${r}` });
    ok("POST note → 201", post.status === 201, `status ${post.status}`);
    ok("response carries author name", !!post.payload?.author?.name, JSON.stringify(post.payload?.author));

    const list = await api(admin.jar, "GET", base);
    ok("GET → 200 array", list.status === 200 && Array.isArray(list.payload), `status ${list.status}`);
    ok("newest note first", list.payload?.[0]?.content === `note r${r}`, list.payload?.[0]?.content);
    ok("listed note has author", !!list.payload?.[0]?.author?.name);
    ok("count grows each round", Array.isArray(list.payload) && list.payload.length === r, `len ${list.payload?.length}`);
  }

  const empty = await api(admin.jar, "POST", base, { content: "   " });
  ok("empty content → 400", empty.status === 400, `status ${empty.status}`);

  const notFound = await api(admin.jar, "POST", `/api/recruitment-network/partners/does-not-exist/notes`, { content: "x" });
  ok("unknown partner → 404", notFound.status === 404, `status ${notFound.status}`);

  // Read-only role: can read the thread, cannot append.
  reader = await createAndLogin({ role: "ACCOUNT_MANAGER" });
  const rGet = await api(reader.jar, "GET", base);
  ok("read-only role GET → 200", rGet.status === 200, `status ${rGet.status}`);
  const rPost = await api(reader.jar, "POST", base, { content: "should be blocked" });
  ok("read-only role POST → 403", rPost.status === 403, `status ${rPost.status}`);

  // Unauthenticated is blocked — proxy.ts redirects to login (307) before the
  // route's own 401 defence-in-depth runs; either way it never reaches data.
  const anon = await api({ header: () => "" }, "GET", base);
  ok("no session blocked (307 redirect or 401)", anon.status === 307 || anon.status === 401, `status ${anon.status}`);
} catch (e) {
  fail++; console.error("CRASH:", e?.stack || e);
} finally {
  if (partner) {
    await db.partnerNote.deleteMany({ where: { partnerId: partner.id } }).catch(() => {});
    await db.recruitmentPartner.delete({ where: { id: partner.id } }).catch(() => {});
  }
  if (reader) await destroyUser(reader).catch(() => {});
  await destroyUser(admin).catch(() => {});
  await db.$disconnect().catch(() => {});
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
