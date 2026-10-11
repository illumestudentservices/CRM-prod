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

  const hrFileId = ok.payload?.data?.id;

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

  /**
   * ★ THE RULE, AND IT IS NOT SYMMETRIC.
   *
   * There is no HR at Illume; the line manager is it. So:
   *
   *   the employee   sees everything on their record — theirs and their
   *                  manager's
   *   the manager    sees ONLY what they uploaded themselves
   *   a colleague    sees nothing
   *
   * The manager half is the privacy-critical one. A manager who can file a
   * contract must not be able to read the doctor's note filed beside it.
   */
  const byManager = await upload(manager.jar, owner.employee.id, {
    name: `${TAG}-contract-from-manager.pdf`, type: "application/pdf", bytes: 1024,
  });
  expect(byManager.status === 201,
    "*** a manager can file a document for their own report ***",
    `status ${byManager.status} ${JSON.stringify(byManager.payload?.error ?? "")}`);
  const managerFileId = byManager.payload?.data?.id;

  const byEmployee = await upload(owner.jar, owner.employee.id, {
    name: `${TAG}-private-note.pdf`, type: "application/pdf", bytes: 1024,
  });
  expect(byEmployee.status === 201,
    "*** the employee can upload to their own record ***",
    `status ${byEmployee.status} ${JSON.stringify(byEmployee.payload?.error ?? "")}`);
  const employeeFileId = byEmployee.payload?.data?.id;

  const ownerList = await list(owner.jar, owner.employee.id);
  const ownerIds = (ownerList.payload?.data ?? []).map((a) => a.id);
  expect(ownerIds.includes(employeeFileId),
    "*** the employee sees their own upload ***", "their own file is missing");
  expect(ownerIds.includes(managerFileId),
    "*** and the one their manager filed for them ***", "the manager's file is missing");

  const mgrList = await list(manager.jar, owner.employee.id);
  const mgrIds = (mgrList.payload?.data ?? []).map((a) => a.id);
  expect(mgrList.status === 200, "the manager can open the record", `status ${mgrList.status}`);
  expect(mgrIds.includes(managerFileId),
    "*** the manager sees the document THEY filed ***", "their own upload is missing");
  expect(!mgrIds.includes(employeeFileId),
    "*** the manager does NOT see the employee's own upload ***",
    "THE EMPLOYEE'S PRIVATE FILE LEAKED TO THEIR MANAGER");
  expect(!mgrIds.includes(hrFileId),
    "nor a file somebody else filed", "another uploader's file leaked to the manager");

  const colleagueSees = await list(colleague.jar, owner.employee.id);
  expect(colleagueSees.status === 404 || colleagueSees.status === 403
    || (colleagueSees.payload?.data ?? []).length === 0,
    "*** a colleague holding the employee id gets nothing ***",
    `status ${colleagueSees.status}, ${(colleagueSees.payload?.data ?? []).length} file(s)`);

  startSection("And the id is not a way round it");

  const mgrGrab = await fetch(`${BASE}/api/attachments/${employeeFileId}`, {
    headers: { cookie: manager.jar.header() }, redirect: "manual",
  });
  expect(mgrGrab.status === 404 || mgrGrab.status === 403,
    "*** the manager cannot DOWNLOAD the employee's file by id ***",
    `status ${mgrGrab.status} — listing hid it and the download did not`);

  const mgrOwnGrab = await fetch(`${BASE}/api/attachments/${managerFileId}`, {
    headers: { cookie: manager.jar.header() }, redirect: "manual",
  });
  expect(mgrOwnGrab.status === 200, "but can download their own", `status ${mgrOwnGrab.status}`);

  const ownerGrabsMgr = await fetch(`${BASE}/api/attachments/${managerFileId}`, {
    headers: { cookie: owner.jar.header() }, redirect: "manual",
  });
  expect(ownerGrabsMgr.status === 200,
    "*** and the employee can download what their manager filed ***",
    `status ${ownerGrabsMgr.status}`);

  startSection("Deleting");

  const mgrDeletesTheirs = await api(manager.jar, "DELETE", `/api/attachments/${employeeFileId}`);
  expect(mgrDeletesTheirs.status === 403 || mgrDeletesTheirs.status === 404,
    "*** the manager cannot delete the employee's private file ***",
    `status ${mgrDeletesTheirs.status}`);
  const stillThere = await db.attachment.findFirst({
    where: { id: employeeFileId, deletedAt: null }, select: { id: true },
  });
  expect(!!stillThere, "and it is still there", "it was deleted");

  const ownerDeletesOwn = await api(owner.jar, "DELETE", `/api/attachments/${employeeFileId}`);
  expect(ownerDeletesOwn.status === 200,
    "the employee can delete their own", `status ${ownerDeletesOwn.status}`);

  startSection("A manager of somebody else");
  const otherManager = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true });
  ctxs.push(otherManager);
  const otherList = await list(otherManager.jar, owner.employee.id);
  expect(otherList.status === 404 || otherList.status === 403
    || (otherList.payload?.data ?? []).length === 0,
    "*** a manager who is NOT their manager sees nothing ***",
    `status ${otherList.status}, ${(otherList.payload?.data ?? []).length} file(s)`);
  const otherUpload = await upload(otherManager.jar, owner.employee.id, {
    name: `${TAG}-not-mine.pdf`, type: "application/pdf", bytes: 512,
  });
  expect(otherUpload.status === 403 || otherUpload.status === 404,
    "and cannot file anything there either", `status ${otherUpload.status}`);

  startSection("What the manager's PAGE actually contains");

  /**
   * ★ HIDING A TAB IS NOT WITHHOLDING THE DATA.
   *
   * The first version of the documents-only view hid the Profile tab and
   * still passed the address and next-of-kin number as props. They were
   * invisible on screen and sitting in View Source — and a browser test that
   * read innerText said it was fine, because innerText only shows what was
   * rendered. This reads the raw HTML instead.
   *
   * The personal phone survived even that first fix, because it renders in
   * the page header rather than inside the tabs.
   */
  await db.employee.update({
    where: { id: owner.employee.id },
    data: {
      address: `${TAG} 17 Privacy Lane`,
      emergencyContact: `${TAG} Next Of Kin`,
      emergencyPhone: "+1 555 0200",
      phone: "+1 555 0111",
    },
  });

  const pageAs = async (jar) => {
    const res = await fetch(`${BASE}/hr/employees/${owner.employee.id}`, {
      headers: { cookie: jar.header() }, redirect: "manual",
    });
    return { status: res.status, body: res.status === 200 ? await res.text() : "" };
  };

  const mgrPage = await pageAs(manager.jar);
  expect(mgrPage.status === 200, "a manager can open their report's record",
    `status ${mgrPage.status}`);
  for (const [label, needle] of [
    ["home address", "Privacy Lane"],
    ["next-of-kin name", "Next Of Kin"],
    ["next-of-kin number", "555 0200"],
    ["personal phone", "555 0111"],
  ]) {
    expect(!mgrPage.body.includes(needle),
      `*** the ${label} is NOT in the HTML sent to the manager ***`,
      "it is in the page source");
  }
  expect(/Attachments|Add file/.test(mgrPage.body),
    "but the attachments panel is", "the panel is missing");

  const ownPage = await pageAs(owner.jar);
  expect(ownPage.body.includes("Privacy Lane"),
    "the employee still sees their own address", "withheld from the person themselves");

  const strangerPage = await pageAs(colleague.jar);
  expect(strangerPage.status === 307 || strangerPage.status === 302,
    "*** an unrelated employee is redirected away from the record ***",
    `status ${strangerPage.status}`);
  expect(strangerPage.body === "", "and gets no page body", "a body was returned");

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
