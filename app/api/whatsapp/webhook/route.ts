import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validateTwilioWebhook } from "@/lib/whatsapp";

// Twilio sends form-encoded POST to this endpoint
export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_APP_URL + "/api/whatsapp/webhook";
  const signature = req.headers.get("x-twilio-signature") ?? "";

  const formData = await req.formData();
  const params: Record<string, string> = {};
  formData.forEach((value, key) => {
    params[key] = value.toString();
  });

  // Validate the request is genuinely from Twilio
  const isValid = validateTwilioWebhook(signature, url, params);
  if (!isValid) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const from: string = params["From"] ?? ""; // e.g. whatsapp:+601112345678
  const body: string = params["Body"] ?? "";
  const twilioSid: string = params["MessageSid"] ?? "";

  // Normalize phone: strip "whatsapp:" prefix
  const phone = from.replace(/^whatsapp:/, "");

  // Upsert conversation
  const conversation = await db.whatsAppConversation.upsert({
    where: { phone },
    create: {
      phone,
      lastMessage: body,
      lastMessageAt: new Date(),
      unreadCount: 1,
    },
    update: {
      lastMessage: body,
      lastMessageAt: new Date(),
      unreadCount: { increment: 1 },
    },
  });

  // Save inbound message
  await db.whatsAppMessage.create({
    data: {
      conversationId: conversation.id,
      direction: "INBOUND",
      body,
      status: "DELIVERED",
      twilioSid,
    },
  });

  // Return empty TwiML response (no auto-reply)
  return new NextResponse("<Response></Response>", {
    headers: { "Content-Type": "text/xml" },
  });
}
