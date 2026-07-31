import * as React from "react";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { WhatsAppInbox } from "./_components/whatsapp-inbox";

async function getConversations() {
  return db.whatsAppConversation.findMany({
    orderBy: { lastMessageAt: "desc" },
    include: {
      lead: { select: { id: true, firstName: true, lastName: true, phone: true } },
    },
  });
}

export default async function WhatsAppPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const conversations = await getConversations();

  return <WhatsAppInbox initialConversations={conversations} currentUserId={session.user.id} />;
}
