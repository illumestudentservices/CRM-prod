import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { sendSectionEmail } from "@/lib/email";

const schema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(200),
  sectionTitle: z.string().min(1),
  sectionHtml: z.string().min(1),
  message: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 });
    }

    const senderName = (session.user as { name?: string }).name ?? "An Illume user";

    await sendSectionEmail({
      to: parsed.data.to,
      subject: parsed.data.subject,
      sectionTitle: parsed.data.sectionTitle,
      sectionHtml: parsed.data.sectionHtml,
      message: parsed.data.message,
      senderName,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[email/send-section] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
