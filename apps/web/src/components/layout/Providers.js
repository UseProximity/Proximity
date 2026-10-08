/*
 * Client-side provider tree that wraps the entire application. SessionProvider makes the
 * NextAuth session (pre-fetched by the server layout) available to all client components
 * via useSession without an extra network round-trip; refetchOnWindowFocus is disabled to
 * prevent unnecessary auth pings when the user alt-tabs back. FavoritesProvider sits
 * inside SessionProvider so it can immediately read session.user.id on mount and fetch
 * the user's saved listing IDs. MessagesProvider sits inside SessionProvider for the same
 * reason (inbox bootstrap + Realtime). MessagesNavigateBridge registers App Router
 * push for openMessages(). Any additional global client providers should be added here
 * rather than in layout.js.
 */
"use client";

import { useEffect } from "react";
import { SessionProvider } from "next-auth/react";
import { useRouter } from "next/navigation";
import { FavoritesProvider } from "@/context/FavoritesContext";
import { MessagesProvider } from "@/context/MessagesContext";
import { registerMessagesNavigate } from "@/components/chat/chatEvents";

function MessagesNavigateBridge() {
  const router = useRouter();
  useEffect(() => {
    registerMessagesNavigate((href) => router.push(href));
    return () => registerMessagesNavigate(null);
  }, [router]);
  return null;
}

export default function Providers({ children, session }) {
  return (
    <SessionProvider session={session} refetchOnWindowFocus={false}>
      <FavoritesProvider>
        <MessagesProvider>
          <MessagesNavigateBridge />
          {children}
        </MessagesProvider>
      </FavoritesProvider>
    </SessionProvider>
  );
}
