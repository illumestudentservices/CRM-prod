/**
 * Password-reset tokens are stored HASHED, never in plaintext.
 *
 * Proves: the DB row holds SHA-256(token), not the raw token; the raw token
 * from the emailed link still verifies and sets a password; it is single-use;
 * and a stolen DB hash CANNOT be replayed (the verify route hashes its input,
 * so presenting the stored hash just hashes it again and misses).
 *
 *   DATABASE_URL -> test (via tunnel), dev server on :3000:
 *   BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-reset-token-hash.ts
 */
import bcrypt from "bcryptjs";
import { db, BASE } from "./qa-lib.mjs";
import { createMagicLink } from "@/lib/magic-link";
import { hashResetToken } from "@/lib/password";

let pass = 0, fail = 0;
function expect(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}
const getJson = async (path: string) => {
  const r = await fetch(`${BASE}${path}`);
  return { status: r.status, json: await r.json().catch(() => ({})) };
};

async function run() {
  const tag = `R${Date.now().toString().slice(-6)}`;
  const user = await db.user.create({
    data: {
      email: `reset-${tag}@qa.local`, firstName: "Reset", lastName: tag, name: `Reset ${tag}`,
      password: await bcrypt.hash("OldPass!2345", 10), role: "ICR" as never, isActive: true, passwordChangedAt: new Date(),
    },
  });
  try {
    for (let round = 1; round <= 3; round++) {
      console.log(`\n── round ${round} ──`);
      await db.passwordResetToken.deleteMany({ where: { userId: user.id } });

      const url = await createMagicLink(user.id, 24);
      const raw = url.split("/").pop()!;
      const hash = hashResetToken(raw);

      // ── Storage: hash, not raw ──────────────────────────────────────────
      const byHash = await db.passwordResetToken.findUnique({ where: { token: hash } });
      expect("token stored as its SHA-256 hash", !!byHash && byHash.userId === user.id);
      const byRaw = await db.passwordResetToken.findUnique({ where: { token: raw } });
      expect("raw token is NOT present in the DB", byRaw === null);
      expect("stored value differs from the raw token", byHash?.token !== raw && byHash?.token === hash);

      // ── Verify with the RAW token (the emailed link) works ──────────────
      let r = await getJson(`/api/auth/verify-reset-token?token=${raw}`);
      expect("GET verify(raw link) → valid", r.status === 200 && r.json.valid === true, JSON.stringify(r.json));

      // ── A STOLEN DB HASH cannot be replayed (gets re-hashed on verify) ───
      r = await getJson(`/api/auth/verify-reset-token?token=${hash}`);
      expect("GET verify(stolen hash) → INVALID", r.json.valid === false, JSON.stringify(r.json));

      r = await getJson(`/api/auth/verify-reset-token?token=deadbeefdeadbeef`);
      expect("GET verify(bogus) → not_found", r.json.valid === false && r.json.reason === "not_found", JSON.stringify(r.json));

      // ── Set the password with the raw link ──────────────────────────────
      const newPw = `ResetPass!${round}234`;
      const setRes = await fetch(`${BASE}/api/auth/verify-reset-token`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: raw, password: newPw }),
      });
      const setJson = await setRes.json().catch(() => ({}));
      expect("POST set-password with raw link → success", setRes.status === 200 && setJson.success === true, `${setRes.status} ${JSON.stringify(setJson)}`);

      const fresh = await db.user.findUnique({ where: { id: user.id }, select: { password: true } });
      let changed = false;
      if (fresh?.password) changed = await bcrypt.compare(newPw, fresh.password);
      expect("the account password actually changed", changed);

      // ── Single-use: the raw token is now spent ──────────────────────────
      r = await getJson(`/api/auth/verify-reset-token?token=${raw}`);
      expect("raw token is single-use (now 'used')", r.json.valid === false && r.json.reason === "used", JSON.stringify(r.json));
    }
  } finally {
    await db.passwordResetToken.deleteMany({ where: { userId: user.id } }).catch(() => {});
    await db.passwordHistory.deleteMany({ where: { userId: user.id } }).catch(() => {});
    await db.user.delete({ where: { id: user.id } }).catch(() => {});
    await db.$disconnect().catch(() => {});
  }
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
run().catch(async (e) => { console.error("qa crashed", e); await db.$disconnect().catch(() => {}); process.exit(1); });
