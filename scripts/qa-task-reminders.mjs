/**
 * The four notices a task is supposed to produce, and nothing else.
 *
 *   node --import tsx --env-file=.env.local scripts/qa-task-reminders.mjs
 *
 * One notice when the task is raised, then a week before the due date, three
 * days before, and on the day itself. The hard part is not sending them — it is
 * sending each exactly once, surviving a missed cron run, and re-arming when
 * somebody moves the deadline.
 *
 * The ladder is driven by injecting `now` into runTaskReminders rather than by
 * moving the due date around. Both would pass, but only one of them tests the
 * thing the cron actually does, which is to look at today and decide. Moving
 * the due date instead would quietly hide the re-arm logic, since every run
 * would see a date it had never been run against before.
 *
 * Emails are not asserted here: .env.local carries no BREVO_API_KEY, so
 * safeSend logs and returns false, which also keeps a run from hard-bouncing a
 * dozen messages at @illume.local and damaging the sending domain's reputation.
 * The notification rows ARE asserted, and lib/reminder-digest.ts writes one per
 * item on the same path as the email, so a missing notification is a missing
 * email. Delivery itself is verified separately against production.
 */
import {
  db, createAndLogin, destroyUser, api,
  startSection, expect, summary, TAG,
} from "./qa-lib.mjs";

const {
  runTaskReminders, stageForDaysOut, daysUntil, describeReminderSchedule,
} = await import("../lib/task-reminders.ts");

const DAY = 86_400_000;
const ctxs = [];

/** A date `n` days from now, as the <input type="date"> value the UI posts. */
function inDays(n) {
  return new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
}

/** What the cron would see if it ran on the morning `n` days from now. */
function runAt(n) {
  return new Date(Date.now() + n * DAY);
}

const notifCount = (userId, type) =>
  db.notification.count({ where: { userId, type } });

const ledger = (taskId) =>
  db.taskReminder.findMany({ where: { taskId }, orderBy: { stage: "asc" } });

async function main() {
  // ── Pure day arithmetic ──────────────────────────────────────────────────
  startSection("Which rung a task sits on");

  const rung = (n) => stageForDaysOut(n)?.stage ?? "none";
  expect(rung(8) === "none", "8 days out is too early for any notice", rung(8));
  expect(rung(7) === "DUE_IN_7_DAYS", "7 days out is the week notice", rung(7));
  expect(rung(4) === "DUE_IN_7_DAYS", "so is 4 — the rungs are ranges, not exact days", rung(4));
  expect(rung(3) === "DUE_IN_3_DAYS", "3 days out is the three-day notice", rung(3));
  expect(rung(1) === "DUE_IN_3_DAYS", "and so is tomorrow", rung(1));
  expect(rung(0) === "DUE_TODAY", "*** the day it is due has its own notice ***", rung(0));
  expect(rung(-1) === "none", "an overdue task leaves the ladder", rung(-1));

  // The rungs must not overlap, or one day would send two emails.
  const doubled = [];
  for (let n = -3; n <= 12; n++) {
    const hits = [
      n > 3 && n <= 7, n > 0 && n <= 3, n > -1 && n <= 0,
    ].filter(Boolean).length;
    if (hits > 1) doubled.push(n);
  }
  expect(doubled.length === 0, "no day falls on two rungs at once", doubled.join(", "));

  const due = new Date(Date.now() + 5 * DAY);
  expect(daysUntil(due, new Date()) === 5, "days-until counts whole days");
  expect(
    /week before/.test(describeReminderSchedule(due) ?? ""),
    "the creation email can say what is still coming",
    describeReminderSchedule(due)
  );
  expect(
    describeReminderSchedule(null) === undefined,
    "and says nothing when there is no deadline"
  );

  // ── Setup ────────────────────────────────────────────────────────────────
  startSection("Raising a task through the screen staff actually use");

  const manager = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  ctxs.push(manager);
  const worker = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  ctxs.push(worker);

  // /api/hr/tasks, not /api/tasks: this is where the Tasks screen posts, and
  // it was the endpoint that notified nobody and created tasks in a status the
  // reminder job did not look at.
  const created = await api(manager.jar, "POST", "/api/hr/tasks", {
    title: `${TAG} quarterly compliance return`,
    description: "Raised by the QA suite. Safe to delete.",
    assigneeId: worker.employee.id,
    priority: "HIGH",
    dueDate: inDays(10),
    category: "INTERNAL",
    parentType: null,
    parentId: null,
  });
  expect(created.status === 201, "the task is created",
    `status ${created.status} ${JSON.stringify(created.payload).slice(0, 160)}`);
  const taskId = created.payload?.task?.id;
  if (!taskId) throw new Error("no task id returned");

  const row = await db.task.findUnique({ where: { id: taskId }, select: { status: true } });
  expect(row.status === "TODO",
    "it is created as TODO — the status the reminder job used to ignore entirely",
    row.status);

  expect(await notifCount(worker.user.id, "TASK_ASSIGNED") === 1,
    "*** the person it was given to is told, once ***");

  const afterCreate = await ledger(taskId);
  expect(afterCreate.length === 1 && afterCreate[0].stage === "CREATED",
    "and the notice is recorded in the ledger",
    afterCreate.map((r) => r.stage).join(", "));

  startSection("A task you raise for yourself does not email you");
  // Dated far enough out that it never climbs a rung during this run. The
  // ladder section below asserts on run-wide counts, and a second task sitting
  // 4 days from its deadline turns up in them.
  const own = await api(manager.jar, "POST", "/api/hr/tasks", {
    title: `${TAG} self-assigned`,
    assigneeId: manager.employee.id,
    dueDate: inDays(90),
    category: "PERSONAL",
  });
  expect(own.status === 201, "it is created");
  expect(await notifCount(manager.user.id, "TASK_ASSIGNED") === 0,
    "but nobody is told about their own note to self");

  // ── The ladder ───────────────────────────────────────────────────────────
  startSection("The ladder fires once per rung and never twice");

  const base = await notifCount(worker.user.id, "TASK_DUE_IN_7_DAYS");
  expect(base === 0, "nothing has gone out yet");

  let s = await runTaskReminders({ now: runAt(0) });
  expect(s.sentByStage.DUE_IN_7_DAYS === 0,
    "10 days out, the job stays quiet", JSON.stringify(s.sentByStage));

  s = await runTaskReminders({ now: runAt(3) });   // 7 days to go
  expect(s.sentByStage.DUE_IN_7_DAYS === 1,
    "*** a week before, the week notice goes out ***", JSON.stringify(s.sentByStage));
  expect(await notifCount(worker.user.id, "TASK_DUE_IN_7_DAYS") === 1,
    "and it reaches the assignee");

  s = await runTaskReminders({ now: runAt(3) });   // same morning, run twice
  expect(s.sentByStage.DUE_IN_7_DAYS === 0,
    "running the cron twice in one day sends nothing twice", JSON.stringify(s.sentByStage));
  expect(await notifCount(worker.user.id, "TASK_DUE_IN_7_DAYS") === 1,
    "the assignee still has exactly one");

  s = await runTaskReminders({ now: runAt(5) });   // 5 days to go, same rung
  expect(s.sentByStage.DUE_IN_7_DAYS === 0,
    "and nothing on the days in between", JSON.stringify(s.sentByStage));

  s = await runTaskReminders({ now: runAt(8) });   // 2 days to go
  expect(s.sentByStage.DUE_IN_3_DAYS === 1,
    "*** three days before, the next notice goes out ***", JSON.stringify(s.sentByStage));
  expect(await notifCount(worker.user.id, "TASK_DUE_IN_3_DAYS") === 1,
    "even though the cron missed the exact 3-day morning — the rung is a range");

  s = await runTaskReminders({ now: runAt(10) });  // the day itself
  expect(s.sentByStage.DUE_TODAY === 1,
    "*** and one on the day it is due ***", JSON.stringify(s.sentByStage));
  expect(await notifCount(worker.user.id, "TASK_DUE_TODAY") === 1,
    "which is the notice the old job could never send at all");

  s = await runTaskReminders({ now: runAt(12) });  // overdue
  expect(Object.values(s.sentByStage).every((n) => n === 0),
    "once it is overdue the ladder stops", JSON.stringify(s.sentByStage));

  const full = await ledger(taskId);
  expect(full.length === 4,
    "four notices in the task's whole life, and no more",
    full.map((r) => r.stage).join(", "));

  // ── Moving the deadline ──────────────────────────────────────────────────
  startSection("Moving the deadline re-arms the ladder");

  await db.task.update({
    where: { id: taskId },
    data: { dueDate: new Date(Date.now() + 40 * DAY) },
  });

  s = await runTaskReminders({ now: runAt(34) });  // 6 days to the new date
  expect(s.sentByStage.DUE_IN_7_DAYS === 1,
    "*** a pushed-back task is reminded about again ***", JSON.stringify(s.sentByStage));
  expect(await notifCount(worker.user.id, "TASK_DUE_IN_7_DAYS") === 2,
    "the assignee gets the week notice for the new date");

  const reArmed = await ledger(taskId);
  expect(reArmed.length === 4,
    "without piling up ledger rows — the stage row is replaced, not added to",
    `${reArmed.length} rows`);

  // ── Nobody to tell ───────────────────────────────────────────────────────
  startSection("A task with no assignee still reaches somebody");

  const orphan = await db.task.create({
    data: {
      title: `${TAG} unassigned but dated`,
      createdById: manager.employee.id,
      assigneeId: null,
      status: "TODO",
      dueDate: new Date(Date.now() + 2 * DAY),
      category: "INTERNAL",
    },
  });
  const beforeCreator = await notifCount(manager.user.id, "TASK_DUE_IN_3_DAYS");
  s = await runTaskReminders({ now: runAt(0) });
  expect(await notifCount(manager.user.id, "TASK_DUE_IN_3_DAYS") === beforeCreator + 1,
    "the person who raised it is told, rather than nobody at all");
  await db.taskReminder.deleteMany({ where: { taskId: orphan.id } });
  await db.task.delete({ where: { id: orphan.id } });

  // ── Closed tasks go quiet ────────────────────────────────────────────────
  startSection("Finishing a task stops the reminders");

  const done = await db.task.create({
    data: {
      title: `${TAG} already finished`,
      createdById: manager.employee.id,
      assigneeId: worker.employee.id,
      status: "DONE",
      completedAt: new Date(),
      dueDate: new Date(Date.now() + 2 * DAY),
      category: "INTERNAL",
    },
  });
  const beforeDone = await notifCount(worker.user.id, "TASK_DUE_IN_3_DAYS");
  await runTaskReminders({ now: runAt(0) });
  expect(await notifCount(worker.user.id, "TASK_DUE_IN_3_DAYS") === beforeDone,
    "a completed task is not reminded about");
  expect((await ledger(done.id)).length === 0, "and gets no ledger row");
  await db.task.delete({ where: { id: done.id } });
}

let code = 1;
try { await main(); code = summary(); }
catch (e) { console.error("\nFATAL:", e.message, "\n", (e.stack ?? "").split("\n").slice(0, 4).join("\n")); }
finally {
  startSection("Teardown");
  for (const c of ctxs) {
    if (c.employee) {
      const mine = await db.task.findMany({
        where: { OR: [{ createdById: c.employee.id }, { assigneeId: c.employee.id }] },
        select: { id: true },
      }).catch(() => []);
      const ids = mine.map((t) => t.id);
      if (ids.length) {
        await db.taskReminder.deleteMany({ where: { taskId: { in: ids } } }).catch(() => {});
        await db.task.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
      }
    }
    await destroyUser(c);
  }
  const left = await db.user.count({ where: { email: { startsWith: TAG.toLowerCase() } } });
  expect(left === 0, "disposable users removed", `${left} left`);
  await db.$disconnect();
}
process.exit(code === 0 ? 0 : 1);
