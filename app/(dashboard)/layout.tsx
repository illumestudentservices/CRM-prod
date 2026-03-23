import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { ToastProvider } from "@/components/providers/toast-provider";
import { IdleTimeoutProvider } from "@/components/providers/idle-timeout";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  if (session.user.mustChangePassword) {
    redirect("/change-password");
  }

  return (
    <ToastProvider>
      <IdleTimeoutProvider>
        <AppShell>{children}</AppShell>
      </IdleTimeoutProvider>
    </ToastProvider>
  );
}
