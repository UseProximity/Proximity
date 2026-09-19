/*
 * /chat-link — scanner-safe interstitial for chat magic links.
 * Prefetchers (Outlook Safe Links, etc.) hit this page but must not burn the token;
 * only an explicit button click calls signIn("chat-link"), which consumes it.
 */
import { Suspense } from "react";
import ChatLinkClient from "./ChatLinkClient";

export const metadata = {
  title: "Open conversation | Proximity",
  description: "Open your Proximity conversation from email.",
  robots: { index: false, follow: false },
};

function ChatLinkFallback() {
  return (
    <div className="min-h-[calc(100dvh-83px)] md:min-h-[calc(100dvh-104px)] flex items-center justify-center px-4">
      <p className="text-sm text-gray-400">Loading…</p>
    </div>
  );
}

export default function ChatLinkPage() {
  return (
    <Suspense fallback={<ChatLinkFallback />}>
      <ChatLinkClient />
    </Suspense>
  );
}
