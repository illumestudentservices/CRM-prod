/**
 * The "Email {student}" button is HIGHLIGHTED, not a quiet outline.
 *
 * Reps kept missing it, so on the student record it now renders as a filled
 * brand-navy button (the `default` Button variant: bg-[#1E3A5F] text-white),
 * and the marketing-declined variant renders filled AMBER (still visible, but
 * carrying the caution). This proves the rendered style, the mailto behaviour,
 * and the consent gate are all intact.
 *
 * Checks the SERVER-RENDERED HTML directly (authenticated fetch) rather than
 * driving a browser — deterministic, and it sidesteps the Turbopack dev
 * server's HMR socket, which never lets Playwright's networkidle settle.
 *
 *   BASE_URL=http://localhost:3000 \
 *   npx tsx --env-file=.env.local scripts/qa-email-button-highlight.mjs
 */
import { BASE, db, createAndLogin, destroyUser, startSection, expect, summary } from "./qa-lib.mjs";

const made = { users: [], leads: [] };

/** The chunk of HTML around the first occurrence of `needle`. */
function windowAround(html, needle, before = 400, after = 120) {
  const i = html.indexOf(needle);
  if (i < 0) return "";
  return html.slice(Math.max(0, i - before), i + needle.length + after);
}

async function fetchStudentHtml(jar, id) {
  const res = await fetch(`${BASE}/students/${id}`, { headers: { Cookie: jar.header() } });
  const html = await res.text();
  return { status: res.status, html };
}

try {
  startSection("Fixtures — a consented and a declined student");
  const template = await db.lead.findFirst({ where: { deletedAt: null } });
  expect(!!template, "found a lead to copy required fields from");

  const admin = await createAndLogin({ role: "SUPER_ADMIN" });
  made.users.push(admin);

  const mk = async (label, consent) => {
    const { id, createdAt, updatedAt, captureId, ...rest } = template;
    const l = await db.lead.create({
      data: {
        ...rest,
        firstName: "ZZBtn", lastName: label,
        email: `zzbtn-${label.toLowerCase()}-${Date.now()}@illume.local`,
        assignedICRId: admin.user.id, createdById: admin.user.id,
        ...consent,
      },
    });
    made.leads.push(l.id);
    return l;
  };
  const normal = await mk("Normal", { doNotContact: false, marketingConsent: true });
  const declined = await mk("Declined", { doNotContact: false, marketingConsent: false });

  for (let round = 1; round <= 3; round++) {
    // ── Consented: filled brand-navy mailto link ────────────────────────────
    // The button's href carries `?subject=` (mailToHref), which the plain
    // address in the "Email" detail row above it does not — so this needle hits
    // the button, not the detail row. (Avoids matching on the visible label,
    // which React splits with marker comments.)
    startSection(`round ${round}: consented → filled brand-navy link`);
    {
      const { status, html } = await fetchStudentHtml(admin.jar, normal.id);
      expect(status === 200, "student page loads", `status ${status}`);
      const needle = `mailto:${normal.email}?subject=`;
      expect(html.includes(needle), "Email button is a mailto link with a subject", needle);
      const win = windowAround(html, needle, 700, 400);
      expect(win.includes("bg-[#1E3A5F]") && win.includes("text-white"),
        "button is HIGHLIGHTED (filled brand navy)", `window="${win.slice(0, 220)}"`);
      expect(!win.includes("bg-transparent"),
        "button is not the old transparent outline");
    }

    // ── Declined: filled amber + consent caution still shown ────────────────
    startSection(`round ${round}: declined → filled amber, gate still warns`);
    {
      const { status, html } = await fetchStudentHtml(admin.jar, declined.id);
      expect(status === 200, "student page loads", `status ${status}`);
      expect(html.includes("bg-amber-500"),
        "declined button is HIGHLIGHTED amber");
      expect(/declined marketing/i.test(html), "the declined-marketing caution is shown");
    }
  }
} catch (e) {
  console.error("\nFATAL:", e?.message || e);
  process.exitCode = 1;
} finally {
  if (made.leads.length) await db.lead.deleteMany({ where: { id: { in: made.leads } } }).catch(() => {});
  for (const u of made.users) await destroyUser(u).catch(() => {});
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}
