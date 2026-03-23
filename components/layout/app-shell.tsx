import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { AppShellClient } from "@/components/layout/app-shell-client";
import type { Role } from "@/lib/permissions";
import type { Breadcrumb } from "@/components/layout/topbar";
import { getEffectiveNavKeys } from "@/lib/effective-permissions";

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

  return (
    <AppShellClient
      role={role as Role}
      userName={name ?? "User"}
      userEmail={email ?? ""}
      userImage={image ?? null}
      currentPath={pathname}
      breadcrumbs={breadcrumbs}
      notificationCount={notificationCount}
      allowedNavKeys={allowedNavKeys}
    >
      {children}
    </AppShellClient>
  );
}
