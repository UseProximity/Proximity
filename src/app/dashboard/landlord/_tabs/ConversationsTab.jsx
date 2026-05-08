"use client";

import { useState, useEffect } from "react";

const STATE_COLORS = {
  inquired:             "bg-blue-100 text-blue-700",
  tour_requested:       "bg-purple-100 text-purple-700",
  tour_completed:       "bg-indigo-100 text-indigo-700",
  application_pending:  "bg-yellow-100 text-yellow-700",
  lease_pending:        "bg-orange-100 text-orange-700",
  leased:               "bg-green-100 text-green-700",
  declined:             "bg-gray-100 text-gray-500",
  stale:                "bg-gray-100 text-gray-400",
};

const STATE_LABELS = {
  inquired:             "Inquired",
  tour_requested:       "Tour requested",
  tour_completed:       "Tour done",
  application_pending:  "Application",
  lease_pending:        "Lease pending",
  leased:               "Leased ✓",
  declined:             "Declined",
  stale:                "Stale",
};

function timeAgo(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function ConversationsTab({ user }) {
  const [conversations, setConversations] = useState([]);
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stateFilter, setStateFilter] = useState("active");
  const [selectedThread, setSelectedThread] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState("");
  const [sending, setSending] = useState(false);

  const listings = user?.listings || [];

  useEffect(() => {
    Promise.all([
      fetch("/api/chat/threads").then((r) => r.ok ? r.json() : []).catch(() => []),
      ...listings.map((l) =>
        fetch(`/api/listings/${l._id || l.id}/conflicts`)
          .then((r) => r.ok ? r.json() : [])
          .catch(() => [])
          .then((data) => (Array.isArray(data) ? data.map((c) => ({ ...c, _listingTitle: l.title || l.address })) : []))
      ),
    ]).then(([threadData, ...convArrays]) => {
      setThreads(Array.isArray(threadData) ? threadData : []);
      setConversations(convArrays.flat());
      setLoading(false);
    });
  }, [listings.length]);

  const fetchMessages = async (threadId) => {
    const res = await fetch(`/api/chat/threads/${threadId}/messages`);
    if (res.ok) setMessages(await res.json());
  };

  const openThread = async (thread) => {
    setSelectedThread(thread);
    await fetchMessages(thread.id);
  };

  const sendMessage = async () => {
    if (!messageInput.trim() || !selectedThread || sending) return;
    setSending(true);
    await fetch(`/api/chat/threads/${selectedThread.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: messageInput.trim() }),
    });
    setMessageInput("");
    await fetchMessages(selectedThread.id);
    setSending(false);
  };

  const activeConversations = conversations.filter((c) =>
    stateFilter === "active"
      ? !["leased", "declined", "stale"].includes(c.state)
      : stateFilter === "closed"
      ? ["leased", "declined", "stale"].includes(c.state)
      : true
  );

  if (loading) return <div className="text-sm text-gray-400 py-8 text-center">Loading conversations…</div>;

  return (
    <div className="max-w-5xl">
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Left column — conversations + threads */}
        <div className="lg:col-span-2 space-y-6">

          {/* Active conversations */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-base font-semibold text-gray-900">Conversations</h2>
              <div className="flex gap-1 ml-auto">
                {["active", "all", "closed"].map((f) => (
                  <button key={f} onClick={() => setStateFilter(f)}
                    className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${stateFilter === f ? "bg-red-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                    {f}
                  </button>
                ))}
              </div>
            </div>
            {activeConversations.length === 0 ? (
              <p className="text-sm text-gray-400">No {stateFilter !== "all" ? stateFilter : ""} conversations.</p>
            ) : (
              <div className="space-y-2">
                {activeConversations.map((c) => (
                  <div key={c.id} className="flex items-center justify-between px-4 py-3 bg-white rounded-lg border border-gray-200">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{c._listingTitle || "Listing"}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{timeAgo(c.last_activity_at)}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ml-2 ${STATE_COLORS[c.state] || "bg-gray-100 text-gray-500"}`}>
                      {STATE_LABELS[c.state] || c.state}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Chat threads */}
          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-3">Chat threads</h2>
            {threads.length === 0 ? (
              <p className="text-sm text-gray-400">No chat threads yet.</p>
            ) : (
              <div className="space-y-2">
                {threads.map((t) => {
                  const lastMsg = t.chat_messages?.slice(-1)[0];
                  const isSelected = selectedThread?.id === t.id;
                  return (
                    <button key={t.id} onClick={() => openThread(t)}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg border text-left transition
                        ${isSelected ? "border-red-300 bg-red-50" : "border-gray-200 bg-white hover:bg-gray-50"}`}>
                      <div className="w-8 h-8 rounded-full bg-red-100 text-red-600 text-xs font-semibold flex items-center justify-center shrink-0">
                        💬
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{t.subject || "Listing inquiry"}</p>
                        <p className="text-xs text-gray-400 truncate">{lastMsg?.body || "No messages yet"}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* Right column — message view */}
        <div className="lg:col-span-3">
          {selectedThread ? (
            <div className="bg-white rounded-lg border border-gray-200 flex flex-col" style={{ height: "520px" }}>
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-900">{selectedThread.subject || "Chat"}</p>
                <button onClick={() => { setSelectedThread(null); setMessages([]); }}
                  className="text-xs text-gray-400 hover:text-gray-600">Close</button>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
                {messages.length === 0 && (
                  <p className="text-xs text-gray-400 text-center py-6">No messages yet.</p>
                )}
                {messages.map((m) => (
                  <div key={m.id} className="text-sm bg-gray-50 rounded-lg px-3 py-2">
                    <p className="text-xs text-gray-400 mb-1">{new Date(m.created_at).toLocaleTimeString()}</p>
                    <p className="text-gray-800">{m.body}</p>
                  </div>
                ))}
              </div>
              <div className="px-3 pb-3 pt-2 border-t border-gray-100 flex gap-2">
                <input
                  type="text"
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                  placeholder="Reply…"
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                />
                <button onClick={sendMessage} disabled={!messageInput.trim() || sending}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition">
                  Send
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-gray-50 rounded-lg border border-dashed border-gray-300 flex items-center justify-center h-64 text-sm text-gray-400">
              Select a chat thread to view messages
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
