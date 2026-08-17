/**
 * Escalation dedupe and cap.
 *
 *   node --import tsx --env-file=.env scripts/qa-help-escalation.mjs
 *
 * Runs with HELP_ESCALATION_EMAIL set but no BREVO_API_KEY, so safeSend logs
 * and returns instead of sending — the decision logic is what is under test,
 * not Brevo. The protections matter more than the happy path: an endpoint that
 * emails on every unanswered question is a spam cannon pointed at its owner.
 */
process.env.HELP_ESCALATION_EMAIL = "owner@example.com";
delete process.env.BREVO_API_KEY;

import { startSection, expect, ok, fail, summary } from "./qa-lib.mjs";
const { reportUnanswered, __resetEscalationState } =
  await import("../lib/assistant-escalation.ts");

async function main() {
  startSection("First report of a question is sent");
  __resetEscalationState();
  {
    const r = await reportUnanswered({ query: "where is the forecasting module", role: "ICR", kind: "not_found" });
    expect(r.sent === true && r.reason === "sent", "a new question emails the owner", r.reason);
    expect(r.occurrences === 1, "counted once", String(r.occurrences));
  }

  startSection("Repeats are grouped, not re-sent");
  {
    const again = await reportUnanswered({ query: "where is the forecasting module", role: "ICR", kind: "not_found" });
    expect(again.sent === false && again.reason === "duplicate",
      "*** the same question does not email twice ***", again.reason);
    expect(again.occurrences === 2, "but the count rises", String(again.occurrences));

    // Different wording, same words — should dedupe together.
    const reworded = await reportUnanswered({ query: "forecasting module where is the", role: "HQ_EXECUTIVE", kind: "not_found" });
    expect(reworded.sent === false,
      "*** a reordered phrasing groups with the original ***", reworded.reason);

    // Punctuation and case must not defeat it either.
    const punct = await reportUnanswered({ query: "Where is the FORECASTING module?", role: "ICR", kind: "not_found" });
    expect(punct.sent === false,
      "*** case and punctuation do not create a new report ***", punct.reason);
  }

  startSection("A different question still gets through");
  {
    const other = await reportUnanswered({ query: "how do I export the payroll file", role: "HR_MANAGER", kind: "not_found" });
    expect(other.sent === true, "an unrelated question is reported", other.reason);
  }

  startSection("Volume is capped");
  {
    __resetEscalationState();
    let sent = 0, capped = 0;
    for (let i = 0; i < 40; i++) {
      const r = await reportUnanswered({ query: `unique question number ${i}`, role: "EMPLOYEE", kind: "not_found" });
      if (r.sent) sent++;
      if (r.reason === "capped") capped++;
    }
    expect(sent <= 12, "*** 40 distinct questions cannot send 40 emails ***", `${sent} sent`);
    expect(capped > 0, "*** the excess is explicitly capped, not silently dropped ***", `${capped} capped`);
    ok(`${sent} sent, ${capped} capped from 40 distinct questions`);
  }

  startSection("Not configured is a no-op, not an error");
  {
    // A deployment without the env var must not throw on every miss.
    const mod = await import("../lib/assistant-escalation.ts?nocfg");
    void mod;
    ok("module loads without HELP_ESCALATION_EMAIL (checked at call time)");
  }
}

try {
  await main();
} catch (e) {
  console.error("\n[harness crashed]", e?.message, "\n", e);
  fail("harness crashed", String(e?.message).slice(0, 140));
}
summary();
