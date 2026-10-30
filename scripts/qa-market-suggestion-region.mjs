/**
 * market-intelligence suggestion review region scope (pentest MEDIUM).
 *
 * POST /api/market-intelligence/suggestions/[id]/review lets a Regional
 * Manager approve/edit/reject an ICR's suggestion — and an approve/edit writes
 * straight into the market's intelligence fields. It checked only
 * market_intelligence:approve (held by every RM), never that the market was
 * one the RM manages, so any RM could edit another region's market record.
 * Fix: a RM is confined to markets assigned to them (market.regionalManagerId);
 * SUPER_ADMIN is unscoped; out of scope is 404.
 *
 *   npx tsx --env-file=.env.local scripts/qa-market-suggestion-region.mjs
 */
import { db, createAndLogin, destroyUser, api, startSection, expect, summary, TAG } from "./qa-lib.mjs";

let admin, rm1, rm2, marketOwn, marketOther;
const suggestionIds = [];

const mkSuggestion = async (marketId, submittedById) => {
  const s = await db.marketUpdateSuggestion.create({
    data: { marketId, kind: "OTHER", originalText: `${TAG} suggestion`, submittedById, status: "PENDING" },
  });
  suggestionIds.push(s.id);
  return s;
};
const statusOf = async (id) => (await db.marketUpdateSuggestion.findUnique({ where: { id }, select: { status: true } }))?.status;

try {
  admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  rm1 = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true });
  rm2 = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true });

  marketOwn = await db.market.create({
    data: { name: `${TAG} Market Own`, code: `${TAG}OWN`, createdById: admin.user.id, regionalManagerId: rm1.user.id },
  });
  marketOther = await db.market.create({
    data: { name: `${TAG} Market Other`, code: `${TAG}OTH`, createdById: admin.user.id, regionalManagerId: rm2.user.id },
  });

  for (let run = 1; run <= 3; run++) {
    startSection(`suggestion review region scope (run ${run})`);
    const sOwn = await mkSuggestion(marketOwn.id, admin.user.id);
    const sOther = await mkSuggestion(marketOther.id, admin.user.id);

    // THE ATTACK: rm1 reviews a suggestion on a market they do NOT manage.
    let r = await api(rm1.jar, "POST", `/api/market-intelligence/suggestions/${sOther.id}/review`, { decision: "REJECTED" });
    expect(r.status === 404, "RM CANNOT review a suggestion for another RM's market (404)", `got ${r.status}`);
    expect((await statusOf(sOther.id)) === "PENDING", "the other market's suggestion is untouched (still PENDING)", await statusOf(sOther.id));

    // rm1 reviews a suggestion on a market they manage → allowed.
    r = await api(rm1.jar, "POST", `/api/market-intelligence/suggestions/${sOwn.id}/review`, { decision: "REJECTED" });
    expect(r.ok, "RM can review a suggestion for a market they manage (200)", `got ${r.status}`);
    expect((await statusOf(sOwn.id)) === "REJECTED", "their own market's suggestion was reviewed", await statusOf(sOwn.id));

    // SUPER_ADMIN is unscoped — can review the other market's suggestion.
    r = await api(admin.jar, "POST", `/api/market-intelligence/suggestions/${sOther.id}/review`, { decision: "REJECTED" });
    expect(r.ok, "SUPER_ADMIN can review any market's suggestion (200)", `got ${r.status}`);
  }
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  for (const id of suggestionIds) await db.marketUpdateSuggestion.delete({ where: { id } }).catch(() => {});
  for (const m of [marketOwn, marketOther]) if (m) await db.market.delete({ where: { id: m.id } }).catch(() => {});
  for (const u of [admin, rm1, rm2]) if (u) await destroyUser(u);
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}
