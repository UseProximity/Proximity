/*
 * Client-side provider tree that wraps the entire application. SessionProvider makes the
 * NextAuth session (pre-fetched by the server layout) available to all client components
 * via useSession without an extra network round-trip; refetchOnWindowFocus is disabled to
 * prevent unnecessary auth pings when the user alt-tabs back. FavoritesProvider sits
 * inside SessionProvider so it can immediately read session.user.id on mount and fetch
 * the user's saved listing IDs. Any additional global client providers should be added
 * here rather than in layout.js.
 */
"use client";
import { SessionProvider } from "next-auth/react";
import { FavoritesProvider } from "@/context/FavoritesContext";

export default function Providers({ children, session }) {
  return (
    <SessionProvider session={session} refetchOnWindowFocus={false}>
      <FavoritesProvider>
        {children}
      </FavoritesProvider>
    </SessionProvider>
  );
}
