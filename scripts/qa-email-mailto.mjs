/**
 * The lead "Email" button must produce a mailto: with a LITERAL "@", not a
 * percent-encoded "%40" (which Apple Mail on macOS fails to open). We render
 * the real lead detail page server-side as an admin and inspect the href.
 *
 *   npx tsx --env-file=.env.local scripts/qa-email-mailto.mjs
 */
import { db, createAndLogin, destroyUser, BASE, startSection, expect, summary } from "./qa-lib.mjs";

/** GET a page and return its server-rendered HTML as text. */
async function getHtml(jar, path) {
  const res = await fetch(`${BASE}${path}`, { headers: { cookie: jar.header() }, redirect: "manual" });
  return await res.text();
}

let admin, lead;
const EMAIL = `qa.mailto+tag@example.com`; // the "+" and "@" are the risky chars

try {
  admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });

  // A lead with a known email, contactable (no do-not-contact), consent null so
  // the plain anchor renders (not the warning dialog path).
  lead = await db.lead.create({
    data: {
      firstName: "Mailto", lastName: "Check", email: EMAIL,
      nationality: "QA", countryOfResidence: "QA", interestedProgram: "QA",
      intakeYear: 2027, intakeMonth: 1, studyLevel: "UNDERGRADUATE", createdById: admin.user.id,
      stage: "NEW_LEAD", doNotContact: false, marketingConsent: null,
    },
  });

  startSection("Lead Email button renders a clean mailto (×3)");
  for (let i = 1; i <= 3; i++) {
    const html = await getHtml(admin.jar, `/students/${lead.id}`);
    // The compose link must carry the real address.
    const hasLiteral = html.includes(`mailto:${EMAIL}`);
    const hasEncoded = html.includes("mailto:qa.mailto%2Btag%40example.com") || html.includes("%40example.com");
    expect(hasLiteral, `run ${i}: href is mailto:${EMAIL} (literal @)`, hasLiteral ? "" : "literal mailto not found in SSR HTML");
    expect(!hasEncoded, `run ${i}: no %40-encoded recipient present`, hasEncoded ? "found %40 in a mailto" : "");
  }
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  if (lead) await db.lead.delete({ where: { id: lead.id } }).catch(() => {});
  if (admin) await destroyUser(admin);
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}
