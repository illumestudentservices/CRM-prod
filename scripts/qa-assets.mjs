/**
 * The asset register's new endpoints, over real HTTP.
 *
 *   node --import tsx --env-file=.env.local scripts/qa-assets.mjs
 *
 * Concentrated on the things that are new or that changed meaning, rather than
 * re-proving the parts that already worked:
 *
 *  - `update`, which did not exist. An asset could be created, assigned,
 *    returned and deleted but never corrected.
 *  - a partial update must not blank the fields it does not mention. That is the
 *    failure mode of a form that edits one column and erases nine.
 *  - purchase precision must survive a save that does not touch the date, or
 *    "bought June 2024" silently becomes "bought 1 June 2024".
 *  - assign / return / delete now ask the assignment table who holds a device
 *    instead of reading a denormalised `status`, which no longer carries custody.
 *  - the register's status vocabulary is accepted and the old one refused.
 */
import {
  db, api, createAndLogin, destroyUser,
  startSection, expect, ok, summary, TAG,
} from "./qa-lib.mjs";

const ctxs = [];
const madeAssets = [];

async function main() {
  startSection("Fixture");
  const hr = await createAndLogin({ role: "HR_MANAGER", withEmployee: true });
  ctxs.push(hr);
  ok("HR Manager signed in", hr.employee.employeeId);

  const region = await db.region.findFirst({ select: { id: true, name: true } });
  ok("a region to file assets under", region.name);

  // ── Create ────────────────────────────────────────────────────────────────
  startSection("Create carries every register column");
  const created = await api(hr.jar, "POST", "/api/hr/assets", {
    name: `${TAG} EliteBook`,
    type: "LAPTOP",
    status: "IN_USE",
    condition: "GOOD",
    brand: "HP", model: "EliteBook 1040 G10",
    serialNumber: `${TAG}-SN1`,
    assetTag: `${TAG}-TAG1`,
    regionId: region.id,
    country: "Nigeria",
    custodianName: "Ntami Abraham",
    custodianPosition: "ICR",
    accessories: "Charger, Phone case",
    verifiedBy: "Regional Manager",
    verifiedAt: "2026-07-28",
    purchasedAt: "2026-07-01",
    purchasePrecision: "MONTH",
    notes: "Imported from the equipment register.",
  });
  expect(created.status === 201, "created", `${created.status} ${JSON.stringify(created.payload).slice(0, 120)}`);
  const id = created.payload?.asset?.id;
  if (id) madeAssets.push(id);

  const row = await db.iTAsset.findUnique({ where: { id } });
  expect(row?.custodianName === "Ntami Abraham", "*** custodian stored without needing an Employee record ***", String(row?.custodianName));
  expect(row?.regionId === region.id, "region stored as a relation", String(row?.regionId));
  expect(row?.condition === "GOOD", "condition stored", String(row?.condition));
  expect(row?.accessories === "Charger, Phone case", "accessories stored", String(row?.accessories));
  expect(row?.assetTag === `${TAG}-TAG1`, "asset tag stored", String(row?.assetTag));
  expect(row?.verifiedBy === "Regional Manager", "verified by stored", String(row?.verifiedBy));
  expect(row?.purchasePrecision === "MONTH", "*** month-only purchase date is recorded as month-only ***", String(row?.purchasePrecision));
  expect(row?.status === "IN_USE", "status is the register's word", String(row?.status));

  startSection("The old status vocabulary is refused");
  const legacy = await api(hr.jar, "POST", "/api/hr/assets", {
    name: `${TAG} legacy`, type: "LAPTOP", status: "AVAILABLE",
  });
  expect(legacy.status === 422,
    "*** AVAILABLE is no longer a status ***", `${legacy.status}`);
  const badType = await api(hr.jar, "POST", "/api/hr/assets", { name: `${TAG} x`, type: "PHONE" });
  expect(badType.status === 422,
    "an equipment type off the reference list is refused", `${badType.status}`);

  startSection("A duplicate serial is a 409 that names the clash");
  const dup = await api(hr.jar, "POST", "/api/hr/assets", {
    name: `${TAG} dup`, type: "LAPTOP", serialNumber: `${TAG}-SN1`,
  });
  expect(dup.status === 409, "409, not a raw constraint error", `${dup.status}`);
  expect(/Ntami Abraham/.test(dup.payload?.error ?? ""),
    "*** and says which device already has it ***", dup.payload?.error);

  // Two untagged devices must both be creatable: "" has to become NULL or the
  // second one collides with the first on the unique index.
  const blank1 = await api(hr.jar, "POST", "/api/hr/assets", { name: `${TAG} blank1`, type: "LAPTOP", serialNumber: "" });
  const blank2 = await api(hr.jar, "POST", "/api/hr/assets", { name: `${TAG} blank2`, type: "LAPTOP", serialNumber: "" });
  if (blank1.payload?.asset?.id) madeAssets.push(blank1.payload.asset.id);
  if (blank2.payload?.asset?.id) madeAssets.push(blank2.payload.asset.id);
  expect(blank1.status === 201 && blank2.status === 201,
    "*** two devices with no serial can both exist ***", `${blank1.status}/${blank2.status}`);

  // ── Update ────────────────────────────────────────────────────────────────
  startSection("Update — the action that did not exist");
  const upd = await api(hr.jar, "PATCH", `/api/hr/assets/${id}`, {
    action: "update", condition: "FAIR", notes: "Battery holds 2.5 hours.",
  });
  expect(upd.status === 200, "updated", `${upd.status} ${JSON.stringify(upd.payload).slice(0, 120)}`);

  const after = await db.iTAsset.findUnique({ where: { id } });
  expect(after?.condition === "FAIR", "the field sent was changed", String(after?.condition));
  expect(after?.custodianName === "Ntami Abraham",
    "*** a partial update does NOT blank the fields it omits ***", String(after?.custodianName));
  expect(after?.accessories === "Charger, Phone case", "accessories survived", String(after?.accessories));
  expect(after?.assetTag === `${TAG}-TAG1`, "asset tag survived", String(after?.assetTag));
  expect(after?.regionId === region.id, "region survived", String(after?.regionId));

  startSection("Purchase precision survives a save that ignores the date");
  // Exactly what the edit dialog sends when somebody fixes a serial: the date
  // comes back unchanged, carrying the precision it was loaded with.
  const resave = await api(hr.jar, "PATCH", `/api/hr/assets/${id}`, {
    action: "update", serialNumber: `${TAG}-SN1b`,
    purchasedAt: "2026-07-01", purchasePrecision: "MONTH",
  });
  expect(resave.status === 200, "saved", `${resave.status}`);
  const kept = await db.iTAsset.findUnique({ where: { id } });
  expect(kept?.purchasePrecision === "MONTH",
    "*** still month-only, not promoted to a day nobody knows ***", String(kept?.purchasePrecision));

  // And an exact date typed by a human is recorded as exact.
  const exact = await api(hr.jar, "PATCH", `/api/hr/assets/${id}`, {
    action: "update", purchasedAt: "2026-07-14",
  });
  expect(exact.status === 200, "saved an exact date", `${exact.status}`);
  const day = await db.iTAsset.findUnique({ where: { id } });
  expect(day?.purchasePrecision === "DAY",
    "a date with no precision given is treated as exact", String(day?.purchasePrecision));

  startSection("Clearing the date clears the precision with it");
  const cleared = await api(hr.jar, "PATCH", `/api/hr/assets/${id}`, { action: "update", purchasedAt: "" });
  expect(cleared.status === 200, "saved", `${cleared.status}`);
  const none = await db.iTAsset.findUnique({ where: { id } });
  expect(none?.purchasedAt === null && none?.purchasePrecision === null,
    "*** no orphaned precision on a device with no purchase date ***",
    `${none?.purchasedAt} / ${none?.purchasePrecision}`);

  startSection("An empty update is refused rather than silently doing nothing");
  const empty = await api(hr.jar, "PATCH", `/api/hr/assets/${id}`, { action: "update" });
  expect(empty.status === 422, "422", `${empty.status}`);

  // ── Custody ───────────────────────────────────────────────────────────────
  startSection("Custody is the assignment table, not the status column");
  const assigned = await api(hr.jar, "PATCH", `/api/hr/assets/${id}`, {
    action: "assign", employeeId: hr.employee.id,
  });
  expect(assigned.status === 200, "assigned", `${assigned.status} ${JSON.stringify(assigned.payload).slice(0, 120)}`);
  const held = await db.iTAsset.findUnique({
    where: { id }, include: { assignments: { where: { returnedAt: null } } },
  });
  expect(held?.assignments.length === 1, "an assignment row exists", `${held?.assignments.length}`);
  expect(held?.status === "IN_USE", "and the device reads In Use", String(held?.status));
  expect(held?.custodianName !== "Ntami Abraham",
    "*** the custodian name follows the assignment rather than naming the last holder ***",
    String(held?.custodianName));

  const again = await api(hr.jar, "PATCH", `/api/hr/assets/${id}`, {
    action: "assign", employeeId: hr.employee.id,
  });
  expect(again.status === 422, "a second assignment is refused", `${again.status}`);

  const delWhileHeld = await api(hr.jar, "DELETE", `/api/hr/assets/${id}`);
  expect(delWhileHeld.status === 422,
    "*** a device out with someone cannot be deleted ***", `${delWhileHeld.status}`);

  startSection("Returning a device under repair does not call it a spare");
  await api(hr.jar, "PATCH", `/api/hr/assets/${id}`, { action: "return" });
  await api(hr.jar, "PATCH", `/api/hr/assets/${id}`, { action: "update", status: "REPAIR" });
  const repairAssign = await api(hr.jar, "PATCH", `/api/hr/assets/${id}`, {
    action: "assign", employeeId: hr.employee.id,
  });
  expect(repairAssign.status === 200, "assignable even while in repair", `${repairAssign.status}`);
  // Assigning sets IN_USE, so put it back to REPAIR before testing the return.
  await api(hr.jar, "PATCH", `/api/hr/assets/${id}`, { action: "update", status: "REPAIR" });
  await api(hr.jar, "PATCH", `/api/hr/assets/${id}`, { action: "return" });
  const stillBroken = await db.iTAsset.findUnique({ where: { id } });
  expect(stillBroken?.status === "REPAIR",
    "*** the reason it came back is not overwritten by SPARE ***", String(stillBroken?.status));
  expect(stillBroken?.custodianName === null, "and nobody is holding it", String(stillBroken?.custodianName));

  startSection("A returned in-use device becomes a spare");
  await api(hr.jar, "PATCH", `/api/hr/assets/${id}`, { action: "update", status: "IN_USE" });
  await api(hr.jar, "PATCH", `/api/hr/assets/${id}`, { action: "assign", employeeId: hr.employee.id });
  await api(hr.jar, "PATCH", `/api/hr/assets/${id}`, { action: "return" });
  const spare = await db.iTAsset.findUnique({ where: { id } });
  expect(spare?.status === "SPARE", "SPARE", String(spare?.status));

  // ── Reading ───────────────────────────────────────────────────────────────
  startSection("The list serves the filters the screen offers");
  const list = await api(hr.jar, "GET", "/api/hr/assets");
  expect(list.status === 200, "listed", `${list.status}`);
  expect(Array.isArray(list.payload?.regions) && list.payload.regions.length > 0,
    "*** regions travel with the assets so the filter needs no second request ***",
    `${list.payload?.regions?.length}`);
  const byRegion = await api(hr.jar, "GET", `/api/hr/assets?regionId=${region.id}`);
  expect(byRegion.status === 200 && byRegion.payload.assets.every((a) => a.regionId === region.id),
    "filtered by region", `${byRegion.payload?.assets?.length} rows`);
  const byCondition = await api(hr.jar, "GET", "/api/hr/assets?condition=FAIR");
  expect(byCondition.status === 200 && byCondition.payload.assets.every((a) => a.condition === "FAIR"),
    "filtered by condition", `${byCondition.payload?.assets?.length} rows`);

  startSection("Non-HR still cannot read the register");
  const emp = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  ctxs.push(emp);
  const forbidden = await api(emp.jar, "GET", "/api/hr/assets");
  expect(forbidden.status === 403,
    "*** EMPLOYEE holds erp:read for their own leave and must not see the fleet ***",
    `${forbidden.status}`);
  const cantWrite = await api(emp.jar, "PATCH", `/api/hr/assets/${id}`, { action: "update", notes: "nope" });
  expect(cantWrite.status === 403, "and cannot edit one", `${cantWrite.status}`);
}

let code = 1;
try { await main(); code = summary(); }
catch (e) { console.error("\nFATAL:", e.message, "\n", (e.stack ?? "").split("\n").slice(0, 4).join("\n")); }
finally {
  startSection("Teardown");
  for (const id of madeAssets) {
    await db.assetAssignment.deleteMany({ where: { assetId: id } }).catch(() => {});
    await db.iTAsset.delete({ where: { id } }).catch(() => {});
  }
  // Anything the run created under the tag, including rows a failed assertion
  // left behind before madeAssets was appended to.
  const strays = await db.iTAsset.deleteMany({ where: { name: { startsWith: TAG } } });
  for (const c of ctxs) await destroyUser(c);
  const leftAssets = await db.iTAsset.count({ where: { name: { startsWith: TAG } } });
  const leftUsers = await db.user.count({ where: { email: { startsWith: TAG.toLowerCase() } } });
  expect(leftAssets === 0 && leftUsers === 0,
    "fixtures removed", `${leftAssets} assets, ${leftUsers} users (+${strays.count} strays swept)`);
  await db.$disconnect();
}
process.exit(code === 0 ? 0 : 1);
