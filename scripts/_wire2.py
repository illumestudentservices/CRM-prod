import io
import re

p = "app/(dashboard)/dashboard/page.tsx"
s = io.open(p, encoding="utf-8").read()

# ── ERPDashboard ("My Workspace") also gets the task list ───────────────────
# It shows an "Open Tasks" COUNT and no list, so someone can be overdue on
# three tasks with nothing on their own dashboard naming them.
start = s.index("async function ERPDashboard(")
body = s[start:]

old_fetch = re.search(
    r"(async function ERPDashboard\([^)]*\) \{\n)(\s+const \[[^\]]*\] = await Promise\.all\(\[\n)",
    body,
)
assert old_fetch, "ERPDashboard fetch not found"

# Insert an actions fetch right after the function opens.
insert_at = start + old_fetch.end(1)
s = (
    s[:insert_at]
    + "  // Same signals as the ICR view and the morning email digest, so a\n"
    + "  // non-ICR colleague sees their overdue work too.\n"
    + "  const actions = await getDashboardActions(userId);\n"
    + s[insert_at:]
)

# Put the task card just before the pending-leaves alert in that view.
marker = "      {/* Pending leaves alert */}"
assert marker in s
s = s.replace(
    marker,
    "      {/* The workspace showed an Open Tasks COUNT and no list — someone\n"
    "          could be overdue on three tasks with nothing naming them. */}\n"
    "      <div className=\"grid grid-cols-1 xl:grid-cols-2 gap-6\">\n"
    "        <ActionItemsCard items={actions.items} />\n"
    "        <MyTasksCard tasks={actions.tasks} />\n"
    "      </div>\n\n" + marker,
    1,
)

io.open(p, "w", encoding="utf-8").write(s)
print("ERPDashboard wired")
