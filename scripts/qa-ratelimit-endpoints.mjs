/**
 * Confirms the per-user throttle on the IT-support contact endpoint
 * (POST /api/assistant/contact, limit 5 / 10 min): the 6th send from one
 * account is 429, a different account is unaffected. The other newly-limited
 * endpoints (partner-notes, lead-notes, task create) use the identical
 * rateLimit() call with generous caps; their normal-use safety is covered by
 * their existing QAs staying well under the cap.
 *
 *   BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-ratelimit-endpoints.mjs
 */
import { createAndLogin, destroyUser, db, api } from "./qa-lib.mjs";

const LIMIT = 5;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${x}`); } };

const u1 = await createAndLogin({ role: "EMPLOYEE" });
let u2;
try {
  const statuses = [];
  for (let i = 0; i < LIMIT; i++) {
    const r = await api(u1.jar, "POST", "/api/assistant/contact", { query: `help ${i}` });
    statuses.push(r.status);
  }
  ok(`first ${LIMIT} support messages not throttled`, statuses.every((s) => s !== 429), `statuses ${statuses.join(",")}`);

  const over = await api(u1.jar, "POST", "/api/assistant/contact", { query: "one too many" });
  ok(`support message #${LIMIT + 1} is throttled (429)`, over.status === 429, `got ${over.status}`);

  u2 = await createAndLogin({ role: "EMPLOYEE" });
  const other = await api(u2.jar, "POST", "/api/assistant/contact", { query: "different account" });
  ok("a different account is NOT throttled", other.status !== 429, `got ${other.status}`);
} catch (e) {
  fail++; console.error("CRASH:", e?.stack || e);
} finally {
  if (u2) await destroyUser(u2).catch(() => {});
  await destroyUser(u1).catch(() => {});
  await db.$disconnect().catch(() => {});
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
