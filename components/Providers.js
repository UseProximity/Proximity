"use client";
import { SessionProvider } from "next-auth/react";
import { FavoritesProvider } from "@/components/FavoritesContext";

export default function Providers({ children, session }) {
  return (
    <SessionProvider session={session} refetchOnWindowFocus={false}>
      <FavoritesProvider>
        {children}
      </FavoritesProvider>
    </SessionProvider>
  );
}
