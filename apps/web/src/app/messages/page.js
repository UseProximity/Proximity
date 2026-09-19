/*
 * /messages — authenticated inbox. Server gate redirects to login; client
 * panel lives in MessagesPageClient (handles ?thread= deep links).
 */
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import MessagesPageClient from "./MessagesPageClient";

export const metadata = {
  title: "Messages | Proximity",
  description: "Your listing conversations on Proximity.",
  robots: { index: false, follow: false },
};

function MessagesFallback() {
  return (
    <div className="h-[calc(100dvh-83px)] md:h-[calc(100dvh-104px)] flex items-center justify-center text-sm text-gray-400">
      Loading messages…
    </div>
  );
}

export default async function MessagesPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/messages");
  }

  return (
    <Suspense fallback={<MessagesFallback />}>
      <MessagesPageClient />
    </Suspense>
  );
}
