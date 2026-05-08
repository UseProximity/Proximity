"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";

function Avatar({ name, size = "md" }) {
  const sz = size === "sm" ? "w-7 h-7 text-xs" : "w-9 h-9 text-sm";
  return (
    <div className={`${sz} rounded-full bg-red-100 text-red-600 font-semibold flex items-center justify-center flex-shrink-0`}>
      {name ? name[0].toUpperCase() : "?"}
    </div>
  );
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-3 py-2">
      {[0, 1, 2].map((i) => (
        <span key={i} className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
      ))}
    </div>
  );
}

function ThreadList({ threads, onSelect, onClose }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <h2 className="text-base font-bold text-gray-900">Messages</h2>
        <button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100 text-gray-400 transition">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {threads.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-12 px-6 text-center gap-3">
            <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center">
              <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
              </svg>
            </div>
            <p className="text-sm text-gray-400">No conversations yet.</p>
          </div>
        ) : threads.map((t) => {
          const lastMsg = t.chat_messages?.slice(-1)[0];
          const otherParticipant = t._otherName;
          return (
            <button key={t.id} onClick={() => onSelect(t)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition text-left border-b border-gray-50">
              <Avatar name={otherParticipant} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{otherParticipant || "Conversation"}</p>
                <p className="text-xs text-gray-400 truncate mt-0.5">{lastMsg?.body || "No messages yet"}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ThreadView({ thread, currentUserId, onBack, onClose, onLeaseDraft }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const bottomRef = useRef(null);
  const pollRef = useRef(null);

  const fetchMessages = useCallback(async () => {
    const res = await fetch(`/api/chat/threads/${thread.id}/messages`);
    if (res.ok) setMessages(await res.json());
  }, [thread.id]);

  useEffect(() => {
    fetchMessages();
    // Poll every 4 seconds while thread is open
    pollRef.current = setInterval(fetchMessages, 4000);
    return () => clearInterval(pollRef.current);
  }, [fetchMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setInput("");
    const res = await fetch(`/api/chat/threads/${thread.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: text }),
    });
    if (res.ok) await fetchMessages();
    setSending(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const startLeaseDraft = async () => {
    if (!thread.listing_id) return;
    setDrafting(true);
    const res = await fetch("/api/landlord/executed-leases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listing_id: thread.listing_id, chat_thread_id: thread.id }),
    });
    const data = await res.json();
    setDrafting(false);
    if (res.ok) onLeaseDraft?.(data.id);
  };

  const canDraft = messages.length >= 5 && thread.listing_id;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-3 border-b border-gray-100">
        <button onClick={onBack} className="p-1.5 rounded-full hover:bg-gray-100 text-gray-400 transition flex-shrink-0">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
        <Avatar name={thread._otherName} size="sm" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{thread._otherName || "Conversation"}</p>
          {thread.listing_id && <p className="text-xs text-gray-400 truncate">Listing inquiry</p>}
        </div>
        <button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100 text-gray-400 transition flex-shrink-0">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {messages.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-4">No messages yet — say hello!</p>
        )}
        {messages.map((msg) => {
          const isMe = msg.sender_id === currentUserId;
          return (
            <div key={msg.id} className={`flex items-end gap-2 ${isMe ? "flex-row-reverse" : "flex-row"}`}>
              {!isMe && <Avatar name={thread._otherName} size="sm" />}
              <div className={`max-w-[72%] px-3 py-2 rounded-2xl text-sm leading-snug ${
                isMe ? "bg-red-600 text-white rounded-br-sm" : "bg-gray-100 text-gray-800 rounded-bl-sm"
              }`}>
                {msg.body}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {canDraft && (
        <div className="px-3 pt-2 border-t border-gray-100">
          <button onClick={startLeaseDraft} disabled={drafting}
            className="w-full py-1.5 text-xs font-medium bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 transition disabled:opacity-50">
            {drafting ? "Creating draft…" : "📋 Start lease draft from this chat"}
          </button>
        </div>
      )}

      <div className="px-3 pb-3 pt-2 border-t border-gray-100">
        <div className="flex items-center gap-2 bg-gray-50 rounded-xl border border-gray-200 px-3 py-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message…"
            className="flex-1 bg-transparent text-sm text-gray-800 placeholder-gray-400 outline-none"
          />
          <button onClick={send} disabled={!input.trim() || sending}
            className="w-7 h-7 rounded-full bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white flex items-center justify-center transition flex-shrink-0">
            <svg className="w-3.5 h-3.5 translate-x-px" fill="currentColor" viewBox="0 0 24 24">
              <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ChatWidget() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const [threads, setThreads] = useState([]);
  const [activeThread, setActiveThread] = useState(null);
  const [unread, setUnread] = useState(0);
  const currentUserId = session?.user?.id;

  const fetchThreads = useCallback(async () => {
    if (!session?.user) return;
    const res = await fetch("/api/chat/threads");
    if (res.ok) {
      const data = await res.json();
      // Annotate each thread with the other participant's name
      const annotated = data.map((t) => {
        const others = (t.chat_participants ?? []).filter((p) => p.user_id !== currentUserId);
        return { ...t, _otherName: others[0]?._name || "Other" };
      });
      setThreads(annotated);
    }
  }, [session, currentUserId]);

  // Poll threads when widget is closed; stop when open (ThreadView polls messages)
  useEffect(() => {
    if (!open) {
      fetchThreads();
      const id = setInterval(fetchThreads, 15000);
      return () => clearInterval(id);
    }
  }, [open, fetchThreads]);

  useEffect(() => {
    if (open) fetchThreads();
  }, [open, fetchThreads]);

  const handleLeaseDraft = (leaseId) => {
    window.open(`/dashboard/landlord?view=lease-vault&lease=${leaseId}`, "_blank");
  };

  if (!session?.user) return null;

  return (
    <div className="hidden md:flex fixed bottom-8 right-8 z-50 flex-col items-end gap-3">
      {open && (
        <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-80 h-[480px] overflow-hidden flex flex-col">
          {activeThread ? (
            <ThreadView
              thread={activeThread}
              currentUserId={currentUserId}
              onBack={() => setActiveThread(null)}
              onClose={() => { setOpen(false); setActiveThread(null); }}
              onLeaseDraft={handleLeaseDraft}
            />
          ) : (
            <ThreadList
              threads={threads}
              onSelect={setActiveThread}
              onClose={() => setOpen(false)}
            />
          )}
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-700 text-white shadow-lg hover:shadow-xl transition-all flex items-center justify-center relative"
        aria-label="Open messages"
      >
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-green-500 text-white text-xs flex items-center justify-center font-bold">
            {unread}
          </span>
        )}
        {open ? (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        ) : (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
          </svg>
        )}
      </button>
    </div>
  );
}
