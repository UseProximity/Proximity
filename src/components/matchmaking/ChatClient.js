"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import ChatWindow from "./ChatWindow";
import PreferencePanel from "./PreferencePanel";
import RecommendationCards from "./RecommendationCards";

const LS_KEY = "prx_chat_v1";

function saveToStorage(data) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch {}
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function ChatClient() {
  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [preferences, setPreferences] = useState({});
  const [weights, setWeights] = useState({});
  const [candidates, setCandidates] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [status, setStatus] = useState("in_progress");
  const [loading, setLoading] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const hadCache = useRef(false);

  // Persist chat state to localStorage on every meaningful change
  useEffect(() => {
    if (messages.length > 0 && sessionId) {
      saveToStorage({ messages, sessionId, preferences, weights, recommendations, status });
    }
  }, [messages, sessionId, preferences, weights, recommendations, status]);

  const applyServerState = useCallback((data) => {
    if (data.sessionId) setSessionId(data.sessionId);
    if (data.preferences) setPreferences(data.preferences);
    if (data.weights) setWeights(data.weights);
    if (data.candidates) setCandidates(data.candidates);
    if (data.recommendations) setRecommendations(data.recommendations);
    if (data.status) setStatus(data.status);
  }, []);

  const sendMessage = useCallback(
    async (text, sid) => {
      const currentSid = sid ?? sessionId;
      setLoading(true);
      try {
        const res = await fetch("/api/matchmaking/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: currentSid, message: text }),
        });
        const data = await res.json();
        if (res.ok) {
          applyServerState(data);
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: data.assistantMessage, ts: new Date().toISOString() },
          ]);
        }
      } catch (err) {
        console.error("[ChatClient] sendMessage failed:", err);
      } finally {
        setLoading(false);
      }
    },
    [sessionId, applyServerState]
  );

  useEffect(() => {
    async function init() {
      // 1. Restore from localStorage immediately — no loading flash
      const cached = loadFromStorage();
      if (cached?.messages?.length) {
        setMessages(cached.messages);
        if (cached.sessionId) setSessionId(cached.sessionId);
        if (cached.preferences) setPreferences(cached.preferences);
        if (cached.weights) setWeights(cached.weights);
        if (cached.recommendations) setRecommendations(cached.recommendations);
        if (cached.status) setStatus(cached.status);
        hadCache.current = true;
      } else {
        // No cache — show typing dots while we wait for first greeting
        setLoading(true);
      }

      // 2. Sync with server (authoritative source)
      try {
        const res = await fetch("/api/matchmaking/chat");
        const { session } = await res.json();

        if (session) {
          const serverMessages = (session.transcript ?? []).map((m) => ({
            role: m.role,
            content: m.content,
            ts: m.ts,
          }));
          setSessionId(session.id);
          setPreferences(session.preferences ?? {});
          setWeights(session.weights ?? {});
          setCandidates(session.candidates ?? []);
          setRecommendations(session.recommendations ?? []);
          setStatus(session.status);
          // Replace with server transcript if it has content
          if (serverMessages.length > 0) {
            setMessages(serverMessages);
          } else if (!hadCache.current) {
            // Session exists but empty transcript — shouldn't happen, treat as fresh
            await startFresh();
            return;
          }
          setLoading(false);
        } else if (!hadCache.current) {
          // No session anywhere — create one and get first greeting
          await startFresh();
        } else {
          // Had local cache but server session is gone — clear and restart
          localStorage.removeItem(LS_KEY);
          await startFresh();
        }
      } catch (err) {
        console.error("[ChatClient] serverSync failed:", err);
        setLoading(false);
      }
    }

    async function startFresh() {
      setLoading(true);
      try {
        const res = await fetch("/api/matchmaking/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: "" }),
        });
        const data = await res.json();
        if (res.ok) {
          applyServerState(data);
          setMessages([
            { role: "assistant", content: data.assistantMessage, ts: new Date().toISOString() },
          ]);
        }
      } catch (err) {
        console.error("[ChatClient] startFresh failed:", err);
      } finally {
        setLoading(false);
      }
    }

    init();
  }, [applyServerState]);

  const handleUserSend = useCallback(
    (text) => {
      setMessages((prev) => [
        ...prev,
        { role: "user", content: text, ts: new Date().toISOString() },
      ]);
      sendMessage(text);
    },
    [sendMessage]
  );

  const handlePanelUpdate = useCallback(
    (data) => {
      applyServerState(data);
    },
    [applyServerState]
  );

  const isDone = status === "recommendations_ready";

  return (
    // 70vh keeps both the top of the chat and the composer visible without dominating the page
    <div className="h-[70vh] bg-gray-50 flex flex-col overflow-hidden">

      {/* Mobile: thin bar to open the answers drawer */}
      <div className="md:hidden flex-shrink-0 flex items-center justify-between px-4 py-2.5 bg-white border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-900">Chat with Proxy</span>
        <button
          onClick={() => setPanelOpen((v) => !v)}
          className="text-xs text-red-600 font-medium underline"
        >
          {panelOpen ? "Hide answers" : "View your answers"}
        </button>
      </div>

      {/* Mobile bottom sheet */}
      {panelOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/30"
          onClick={() => setPanelOpen(false)}
        >
          <div
            className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl h-[60vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-end px-4 pt-3 pb-1">
              <button
                onClick={() => setPanelOpen(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <PreferencePanel
              preferences={preferences}
              weights={weights}
              sessionId={sessionId}
              onUpdated={handlePanelUpdate}
            />
          </div>
        </div>
      )}

      {/* Main row — fills remaining height; min-h-0 prevents flex blowout */}
      <div className="flex-1 min-h-0 flex max-w-5xl w-full mx-auto px-4 py-4 gap-4">

        {/* Chat column */}
        <div className="flex-1 min-h-0 flex flex-col bg-white rounded-2xl border border-gray-200 overflow-hidden">
          {isDone ? (
            <div className="flex-1 min-h-0 overflow-y-auto p-6">
              <RecommendationCards recommendations={recommendations} />
            </div>
          ) : (
            <ChatWindow messages={messages} loading={loading} onSend={handleUserSend} />
          )}
        </div>

        {/* Side panel — desktop only */}
        <div className="hidden md:flex flex-col w-72 min-h-0 bg-white rounded-2xl border border-gray-200 overflow-hidden">
          {isDone && candidates.length > 0 ? (
            <div className="flex-1 min-h-0 overflow-y-auto p-4">
              <p className="text-xs font-medium text-gray-500 mb-3">All candidates</p>
              {candidates.slice(0, 5).map((c) => (
                <div key={c.listing_id} className="py-2 border-b border-gray-50 last:border-0">
                  <p className="text-xs font-medium text-gray-800 truncate">{c.card_data?.title}</p>
                  <p className="text-xs text-gray-400 truncate">{c.card_data?.address}</p>
                </div>
              ))}
            </div>
          ) : (
            <PreferencePanel
              preferences={preferences}
              weights={weights}
              sessionId={sessionId}
              onUpdated={handlePanelUpdate}
            />
          )}
        </div>
      </div>
    </div>
  );
}
