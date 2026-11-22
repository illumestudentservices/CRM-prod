import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { AppShellClient } from "@/components/layout/app-shell-client";
import type { Role } from "@/lib/permissions";
import type { Breadcrumb } from "@/components/layout/topbar";
import { getEffectiveNavKeys } from "@/lib/effective-permissions";
import { db } from "@/lib/db";

interface AppShellProps {
  children: React.ReactNode;
  breadcrumbs?: Breadcrumb[];
  notificationCount?: number;
}

export async function AppShell({
  children,
  breadcrumbs = [],
  notificationCount = 0,
}: AppShellProps) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const headersList = await headers();
  const pathname = headersList.get("x-pathname") ?? "/dashboard";

  const { name, email, image, role } = session.user;
  const allowedNavKeys = await getEffectiveNavKeys(role as Role);

  // The unread badge count is computed here, where the session already is, so
  // it is correct on the first server render — it used to default to 0 (the
  // layout never passed it), which is why the bell looked empty until clicked.
  // An explicit prop still wins; a DB blip falls back to that default.
  const unreadCount = await db.notification
    .count({ where: { userId: session.user.id, isRead: false } })
    .catch(() => notificationCount);

  return (
    <AppShellClient
      role={role as Role}
      userName={name ?? "User"}
      userEmail={email ?? ""}
      userImage={image ?? null}
      currentPath={pathname}
      breadcrumbs={breadcrumbs}
      notificationCount={notificationCount || unreadCount}
      allowedNavKeys={allowedNavKeys}
    >
      {children}
    </AppShellClient>
  );
}
