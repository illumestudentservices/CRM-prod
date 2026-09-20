import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * "What needs me today", on the personal dashboard.
 *
 * The dashboard used to show what an ICR HAS — lead counts and a pipeline bar —
 * and nothing about what needs them. The nightly automations already compute
 * exactly that, and since the reminder work they email it every morning.
 * Surfacing the same signals here closes the loop: the email says "six things
 * need you", and this is where you find out which six without hunting through
 * the pipeline.
 *
 * Presentational only. The queries live beside the other dashboard data so the
 * page keeps one round of fetching.
 */

export type ActionItem = {
  kind: "deadline" | "stale" | "task";
  title: string;
  detail: string;
  href: string;
  urgent: boolean;
};

export function ActionItemsCard({ items }: { items: ActionItem[] }) {
  const urgent = items.filter((i) => i.urgent).length;
  const shown = items.slice(0, 8);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div className="min-w-0">
          <CardTitle className="text-base">Needs your attention</CardTitle>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {items.length === 0
              ? "Nothing outstanding — you are up to date"
              : `${items.length} item${items.length === 1 ? "" : "s"}` +
                (urgent > 0 ? ` · ${urgent} time-critical` : "")}
          </p>
        </div>
        {urgent > 0 && (
          <span className="shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30">
            {urgent} urgent
          </span>
        )}
      </CardHeader>

      <CardContent className="pt-0">
        {items.length === 0 ? (
          /* An empty state that says what it MEANS. A bare "no data" on this
             card reads as broken; "you are up to date" reads as finished. */
          <div className="py-10 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No approaching deadlines, stalled students or overdue tasks.
            </p>
          </div>
        ) : (
          <div className="-mx-2 divide-y divide-slate-100 dark:divide-slate-800">
            {shown.map((item, idx) => (
              <Link
                key={`${item.kind}-${idx}`}
                href={item.href}
                className="flex items-start gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
              >
                <span
                  className={[
                    "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                    item.urgent ? "bg-amber-500" : "bg-slate-300 dark:bg-slate-600",
                  ].join(" ")}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                    {item.title}
                  </span>
                  <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                    {item.detail}
                  </span>
                </span>
              </Link>
            ))}
            {items.length > shown.length && (
              <p className="px-2 pt-2.5 text-xs text-slate-500 dark:text-slate-400">
                and {items.length - shown.length} more
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export type MyTask = {
  id: string;
  title: string;
  dueDate: Date | null;
  priority: string;
};

/**
 * Open tasks assigned to this person.
 *
 * The personal dashboard had no task card at all, while `/tasks` held work
 * assigned to them and the nightly job emailed about it. Someone could be
 * overdue on three tasks with nothing on their own dashboard saying so.
 */
export function MyTasksCard({ tasks }: { tasks: MyTask[] }) {
  const now = new Date();
  const overdue = tasks.filter((t) => t.dueDate && t.dueDate < now).length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div className="min-w-0">
          <CardTitle className="text-base">My tasks</CardTitle>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {tasks.length === 0
              ? "No open tasks"
              : `${tasks.length} open` + (overdue > 0 ? ` · ${overdue} overdue` : "")}
          </p>
        </div>
        <Link
          href="/tasks"
          className="shrink-0 text-xs font-medium text-[#1E3A5F] hover:underline dark:text-sky-400"
        >
          View all
        </Link>
      </CardHeader>

      <CardContent className="pt-0">
        {tasks.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Nothing is assigned to you right now.
            </p>
          </div>
        ) : (
          <div className="-mx-2 divide-y divide-slate-100 dark:divide-slate-800">
            {tasks.slice(0, 6).map((t) => {
              const isOverdue = !!t.dueDate && t.dueDate < now;
              return (
                <Link
                  key={t.id}
                  href={`/tasks?taskId=${t.id}`}
                  className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                      {t.title}
                    </span>
                    <span
                      className={[
                        "block truncate text-xs",
                        isOverdue
                          ? "font-medium text-amber-700 dark:text-amber-400"
                          : "text-slate-500 dark:text-slate-400",
                      ].join(" ")}
                    >
                      {t.dueDate
                        ? isOverdue
                          ? `Overdue — was due ${t.dueDate.toISOString().slice(0, 10)}`
                          : `Due ${t.dueDate.toISOString().slice(0, 10)}`
                        : "No due date"}
                    </span>
                  </span>
                  {(t.priority === "HIGH" || t.priority === "URGENT") && (
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {t.priority}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
