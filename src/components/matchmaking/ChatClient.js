"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import ChatWindow from "./ChatWindow";
import PreferencePanel from "./PreferencePanel";
import { applyAnswer, nextQuestion, answerToLabel, describeQuestion, rewindTo } from "@/lib/matchmaking/questionEngine";
import { QUESTION_BY_ID } from "@/lib/matchmaking/questionScript";

const LS_KEY = "prx_chat_v2";

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

// Build an assistant chat message that carries a question descriptor (renders
// chips). `animate` triggers the typing effect for freshly-sent questions.
function questionToMessage(q, animate = false) {
  return { role: "assistant", content: q.prompt, ts: new Date().toISOString(), question: q, animate };
}

export default function ChatClient() {
  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [preferences, setPreferences] = useState({});
  const [weights, setWeights] = useState({});
  const [, setCandidates] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [status, setStatus] = useState("in_progress");
  const [loading, setLoading] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const hadCache = useRef(false);

  // Refs mirror the latest prefs/weights so rapid chip taps build on current
  // state even before React re-renders. postChain serializes POSTs so the
  // server never sees out-of-order, stale writes (which caused re-asked questions).
  const prefsRef = useRef({});
  const weightsRef = useRef({});
  const postChain = useRef(Promise.resolve());
  useEffect(() => {
    prefsRef.current = preferences;
  }, [preferences]);
  useEffect(() => {
    weightsRef.current = weights;
  }, [weights]);

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

  // Apply ONLY ranking/status from a server response — never prefs/weights/
  // messages, which the client owns optimistically during the question flow.
  const applyRanking = useCallback((data) => {
    if (data.candidates) setCandidates(data.candidates);
    if (data.recommendations) setRecommendations(data.recommendations);
    if (data.status) setStatus(data.status);
  }, []);

  const inlineRecsMessage = (data) => ({
    role: "assistant",
    content: data.assistantMessage || "Here are your top matches:",
    ts: new Date().toISOString(),
    recommendations: data.recommendations,
  });

  // Chip answer — render the next question instantly (optimistic); the POST just
  // persists + ranks in the background. Client is authoritative for the flow.
  const handleAnswer = useCallback(
    (answer) => {
      const applied = applyAnswer(prefsRef.current, weightsRef.current, answer);
      const upcoming = nextQuestion(applied.preferences);

      prefsRef.current = applied.preferences;
      weightsRef.current = applied.weights;
      setPreferences(applied.preferences);
      setWeights(applied.weights);
      setMessages((prev) => {
        const next = [...prev, { role: "user", content: answerToLabel(answer), ts: new Date().toISOString() }];
        // Guard against repeating a question that's already the latest one.
        if (upcoming && prev[prev.length - 1]?.question?.id !== upcoming.id) {
          next.push(questionToMessage(upcoming, true));
        }
        return next;
      });

      const finalizing = !upcoming;
      if (finalizing) setLoading(true); // ranking the 3 picks is the only wait

      const snapshot = { preferences: applied.preferences, weights: applied.weights };
      postChain.current = postChain.current.then(async () => {
        try {
          const res = await fetch("/api/matchmaking/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId, answer, ...snapshot }),
          });
          const data = await res.json();
          if (res.ok) {
            applyRanking(data);
            if (finalizing && data.recommendations?.length) {
              setMessages((prev) => [...prev, inlineRecsMessage(data)]);
            }
          }
        } catch (err) {
          console.error("[ChatClient] handleAnswer failed:", err);
        } finally {
          if (finalizing) setLoading(false);
        }
      });
    },
    [sessionId, applyRanking]
  );

  // Free-text composer — parses an answer mid-flow, or refines the picks after
  // recommendations are ready. Server interprets; we append its reply.
  const handleUserSend = useCallback(
    (text) => {
      setMessages((prev) => [...prev, { role: "user", content: text, ts: new Date().toISOString() }]);
      setLoading(true);
      const snapshot = { preferences: prefsRef.current, weights: weightsRef.current };
      postChain.current = postChain.current.then(async () => {
        try {
          const res = await fetch("/api/matchmaking/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId, message: text, ...snapshot }),
          });
          const data = await res.json();
          if (res.ok) {
            applyRanking(data);
            if (data.preferences) {
              setPreferences(data.preferences);
              prefsRef.current = data.preferences;
            }
            if (data.weights) {
              setWeights(data.weights);
              weightsRef.current = data.weights;
            }
            if (data.nextQuestion) {
              setMessages((prev) =>
                prev[prev.length - 1]?.question?.id === data.nextQuestion.id
                  ? prev
                  : [...prev, questionToMessage(data.nextQuestion, true)]
              );
            } else if (data.recommendations?.length) {
              setMessages((prev) => [...prev, inlineRecsMessage(data)]);
            }
          }
        } catch (err) {
          console.error("[ChatClient] handleUserSend failed:", err);
        } finally {
          setLoading(false);
        }
      });
    },
    [sessionId, applyRanking]
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
        setLoading(true);
      }

      // 2. Sync with server (authoritative source)
      try {
        const res = await fetch("/api/matchmaking/chat");
        const { session } = await res.json();

        if (session) {
          // Transcript messages already carry their `question` descriptor.
          const serverMessages = (session.transcript ?? []).map((m) => ({
            role: m.role,
            content: m.content,
            ts: m.ts,
            ...(m.question ? { question: m.question } : {}),
            ...(m.recommendations ? { recommendations: m.recommendations } : {}),
          }));
          // A pre-rework session has messages but none carry a `question`
          // descriptor (no chips) — it can't be answered. Restart it cleanly.
          const isStaleOldChat =
            session.status !== "recommendations_ready" &&
            serverMessages.length > 0 &&
            !serverMessages.some((m) => m.question);
          if (isStaleOldChat) {
            await startFresh();
            return;
          }

          setSessionId(session.id);
          setPreferences(session.preferences ?? {});
          setWeights(session.weights ?? {});
          setCandidates(session.candidates ?? []);
          setRecommendations(session.recommendations ?? []);
          setStatus(session.status);
          if (serverMessages.length > 0) {
            setMessages(serverMessages);
          } else if (!hadCache.current) {
            await startFresh();
            return;
          }
          setLoading(false);
        } else if (!hadCache.current) {
          await startFresh();
        } else {
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
            data.nextQuestion
              ? questionToMessage(data.nextQuestion, true)
              : { role: "assistant", content: data.assistantMessage, ts: new Date().toISOString() },
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

  const handlePanelUpdate = useCallback(
    (data) => {
      applyServerState(data);
    },
    [applyServerState]
  );

  // Edit a past prompt: rewind prefs/weights to before that question, truncate
  // the chat back to it, and re-ask it (the user continues forward from there).
  const handleEditFrom = useCallback(
    (questionId) => {
      const rewound = rewindTo(prefsRef.current, questionId);
      prefsRef.current = rewound.preferences;
      weightsRef.current = rewound.weights;
      setPreferences(rewound.preferences);
      setWeights(rewound.weights);
      setStatus("in_progress");
      setRecommendations([]);

      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.question?.id === questionId);
        const head = idx >= 0 ? prev.slice(0, idx) : prev;
        const descriptor = describeQuestion(QUESTION_BY_ID[questionId], rewound.preferences);
        const truncated = [...head, questionToMessage(descriptor, false)];

        // Persist the truncated transcript + rewound state so reloads stay consistent.
        postChain.current = postChain.current.then(() =>
          fetch("/api/matchmaking/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId,
              action: "rewind",
              preferences: rewound.preferences,
              weights: rewound.weights,
              transcript: truncated,
            }),
          }).catch((err) => console.error("[ChatClient] rewind failed:", err))
        );

        return truncated;
      });
    },
    [sessionId]
  );

  // Abandon the current chat and begin a brand-new session from question one.
  const startOver = useCallback(async () => {
    try {
      localStorage.removeItem(LS_KEY);
    } catch {}
    setSessionId(null);
    setMessages([]);
    setPreferences({});
    setWeights({});
    setCandidates([]);
    setRecommendations([]);
    setStatus("in_progress");
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
          data.nextQuestion
            ? questionToMessage(data.nextQuestion)
            : { role: "assistant", content: data.assistantMessage, ts: new Date().toISOString() },
        ]);
      }
    } catch (err) {
      console.error("[ChatClient] startOver failed:", err);
    } finally {
      setLoading(false);
    }
  }, [applyServerState]);

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
          {/* Slim header with a restart control */}
          <div className="flex-shrink-0 flex items-center justify-end px-3 py-1.5 border-b border-gray-100">
            <button
              onClick={startOver}
              className="text-xs text-gray-400 hover:text-red-600 transition"
            >
              Start over
            </button>
          </div>
          {/* Recommendations now render inline in the chat so the user can keep
              chatting to refine — no full-screen swap. */}
          <ChatWindow
            messages={messages}
            loading={loading}
            onSend={handleUserSend}
            onAnswer={handleAnswer}
            onEdit={handleEditFrom}
          />
        </div>

        {/* Side panel — desktop only; always the answers panel so users can edit */}
        <div className="hidden md:flex flex-col w-72 min-h-0 bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <PreferencePanel
            preferences={preferences}
            weights={weights}
            sessionId={sessionId}
            onUpdated={handlePanelUpdate}
          />
        </div>
      </div>
    </div>
  );
}
