"use client";
import { createContext, useContext, useState, useCallback } from "react";

const ChatContext = createContext(null);

const ROOMMATE_RESPONSES = [
  "Thanks for reaching out! I'd love to learn more about you.",
  "Hi! Yes, I'm definitely interested. What year are you?",
  "Hey! You seem like a great match. When are you looking to move in?",
  "That sounds great! Tell me about yourself!",
  "I'm definitely open to chatting. What area were you thinking?",
];

const LANDLORD_RESPONSES = [
  "Hello! Thank you for your interest. I'd be happy to answer any questions.",
  "Hi there! What would you like to know about the listing?",
  "Thanks for reaching out! When would you be looking to move in?",
  "Hello! I appreciate your interest. What specific information are you looking for?",
];

export function ChatProvider({ children }) {
  const [conversations, setConversations] = useState([]);
  const [widgetOpen, setWidgetOpen] = useState(false);
  const [activeId, setActiveId] = useState(null);

  const openConversation = useCallback((profile, type = "roommate") => {
    setConversations((prev) => {
      const existing = prev.find(
        (c) => c.profile.name === profile.name && c.type === type
      );
      if (existing) {
        setActiveId(existing.id);
        setWidgetOpen(true);
        return prev;
      }
      const id = `${Date.now()}`;
      const initialMessage = {
        id: 1,
        text:
          type === "landlord"
            ? "Hi! I'm interested in your property listing. Could we discuss the details?"
            : "Hi! I saw your roommate profile and I think we might be a good match. Would you like to chat?",
        direction: "outgoing",
        time: "just now",
      };
      setActiveId(id);
      setWidgetOpen(true);
      return [...prev, { id, profile, type, messages: [initialMessage], typing: false }];
    });
  }, []);

  const sendMessage = useCallback((convId, text) => {
    const userMsg = { id: Date.now(), text, direction: "outgoing", time: "just now" };
    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId ? { ...c, messages: [...c.messages, userMsg], typing: true } : c
      )
    );

    const delay = 1500 + Math.random() * 2000;
    setTimeout(() => {
      setConversations((prev) => {
        const conv = prev.find((c) => c.id === convId);
        if (!conv) return prev;
        const pool = conv.type === "landlord" ? LANDLORD_RESPONSES : ROOMMATE_RESPONSES;
        const reply = {
          id: Date.now(),
          text: pool[Math.floor(Math.random() * pool.length)],
          direction: "incoming",
          time: "just now",
        };
        return prev.map((c) =>
          c.id === convId
            ? { ...c, messages: [...c.messages, reply], typing: false }
            : c
        );
      });
    }, delay);
  }, []);

  return (
    <ChatContext.Provider
      value={{
        conversations,
        widgetOpen,
        setWidgetOpen,
        activeId,
        setActiveId,
        openConversation,
        sendMessage,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChatContext() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChatContext must be used within ChatProvider");
  return ctx;
}
