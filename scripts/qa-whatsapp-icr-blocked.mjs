/**
 * ICR must NOT have WhatsApp:
 *   - the permission matrix denies ICR whatsapp read AND write;
 *   - REGIONAL_MANAGER still has it (no regression);
 *   - live: an ICR POST to /api/whatsapp/send is refused 403 (before any send).
 *
 * We deliberately do NOT fire a REGIONAL_MANAGER send live — that would hit the
 * real WhatsApp provider and message a number. The matrix check covers RM.
 *
 *   npx tsx --env-file=.env.local scripts/qa-whatsapp-icr-blocked.mjs
 */
import { db, createAndLogin, destroyUser, api, startSection, expect, summary } from "./qa-lib.mjs";
// permissions.ts has only type-imports, so tsx emits it CJS — reach the named
// export through the default-interop namespace.
import * as permMod from "../lib/permissions.ts";
const { hasPermission } = permMod.default ?? permMod;

let icr;

try {
  // ── Matrix: ICR denied, RM allowed (×3) ─────────────────────────────────
  startSection("Permission matrix: ICR has no WhatsApp, RM does (×3)");
  for (let i = 1; i <= 3; i++) {
    expect(hasPermission("ICR", "whatsapp", "write") === false, `run ${i}: ICR whatsapp:write denied`);
    expect(hasPermission("ICR", "whatsapp", "read") === false, `run ${i}: ICR whatsapp:read denied`);
    expect(hasPermission("REGIONAL_MANAGER", "whatsapp", "write") === true, `run ${i}: RM keeps whatsapp:write`);
    expect(hasPermission("SUPER_ADMIN", "whatsapp", "write") === true, `run ${i}: admin keeps whatsapp:write`);
  }

  // ── Live: ICR send is refused 403 (×3) ──────────────────────────────────
  startSection("Live: ICR POST /api/whatsapp/send is 403 (×3)");
  icr = await createAndLogin({ role: "ICR", withEmployee: true });
  for (let i = 1; i <= 3; i++) {
    const r = await api(icr.jar, "POST", "/api/whatsapp/send", {
      phone: "+10000000000", body: "qa should never send", leadId: null,
    });
    expect(r.status === 403, `run ${i}: ICR send refused (403, no message sent)`, `got ${r.status}`);
  }
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  if (icr) await destroyUser(icr);
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}
