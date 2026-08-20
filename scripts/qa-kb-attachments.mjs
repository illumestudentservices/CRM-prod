/**
 * Attachments on every knowledge base.
 *
 *   node --import tsx --env-file=.env.local scripts/qa-kb-attachments.mjs
 *
 * All three knowledge bases — General, Client and Market — write to the same
 * KnowledgeBase table, and all three endpoints already returned an
 * `attachments` relation. The /knowledge screen never rendered it, so only the
 * HR tab had the feature.
 *
 * The authorisation was the subtler half. Attaching was gated on a fixed list
 * of HR_MANAGER / SUPER_ADMIN / HQ_EXECUTIVE for all three, but a client or
 * market article is gated by institutions:write / markets:write — so a Regional
 * Manager could create one of those articles and then be refused when they
 * tried to attach anything to it. This asserts the rule is now "you may attach
 * to an article you could have written".
 */
import {
  db, api, createAndLogin, destroyUser,
  startSection, expect, ok, summary, TAG,
} from "./qa-lib.mjs";

const ctxs = [];
const made = { articles: [], attachments: [] };

/** Multipart upload, which the shared `api()` helper cannot express. */
async function upload(ctx, articleId, name, body = "hello") {
  const { BASE } = await import("./qa-lib.mjs");
  const fd = new FormData();
  fd.append("file", new File([body], name, { type: "text/plain" }));
  const res = await fetch(`${BASE}/api/hr/knowledge-base/attachments?articleId=${articleId}`, {
    method: "POST", headers: { Cookie: ctx.jar.header() }, body: fd,
  });
  const payload = await res.json().catch(() => null);
  return { status: res.status, payload };
}

async function main() {
  const admin = await createAndLogin({ role: "SUPER_ADMIN" });
  ctxs.push(admin);
  const region = await db.region.findFirst({ orderBy: { name: "asc" } });
  const rm = await createAndLogin({ role: "REGIONAL_MANAGER", extra: { regionId: region.id } });
  ctxs.push(rm);

  const inst = await db.institution.findFirst({ select: { id: true } });
  const market = await db.market.findFirst({ select: { id: true } });
  const author = admin.user.id;

  const article = async (extra) => {
    const a = await db.knowledgeBase.create({
      data: {
        title: `${TAG} article`, content: "body", category: "General",
        tags: [], authorId: author, isPublished: true, ...extra,
      },
      select: { id: true },
    });
    made.articles.push(a.id);
    return a.id;
  };

  const general = await article({});
  const instArticle = await article({ institutionId: inst.id });
  const marketArticle = await article({ marketId: market.id });

  // ── The endpoints already carry attachments ─────────────────────────────
  startSection("Every knowledge endpoint returns attachments");
  for (const [label, path] of [
    ["general", "/api/hr/knowledge-base"],
    ["client", `/api/institutions/${inst.id}/knowledge`],
    ["market", `/api/markets/${market.id}/knowledge`],
  ]) {
    const r = await api(admin.jar, "GET", path);
    const arr = r.payload?.articles ?? [];
    expect(r.status === 200 && Array.isArray(arr), `${label}: list answers`, `status ${r.status}`);
    expect(arr.length === 0 || "attachments" in arr[0],
      `${label}: articles carry an attachments field`,
      arr[0] ? Object.keys(arr[0]).join(",").slice(0, 80) : "no rows");
  }

  // ── A Super Admin can attach anywhere ───────────────────────────────────
  startSection("Super Admin can attach to all three");
  for (const [label, id] of [["general", general], ["client", instArticle], ["market", marketArticle]]) {
    const r = await upload(admin, id, `${label}.txt`);
    expect(r.status === 200 || r.status === 201, `attaches to the ${label} base`,
      `status ${r.status} ${JSON.stringify(r.payload).slice(0, 90)}`);
    if (r.payload?.attachment?.id) made.attachments.push(r.payload.attachment.id);
  }

  // ── The rule under test ─────────────────────────────────────────────────
  startSection("A Regional Manager may attach where they may write");
  {
    const r = await upload(rm, instArticle, "rm-client.txt");
    expect(r.status === 200 || r.status === 201,
      "*** attaches to a CLIENT article (they hold institutions:write) ***",
      `status ${r.status} — was refused by the old fixed HR-only list`);
    if (r.payload?.attachment?.id) made.attachments.push(r.payload.attachment.id);

    const m = await upload(rm, marketArticle, "rm-market.txt");
    expect(m.status === 200 || m.status === 201,
      "*** attaches to a MARKET article (they hold markets:write) ***",
      `status ${m.status}`);
    if (m.payload?.attachment?.id) made.attachments.push(m.payload.attachment.id);

    const g = await upload(rm, general, "rm-general.txt");
    expect(g.status === 403,
      "*** but NOT to a general article, which stays HR-only ***",
      `status ${g.status} — widening must not have gone too far`);
    if (g.payload?.attachment?.id) made.attachments.push(g.payload.attachment.id);
  }

  // ── Download and delete follow the same rule ────────────────────────────
  startSection("Download and removal");
  {
    const one = made.attachments[0];
    const r = await api(admin.jar, "GET", `/api/hr/knowledge-base/attachments/${one}`);
    expect(r.status === 200, "an attachment downloads", `status ${r.status}`);

    const stored = await db.knowledgeBaseAttachment.findFirst({
      where: { articleId: instArticle }, select: { id: true },
    });
    const del = await api(rm.jar, "DELETE", `/api/hr/knowledge-base/attachments/${stored.id}`);
    expect(del.status === 200 || del.status === 204,
      "*** a Regional Manager can remove one from a client article ***",
      `status ${del.status}`);
  }
}

let code = 1;
try { await main(); code = summary(); }
catch (e) { console.error("\nFATAL:", e.message, "\n", (e.stack ?? "").split("\n").slice(0, 3).join("\n")); }
finally {
  startSection("Teardown");
  for (const id of made.articles) {
    await db.knowledgeBaseAttachment.deleteMany({ where: { articleId: id } }).catch(() => {});
    await db.knowledgeBase.delete({ where: { id } }).catch(() => {});
  }
  for (const c of ctxs) await destroyUser(c);
  const left = await db.user.count({ where: { email: { startsWith: TAG.toLowerCase() } } });
  const arts = await db.knowledgeBase.count({ where: { title: { startsWith: TAG } } });
  expect(left === 0 && arts === 0, "fixtures removed", `users ${left}, articles ${arts}`);
  await db.$disconnect();
}
process.exit(code === 0 ? 0 : 1);
