import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { ToastProvider } from "@/components/providers/toast-provider";
import { IdleTimeoutProvider } from "@/components/providers/idle-timeout";
import { isPasswordExpired } from "@/lib/password";

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

  // Rotation policy. Evaluated from the stamp carried in the JWT rather than a
  // per-request query, and checked here rather than only at sign-in so a
  // session already open when the password expires is caught too.
  if (isPasswordExpired(session.user.passwordChangedAt)) {
    redirect("/change-password?expired=1");
  }

  return (
    <ToastProvider>
      <IdleTimeoutProvider>
        <AppShell>{children}</AppShell>
      </IdleTimeoutProvider>
    </ToastProvider>
  );
}
