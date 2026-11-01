import { infoTable, badge, ctaButton, wrapEmail, escapeHtml, rawHtml } from "@/lib/email";
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const XSS = `<script>alert(1)</script>`;
function run(n: number) {
  console.log(`-- run ${n} --`);
  const t1 = infoTable([["Name", XSS]]);
  ok(!t1.includes(XSS) && t1.includes("&lt;script&gt;"), "string cell is escaped");
  const t2 = infoTable([["Status", rawHtml(badge("Approved", "#22c55e"))]]);
  ok(t2.includes("<span") && t2.includes("Approved"), "rawHtml(badge) still renders as HTML");
  ok(badge(XSS, "#000").includes("&lt;script&gt;") && !badge(XSS, "#000").includes(XSS), "badge text is escaped");
  const c = ctaButton(XSS, "https://x/y?a=1&b=2");
  ok(!c.includes(XSS), "cta text is escaped");
  ok(c.includes('href="https://x/y?a=1&b=2"'), "cta href left intact");
  const w = wrapEmail(XSS, "<p>trusted body</p>", XSS);
  ok(!w.includes(XSS) && w.includes("&lt;script&gt;"), "wrapEmail title+preheader escaped");
  ok(w.includes("<p>trusted body</p>"), "wrapEmail body (trusted) preserved");
  ok(escapeHtml(`<>&"'`) === "&lt;&gt;&amp;&quot;&#39;", "escapeHtml covers all five chars");
  ok(infoTable([["City", "José Ramírez"]]).includes("José Ramírez"), "normal unicode text preserved");
}
for (let i = 1; i <= 3; i++) run(i);
console.log(`\nTOTAL ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
