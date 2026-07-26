import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { z } from "zod";
import { effectiveHasPermission } from "@/lib/effective-permissions";

const sendSchema = z.object({
  phone: z.string().min(7),
  body: z.string().min(1).max(4096),
  leadId: z.string().optional(),
  displayName: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await effectiveHasPermission(session.user.role, "whatsapp", "write"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const json = await req.json();
  const parsed = sendSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { phone, body, leadId, displayName } = parsed.data;

  // Upsert conversation
  const conversation = await db.whatsAppConversation.upsert({
    where: { phone },
    create: {
      phone,
      displayName,
      leadId,
      lastMessage: body,
      lastMessageAt: new Date(),
    },
    update: {
      lastMessage: body,
      lastMessageAt: new Date(),
      ...(displayName && { displayName }),
      ...(leadId && { leadId }),
    },
  });

  // Send via Twilio
  let twilioSid: string | undefined;
  let status: "SENT" | "FAILED" = "SENT";
  try {
    const msg = await sendWhatsAppMessage(phone, body);
    twilioSid = msg.sid;
  } catch {
    status = "FAILED";
  }

  // Save message record
  const message = await db.whatsAppMessage.create({
    data: {
      conversationId: conversation.id,
      direction: "OUTBOUND",
      body,
      status,
      twilioSid,
      sentById: session.user.id,
    },
  });

  return NextResponse.json({ message, conversation });
}
