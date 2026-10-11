/**
 * Documents on a staff record: 3 MB, safe types, and nobody else's eyes.
 *
 *   node --import tsx --env-file=.env.local scripts/qa-employee-documents.mjs
 *
 * ★ THE PART THAT MATTERS IS WHO CANNOT SEE THEM.
 *
 * A staff record carries contracts, passport scans, visas and medical notes.
 * The upload working is the easy half; the half worth testing is that a
 * colleague with the employee's id — which is in the URL of every profile
 * page — gets nothing, and that a line manager does too.
 *
 * The manager case is deliberate and easy to get wrong in the "helpful"
 * direction. The same clause was added to TASK attachments and removed hours
 * later: a permission like this cannot be taken back once somebody has read a
 * colleague's visa.
 */
import {
  db, createAndLogin, destroyUser, api, apiRaw,
  startSection, expect, summary, TAG, BASE,
} from "./qa-lib.mjs";

const { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } = await import("../lib/uploads.ts");

const ctxs = [];
const uploaded = [];

/** multipart POST, since qa-lib's api() sends JSON. */
async function upload(jar, employeeId, { name, type, bytes }) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(bytes)], name, { type }));
  const res = await fetch(
    `${BASE}/api/attachments?parentType=EMPLOYEE_DOCUMENT&parentId=${employeeId}`,
    { method: "POST", headers: { cookie: jar.header() }, body: form },
  );
  let payload = null;
  try { payload = await res.json(); } catch { /* non-JSON */ }
  if (payload?.data?.id) uploaded.push(payload.data.id);
  return { status: res.status, payload };
}

const list = (jar, employeeId) =>
  api(jar, "GET", `/api/attachments?parentType=EMPLOYEE_DOCUMENT&parentId=${employeeId}`);

async function main() {
  console.log(`BASE = ${BASE}\n`);

  const hr = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  ctxs.push(hr);

  const owner = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  ctxs.push(owner);

  const manager = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true });
  ctxs.push(manager);
  await db.employee.update({
    where: { id: owner.employee.id },
    data: { managerId: manager.employee.id },
  });

  const colleague = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  ctxs.push(colleague);

  const pdf = { name: `${TAG}-contract.pdf`, type: "application/pdf", bytes: 2048 };

  // ── Uploading ─────────────────────────────────────────────────────────────
  startSection("HR can attach a document to someone's record");

  const ok = await upload(hr.jar, owner.employee.id, pdf);
  expect(ok.status === 201, "a PDF is accepted", `status ${ok.status} ${JSON.stringify(ok.payload?.error ?? "")}`);
  expect(ok.payload?.data?.mimeType === "application/pdf",
    "and stored with the canonical MIME", `${ok.payload?.data?.mimeType}`);

  const stored = await db.attachment.findUnique({
    where: { id: ok.payload?.data?.id },
    select: { parentType: true, parentId: true, size: true },
  });
  expect(stored?.parentType === "EMPLOYEE_DOCUMENT" && stored?.parentId === owner.employee.id,
    "*** filed against THIS employee and nobody else ***",
    `${stored?.parentType} ${stored?.parentId}`);

  // ── The size limit ────────────────────────────────────────────────────────
  startSection(`The ${MAX_UPLOAD_MB} MB limit`);

  const justUnder = await upload(hr.jar, owner.employee.id, {
    name: `${TAG}-just-under.pdf`, type: "application/pdf", bytes: MAX_UPLOAD_BYTES - 1024,
  });
  expect(justUnder.status === 201,
    `a file just under ${MAX_UPLOAD_MB} MB is accepted`, `status ${justUnder.status}`);

  const tooBig = await upload(hr.jar, owner.employee.id, {
    name: `${TAG}-too-big.pdf`, type: "application/pdf", bytes: MAX_UPLOAD_BYTES + 1024,
  });
  expect(tooBig.status === 413,
    `*** a file over ${MAX_UPLOAD_MB} MB is refused by the SERVER ***`,
    `status ${tooBig.status} — the browser check is a convenience, not the gate`);
  expect(/MB or smaller/i.test(tooBig.payload?.error ?? ""),
    "with a message naming the limit", `${tooBig.payload?.error}`);

  const empty = await upload(hr.jar, owner.employee.id, {
    name: `${TAG}-empty.pdf`, type: "application/pdf", bytes: 0,
  });
  expect(empty.status === 413, "an empty file is refused", `status ${empty.status}`);

  // ── File types ────────────────────────────────────────────────────────────
  startSection("File types");

  for (const [name, type, why] of [
    [`${TAG}-evil.html`, "text/html", "html"],
    [`${TAG}-evil.svg`, "image/svg+xml", "svg"],
    [`${TAG}-evil.exe`, "application/octet-stream", "exe"],
    [`${TAG}-evil.js`, "text/javascript", "js"],
  ]) {
    const r = await upload(hr.jar, owner.employee.id, { name, type, bytes: 512 });
    expect(r.status === 415, `*** .${why} is refused ***`, `status ${r.status}`);
  }

  const liar = await upload(hr.jar, owner.employee.id, {
    name: `${TAG}-liar.pdf`, type: "text/html", bytes: 512,
  });
  expect(liar.status === 415,
    "*** a .pdf claiming to be text/html is refused ***", `status ${liar.status}`);

  for (const [name, type] of [
    [`${TAG}-scan.png`, "image/png"],
    [`${TAG}-offer.docx`, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ]) {
    const r = await upload(hr.jar, owner.employee.id, { name, type, bytes: 1024 });
    expect(r.status === 201, `${name.split(".").pop()} is allowed`, `status ${r.status}`);
  }

  // ── Who can see them ──────────────────────────────────────────────────────
  startSection("Whose documents these are");

  const hrSees = await list(hr.jar, owner.employee.id);
  expect((hrSees.payload?.data ?? []).length > 0, "HR can list them",
    `${(hrSees.payload?.data ?? []).length}`);

  const ownerSees = await list(owner.jar, owner.employee.id);
  expect(ownerSees.status === 200 && (ownerSees.payload?.data ?? []).length > 0,
    "*** the employee can read their OWN documents ***",
    `status ${ownerSees.status}, ${(ownerSees.payload?.data ?? []).length} file(s)`);

  const colleagueSees = await list(colleague.jar, owner.employee.id);
  expect(colleagueSees.status === 404 || colleagueSees.status === 403,
    "*** a colleague holding the employee id gets nothing ***",
    `status ${colleagueSees.status}, ${(colleagueSees.payload?.data ?? []).length} file(s)`);

  const managerSees = await list(manager.jar, owner.employee.id);
  expect(managerSees.status === 404 || managerSees.status === 403,
    "*** NOT EVEN THEIR LINE MANAGER ***",
    `status ${managerSees.status}, ${(managerSees.payload?.data ?? []).length} file(s)`);

  startSection("And cannot be downloaded by id either");
  const id = ok.payload?.data?.id;
  const colleagueGrab = await api(colleague.jar, "GET", `/api/attachments/${id}`);
  expect(colleagueGrab.status === 404 || colleagueGrab.status === 403,
    "*** a colleague with the attachment id cannot download it ***",
    `status ${colleagueGrab.status}`);
  const ownerGrab = await fetch(`${BASE}/api/attachments/${id}`, {
    headers: { cookie: owner.jar.header() }, redirect: "manual",
  });
  expect(ownerGrab.status === 200, "but the owner can", `status ${ownerGrab.status}`);

  startSection("Uploading to somebody else's record");
  const sneak = await upload(colleague.jar, owner.employee.id, pdf);
  expect(sneak.status === 403 || sneak.status === 404,
    "*** a colleague cannot put a file on another person's record ***",
    `status ${sneak.status}`);

  const selfUpload = await upload(owner.jar, owner.employee.id, {
    name: `${TAG}-mine.pdf`, type: "application/pdf", bytes: 1024,
  });
  console.log(`     (the employee uploading to their own record: ${selfUpload.status})`);

  startSection("A record that does not exist");
  const ghost = await upload(hr.jar, "00000000-0000-0000-0000-000000000000", pdf);
  expect(ghost.status === 404, "is a 404, not a 500", `status ${ghost.status}`);

  startSection("Signed out");
  const anon = await fetch(
    `${BASE}/api/attachments?parentType=EMPLOYEE_DOCUMENT&parentId=${owner.employee.id}`,
    { redirect: "manual" },
  );
  expect(anon.status === 307 || anon.status === 401,
    "gets nothing", `status ${anon.status}`);
}

let code = 1;
try { await main(); code = summary(); }
catch (e) {
  console.error("\nFATAL:", e.message, "\n", (e.stack ?? "").split("\n").slice(0, 4).join("\n"));
}
finally {
  startSection("Teardown");
  const ids = [...new Set(uploaded)];
  if (ids.length) {
    const { count } = await db.attachment.deleteMany({ where: { id: { in: ids } } });
    console.log(`     removed ${count} attachment(s)`);
  }
  await db.attachment.deleteMany({ where: { name: { contains: TAG } } }).catch(() => {});
  for (const c of ctxs) await destroyUser(c);
  await db.$disconnect();
}
process.exit(code === 0 ? 0 : 1);
