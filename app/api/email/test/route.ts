import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sendWelcomeEmail, sendSecurityAlertEmail } from "@/lib/email";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") ?? "onboarding";

  if (type === "security") {
    await sendSecurityAlertEmail({
      to: "support@deljaip.com",
      alertType: "ROLE_CHANGED",
      targetName: "Jane Smith",
      targetEmail: "jane.smith@illumestudentservices.ca",
      changedBy: "Super Admin",
      details: {
        "Previous Role": "ICR",
        "New Role": "REGIONAL_MANAGER",
      },
      actionUrl: `${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/settings/users`,
    });
    return NextResponse.json({ success: true, type: "security_alert" });
  }

  await sendWelcomeEmail({
    to: "support@deljaip.com",
    name: "Alex Johnson",
    employeeId: "ILL-042",
    jobTitle: "International Client Representative",
    magicLinkUrl: `${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/reset-password/test-token`,
  });

  return NextResponse.json({ success: true, type: "onboarding" });
}
