#!/usr/bin/env node
/**
 * End-to-end check of DELETE /api/hr/tasks/[id] over real HTTP.
 *
 * This route was registered against a `hRTask` Prisma model that does not
 * exist, so delegate() threw and the endpoint returned 500 without deleting
 * anything. The registry fix is one line, and the integrity suite proves the
 * delegate now resolves — but the thing that was broken was an HTTP request,
 * so that is what should be seen working.
 *
 * Creates a disposable SUPER_ADMIN with MFA enrolled, exercises the route, and
 * removes the user and its fixtures.
 */

import { createAndLogin, destroyUser, api, db, startSection, expect, summary, sleep, TAG } from "./qa-lib.mjs";

startSection("HR task delete → recycle bin → restore");

const ctx = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
const created = [];

try {
  const task = await db.task.create({
    data: {
      title: `${TAG}-hr-task`,
      description: "fixture for HR task delete check",
      status: "TODO",
      priority: "MEDIUM",
      createdById: ctx.employee?.id ?? undefined,
    },
    select: { id: true, title: true },
  });
  created.push(task.id);

  await sleep(120); // nginx rate limit is 10r/s
  const res = await api(ctx.jar, "DELETE", `/api/hr/tasks/${task.id}`);
  expect(res.status === 200, "DELETE /api/hr/tasks/[id] returns 200", `got ${res.status} ${JSON.stringify(res.payload).slice(0, 140)}`);

  const row = await db.task.findUnique({ where: { id: task.id }, select: { deletedAt: true } });
  expect(row?.deletedAt != null, "task is soft-deleted, not left behind");

  const binned = await db.deletedRecord.findFirst({
    where: { entityId: task.id, purgedAt: null },
    select: { id: true, entityType: true, entityLabel: true, expiresAt: true, deletedAt: true },
  });
  expect(!!binned, "an entry landed in the recycle bin");
  expect(binned?.entityType === "HRTask", "recorded under the HRTask surface", binned?.entityType);
  expect(binned?.entityLabel === task.title, "label shows the task title, not undefined", binned?.entityLabel);
  expect(
    binned && Math.round((binned.expiresAt - binned.deletedAt) / 86400000) === 60,
    "60-day retention applied"
  );

  await sleep(120);
  const restore = await api(ctx.jar, "POST", `/api/recycle-bin/${binned.id}/restore`);
  expect(restore.status === 200, "restore returns 200", `got ${restore.status}`);

  const back = await db.task.findFirst({ where: { id: task.id, deletedAt: null }, select: { id: true } });
  expect(!!back, "task is back in live queries after restore");
} finally {
  for (const id of created) await db.task.delete({ where: { id } }).catch(() => {});
  await db.deletedRecord.deleteMany({ where: { entityId: { in: created } } }).catch(() => {});
  await destroyUser(ctx);
}

summary();
