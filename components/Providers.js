"use client";
import { SessionProvider } from "next-auth/react";
import { ChatProvider } from "@/components/chat/ChatContext";
import ChatWidget from "@/components/chat/ChatWidget";

export default function Providers({ children, session }) {
  return (
    <SessionProvider session={session}>
      <ChatProvider>
        {children}
        <ChatWidget />
      </ChatProvider>
    </SessionProvider>
  );
}
