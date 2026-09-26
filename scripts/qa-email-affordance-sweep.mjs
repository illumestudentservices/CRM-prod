/**
 * Every contactable address, everywhere — and the consent gate holding.
 *
 *   npx tsx --env-file=.env scripts/qa-email-affordance-sweep.mjs
 *
 * ★ THE ASSERTION THAT MATTERS is that a STUDENT's address is never rendered
 * through the UNGATED component.
 *
 * `EmailLink` has no consent gate on purpose — colleagues and business
 * contacts do not carry one. That makes it dangerous in the wrong place: used
 * for a Lead it would put a do-not-contact student one click from being
 * contacted, and nothing about the code would look wrong. A per-screen test
 * cannot catch that, because the mistake is in a screen nobody thought to
 * test. So this greps the source instead.
 *
 * Read-only: no fixtures, no database writes.
 */
import fs from "node:fs";
import path from "node:path";
import { startSection, expect, summary } from "./qa-lib.mjs";

const ROOTS = ["app", "components"];
const GATED = "EmailStudentLink";
const UNGATED = "EmailLink";

/** Every .tsx under the roots. */
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const files = ROOTS.flatMap((r) => (fs.existsSync(r) ? walk(r) : []));

try {
  startSection("The sweep can see the codebase");
  expect(files.length > 50, `${files.length} .tsx files scanned`);

  // ── Nothing renders a raw student address where it could be clicked ───────
  startSection("A student's address is never rendered through the ungated link");
  {
    const offenders = [];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      // `EmailStudentLink` contains "EmailLink" as a substring, so the ungated
      // component has to be matched on its own — otherwise every gated call
      // site reads as a violation and the check inverts.
      const usesUngated = /(?<!Student)\bEmailLink\b/.test(src);
      if (!usesUngated) continue;
      // ★ Match a lead's ADDRESS, not the word "lead". The first version
      // flagged `counts: { leads: number }` on the institutions page and the
      // sentence "Their leads, reports and audit history are kept" in settings
      // — neither renders a student's email at all. A check that cries wolf on
      // prose gets ignored, which costs more than the check is worth.
      const rendersLeadEmail = /\blead\w*\.email\b/i.test(src);
      if (rendersLeadEmail) offenders.push(f.replace(/\\/g, "/"));
    }
    expect(offenders.length === 0,
      "no file renders both a Lead and the ungated EmailLink",
      offenders.join(", ") || "");
  }

  // ── Every student surface uses the gated one ──────────────────────────────
  startSection("Every screen showing a student's address uses the gated link");
  {
    const STUDENT_SURFACES = [
      "app/(dashboard)/students/_components/lead-list-view.tsx",
      "app/(dashboard)/search/page.tsx",
      "app/(dashboard)/analytics/_components/drill-down-sheet.tsx",
      "app/(dashboard)/students/[id]/page.tsx",
    ];
    for (const f of STUDENT_SURFACES) {
      expect(fs.existsSync(f), `${f.replace("app/(dashboard)/", "")} exists`);
      if (!fs.existsSync(f)) continue;
      const src = fs.readFileSync(f, "utf8");
      const gated = src.includes(GATED) || src.includes("EmailStudentButton");
      expect(gated, `  ${f.split("/").pop()} uses the gated component`);
    }
  }

  // ── The gate reads all three states ───────────────────────────────────────
  startSection("The gate itself still reads every consent state");
  {
    const src = fs.readFileSync(
      "app/(dashboard)/students/[id]/_components/email-student-button.tsx", "utf8");
    expect(/doNotContact/.test(src), "it reads doNotContact");
    expect(/marketingConsent === false/.test(src),
      "and distinguishes 'declined' from 'never asked'",
      "a truthy check would treat null as a refusal and warn on everyone");
    expect(!/marketingConsent\s*\?/.test(src.replace(/marketingConsent === false/g, "")),
      "…and does not collapse the three-valued field into a boolean");
  }

  // ── The ungated component documents why it is safe ────────────────────────
  startSection("The ungated component says why it has no gate");
  {
    const src = fs.readFileSync("components/shared/email-link.tsx", "utf8");
    expect(/kind:\s*"colleague"\s*\|\s*"business"/.test(src),
      "it forces each call site to declare which case applies");
    expect(/STUDENT/.test(src) && /never/i.test(src),
      "and warns in terms against using it for a student");
  }

  // ── Nothing left behind as plain text on a contact surface ────────────────
  startSection("Known contact surfaces now offer the affordance");
  {
    const WIRED = [
      ["app/(dashboard)/institutions/[id]/_components/institution-tabs-client.tsx", "university contacts"],
      ["app/(dashboard)/recruitment-network/partners/[id]/_components/partner-contacts-panel.tsx", "partner contacts"],
      ["app/(dashboard)/stakeholders/_components/stakeholders-tabs.tsx", "school counsellors"],
      ["app/(dashboard)/hr/_components/employee-table.tsx", "colleagues (HR table)"],
      ["app/(dashboard)/settings/_components/users-tab.tsx", "colleagues (settings)"],
    ];
    for (const [f, label] of WIRED) {
      const src = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
      expect(/(?<!Student)\bEmailLink\b/.test(src), `${label} are clickable`);
    }
  }

  // ── Anchors, not window.location ──────────────────────────────────────────
  startSection("Every affordance is a real link");
  {
    for (const f of [
      "components/shared/email-link.tsx",
      "app/(dashboard)/students/[id]/_components/email-student-button.tsx",
    ]) {
      const src = fs.readFileSync(f, "utf8");
      expect(!/window\.location\.href\s*=/.test(src),
        `${f.split("/").pop()} navigates by anchor, not window.location`,
        "an anchor is keyboard-reachable, right-clickable, and its destination is testable");
      // Comments stripped first: both files explain in prose WHY they avoid
      // target="_blank", and matching the explanation instead of the code
      // fails against exactly the thing it is meant to reward.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(!/target="_blank"/.test(code),
        `  …and no target="_blank"`,
        "a mailto in a new tab leaves an empty tab once the handler takes over");
      expect(/stopPropagation/.test(src),
        `  …and stops the click reaching the row behind it`);
    }
  }
} catch (e) {
  console.error("FATAL:", e.message);
  process.exitCode = 1;
} finally {
  summary();
}
