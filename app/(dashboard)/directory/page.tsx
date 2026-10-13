import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { DirectoryClient } from "./_components/directory-client";

export const metadata = { title: "Staff Directory | Illume" };

/**
 * The staff directory.
 *
 * proxy.ts already gates /directory through NAV_PERMISSIONS, and the API
 * refuses a client on its own. The check here is the third and it is not
 * redundant: proxy gating is by path prefix, so a future route moved under
 * this one would inherit whatever this page does, and "correct because the
 * proxy remembered" is the assumption that has bitten this codebase before.
 */
export default async function DirectoryPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role === "INSTITUTION_CLIENT") redirect("/dashboard");

  return <DirectoryClient />;
}
