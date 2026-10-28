/**
 * Files can be attached to a task note (message) and show inline in the thread:
 *   - uploading with parentType=TASK + commentId stores the file against that note;
 *   - the comments GET returns the note's attachments;
 *   - a commentId that belongs to a DIFFERENT task is rejected (404);
 *   - in the UI, a file attached in the composer is sent with the note and shows.
 *
 *   npx tsx --env-file=.env.local scripts/qa-task-comment-attachments.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { BASE, db, createAndLogin, destroyUser, api, startSection, expect, summary, TAG } from "./qa-lib.mjs";

const B = BASE.replace("127.0.0.1", "localhost");
// A tiny valid 1x1 PNG (passes the MIME allowlist/sniff).
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

async function uploadToComment(jar, taskId, commentId, filename = "qa.png") {
  const fd = new FormData();
  fd.append("file", new File([PNG], filename, { type: "image/png" }));
  const r = await fetch(`${BASE}/api/attachments?parentType=TASK&parentId=${taskId}&commentId=${commentId}`, {
    method: "POST", headers: { Cookie: jar.header() }, body: fd,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

let browser, rm, icr, task, otherTask, tmpFile;
try {
  rm = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true });   // creator
  icr = await createAndLogin({ role: "ICR", withEmployee: true });               // assignee
  task = await db.task.create({ data: { title: `${TAG} attach task`, createdById: rm.employee.id, assigneeId: icr.employee.id } });
  otherTask = await db.task.create({ data: { title: `${TAG} other`, createdById: rm.employee.id, assigneeId: rm.employee.id } });

  // ── Attach a file to a note ─────────────────────────────────────────────
  startSection("A file can be attached to a task note");
  let r = await api(icr.jar, "POST", `/api/tasks/${task.id}/comments`, { body: "Here is the document." });
  const commentId = r.payload?.comment?.id;
  expect(!!commentId, "note created", `got ${r.status}`);
  const up = await uploadToComment(icr.jar, task.id, commentId);
  expect(up.status === 201 && up.body?.data?.id, "file uploaded against the note", `got ${up.status}: ${JSON.stringify(up.body)?.slice(0,120)}`);
  const attId = up.body?.data?.id;
  const stored = await db.attachment.findUnique({ where: { id: attId }, select: { commentId: true, parentType: true, parentId: true } });
  expect(stored?.commentId === commentId && stored.parentType === "TASK" && stored.parentId === task.id, "attachment is linked to the note + task");

  // ── GET returns it inline ───────────────────────────────────────────────
  startSection("The thread returns the note's attachments");
  r = await api(icr.jar, "GET", `/api/tasks/${task.id}/comments`);
  const note = (r.payload?.comments ?? []).find((c) => c.id === commentId);
  expect(!!note && note.attachments?.length === 1, "note carries one attachment", `atts=${note?.attachments?.length}`);
  expect(note.attachments[0].id === attId && typeof note.attachments[0].size === "number", "attachment id + size present");

  // ── Cross-task commentId is rejected ────────────────────────────────────
  startSection("A note id from another task is rejected");
  r = await api(rm.jar, "POST", `/api/tasks/${otherTask.id}/comments`, { body: "other note" });
  const otherComment = r.payload?.comment?.id;
  const bad = await uploadToComment(icr.jar, task.id, otherComment); // task.id + a comment on otherTask
  expect(bad.status === 404, "uploading with a foreign note id is refused", `got ${bad.status}`);

  // ── UI: attach in the composer + send ───────────────────────────────────
  startSection("Attaching a file in the composer sends it with the note");
  tmpFile = path.join(os.tmpdir(), `qa-ticket-${TAG}.png`);
  fs.writeFileSync(tmpFile, PNG);
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.addCookies([...rm.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })));
  const p = await ctx.newPage();
  await p.goto(`${B}/tasks`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await p.getByText(`${TAG} attach task`, { exact: false }).first().click();
  const dialog = p.getByRole("dialog");
  await dialog.waitFor({ state: "visible", timeout: 10000 });
  await dialog.locator('input[type=file]').setInputFiles(tmpFile);
  // The pending chip shows the file name.
  expect((await dialog.getByText(path.basename(tmpFile)).count()) >= 1, "pending file chip appears");
  await dialog.getByPlaceholder(/Write a note/).fill(`sent with file ${TAG}`);
  await dialog.getByPlaceholder(/Write a note/).press("Control+Enter");
  // The note + its attachment land in the thread.
  await dialog.getByText(`sent with file ${TAG}`).first().waitFor({ state: "visible", timeout: 15000 });
  await dialog.getByText(path.basename(tmpFile)).first().waitFor({ state: "visible", timeout: 10000 });
  expect(true, "note + attachment appear in the thread");
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (tmpFile) try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  for (const t of [task, otherTask]) if (t) await db.task.delete({ where: { id: t.id } }).catch(() => {});
  if (icr) await destroyUser(icr);
  if (rm) await destroyUser(rm);
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}
