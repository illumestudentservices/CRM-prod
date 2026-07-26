import twilio from "twilio";

const accountSid = process.env.TWILIO_ACCOUNT_SID!;
const authToken = process.env.TWILIO_AUTH_TOKEN!;
const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER!; // whatsapp:+14155238886

let client: ReturnType<typeof twilio> | null = null;

function getClient() {
  if (!client) {
    client = twilio(accountSid, authToken);
  }
  return client;
}

export async function sendWhatsAppMessage(to: string, body: string) {
  const toFormatted = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
  const message = await getClient().messages.create({
    from: fromNumber,
    to: toFormatted,
    body,
  });
  return message;
}

export function validateTwilioWebhook(
  signature: string,
  url: string,
  params: Record<string, string>
) {
  return twilio.validateRequest(authToken, signature, url, params);
}
