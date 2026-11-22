/**
 * QA for the "Devices & sessions" build (/api/account/sessions + lib/auth.ts).
 *
 * Proves: a real login is recorded; GET lists only MY sessions with the current
 * one flagged; a session can be logged out; "others" logs out all but current;
 * I cannot log out another user's session (IDOR → 404); and revoking a session
 * actually locks that exact cookie out on its next request (end-to-end).
 *
 *   npx tsx --env-file=.env.local scripts/qa-active-sessions.mjs
 */
import { db, createAndLogin, destroyUser, api, startSection, expect, summary, TAG } from "./qa-lib.mjs";

let userA, userB;
const seededSids = [];

async function seedSession(userId, sid, userAgent) {
  await db.activeSession.create({ data: { sid, userId, userAgent } });
  seededSids.push(sid);
}

try {
  userA = await createAndLogin({ role: "ICR", withEmployee: true });
  userB = await createAndLogin({ role: "ICR", withEmployee: true });

  // ── The real login was recorded ────────────────────────────────────────────
  startSection("A real login is recorded and listed as current");
  {
    const rowCount = await db.activeSession.count({ where: { userId: userA.user.id } });
    expect(rowCount >= 1, "login created an active_session row", `got ${rowCount}`);

    const g = await api(userA.jar, "GET", "/api/account/sessions");
    expect(g.status === 200, "GET sessions 200", `got ${g.status}`);
    const list = g.payload?.data ?? [];
    const current = list.filter((s) => s.current);
    expect(current.length === 1, "exactly one session flagged current", `got ${current.length}`);
    globalThis.__currentSid = current[0]?.id;
  }
  const currentSid = globalThis.__currentSid;

  // ── Device label + scoping of the list ─────────────────────────────────────
  startSection("List shows a friendly label and only my own sessions");
  {
    await seedSession(userA.user.id, `${TAG}-sidB`, "Mozilla/5.0 (X11; Linux x86_64) Gecko Firefox/120.0");
    const g = await api(userA.jar, "GET", "/api/account/sessions");
    const list = g.payload?.data ?? [];
    expect(list.length === 2, "both my sessions listed", `got ${list.length}`);
    const fake = list.find((s) => s.id === `${TAG}-sidB`);
    expect(!!fake && fake.label === "Firefox on Linux", "user-agent parsed to a label", fake?.label ?? "");
    expect(!!fake && fake.current === false, "seeded session is not flagged current");

    // userB must not see userA's sessions
    const gb = await api(userB.jar, "GET", "/api/account/sessions");
    const bIds = (gb.payload?.data ?? []).map((s) => s.id);
    expect(!bIds.includes(`${TAG}-sidB`) && !bIds.includes(currentSid), "another user cannot see my sessions");
  }

  // ── IDOR: cannot revoke someone else's session ─────────────────────────────
  startSection("Cannot log out another user's session");
  {
    const d1 = await api(userB.jar, "DELETE", "/api/account/sessions", { sid: `${TAG}-sidB` });
    expect(d1.status === 404, "userB revoking userA's seeded sid → 404", `got ${d1.status}`);
    const d2 = await api(userB.jar, "DELETE", "/api/account/sessions", { sid: currentSid });
    expect(d2.status === 404, "userB revoking userA's current sid → 404", `got ${d2.status}`);
    const stillThere = await db.activeSession.findUnique({ where: { sid: `${TAG}-sidB` } });
    const notRevoked = await db.revokedSession.findUnique({ where: { sid: `${TAG}-sidB` } });
    expect(!!stillThere && !notRevoked, "victim session untouched (present, not revoked)");
  }

  // ── Log out one of my own sessions ─────────────────────────────────────────
  startSection("Log out a single session");
  {
    const d = await api(userA.jar, "DELETE", "/api/account/sessions", { sid: `${TAG}-sidB` });
    expect(d.status === 200 && d.payload?.revoked === 1, "revoke my seeded session → 1", JSON.stringify(d.payload));
    const gone = await db.activeSession.findUnique({ where: { sid: `${TAG}-sidB` } });
    const revoked = await db.revokedSession.findUnique({ where: { sid: `${TAG}-sidB` } });
    expect(!gone && !!revoked, "active row removed + revoked row written");
    const g = await api(userA.jar, "GET", "/api/account/sessions");
    expect((g.payload?.data ?? []).length === 1, "list back to just the current session");
  }

  // ── Log out all other devices ──────────────────────────────────────────────
  startSection("Log out all OTHER devices, keep current");
  {
    await seedSession(userA.user.id, `${TAG}-sidC`, "Mozilla/5.0 Chrome/120 Windows");
    await seedSession(userA.user.id, `${TAG}-sidD`, "Mozilla/5.0 Safari iPhone");
    const d = await api(userA.jar, "DELETE", "/api/account/sessions", { scope: "others" });
    expect(d.status === 200 && d.payload?.revoked === 2, "revoked the 2 other sessions", JSON.stringify(d.payload));
    const remaining = await db.activeSession.findMany({ where: { userId: userA.user.id }, select: { sid: true } });
    expect(remaining.length === 1 && remaining[0].sid === currentSid, "only current session remains", JSON.stringify(remaining));
  }

  // ── End-to-end: a revoked session's cookie is locked out next request ──────
  startSection("Revoking a session locks that cookie out (end-to-end)");
  {
    const d = await api(userA.jar, "DELETE", "/api/account/sessions", { sid: currentSid });
    expect(d.status === 200, "revoke my own current session → 200", `got ${d.status}`);
    // Same cookie jar — the jwt live-check must now refuse this sid.
    const after = await api(userA.jar, "GET", "/api/account/sessions");
    expect(after.status === 401 || after.status === 307 || after.status === 302,
      "the revoked cookie is no longer authenticated", `got ${after.status}`);
  }
} catch (e) {
  console.error("CRASH", e?.stack || e);
} finally {
  for (const uid of [userA?.user?.id, userB?.user?.id].filter(Boolean)) {
    await db.activeSession.deleteMany({ where: { userId: uid } }).catch(() => {});
    await db.revokedSession.deleteMany({ where: { userId: uid } }).catch(() => {});
  }
  if (userA) await destroyUser(userA).catch(() => {});
  if (userB) await destroyUser(userB).catch(() => {});
  await db.$disconnect().catch(() => {});
  summary();
}
