"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MessageBubble from "./MessageBubble";
import RecommendationCards from "./RecommendationCards";
import QuestionControls from "./AnswerControls";

// Identity for an active question (pairwise pairs share id "priorities", so fold
// in the per-pair stepKey). Mirrors qKey in ChatClient.
const qKey = (q) => (q ? `${q.id}:${q.meta?.stepKey ?? ""}` : null);

function TypingDots() {
  return (
    <div className="flex items-end gap-2">
      <div className="w-7 h-7 rounded-full bg-red-100 text-red-600 text-xs font-bold flex items-center justify-center flex-shrink-0">
        P
      </div>
      <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-3 py-2.5 flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
    </div>
  );
}

// The answer options for the current question rise up from the bottom edge of
// the chat window when Proxy finishes asking — no docked composer, no backdrop.
// Keyed by question in the parent so it re-mounts (and re-animates) each turn.
function AnswerSheet({ children }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div
      className={`flex-shrink-0 border-t border-gray-200 bg-white px-4 pb-4 pt-3 transform-gpu transition-all duration-300 ease-out ${
        shown ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
      }`}
    >
      <div className="max-h-48 overflow-y-auto pr-0.5">{children}</div>
    </div>
  );
}

// Three pulsing placeholders shown in place of the listing cards while a
// preference change is being re-ranked, so the chat reads as "reloading matches".
function RecommendationsSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
      {[0, 1, 2].map((n) => (
        <div key={n} className="space-y-1.5">
          <div className="h-4 w-24 rounded-full bg-gray-100 animate-pulse" />
          <div className="aspect-video rounded-2xl bg-gray-100 animate-pulse" />
          <div className="h-3 w-3/4 rounded bg-gray-100 animate-pulse" />
        </div>
      ))}
    </div>
  );
}

export default function ChatWindow({ messages, loading, recsUpdating, userInitial, onSend, onAnswer, onEdit }) {
  const scrollRef = useRef(null);
  const lastMsgRef = useRef(null);
  const inputRef = useRef(null);

  // The active question lives at the end of the transcript while we're not
  // loading. Its answer controls render down in the composer (next to the text
  // input), but only once the bubble has finished typing — `revealedKey` tracks
  // which question's bubble has signalled it's done.
  const [revealedKey, setRevealedKey] = useState(null);
  const lastMsg = messages[messages.length - 1];
  const activeQuestion = !loading && lastMsg?.question ? lastMsg.question : null;
  const activeKey = qKey(activeQuestion);
  const controlsReady = !!activeQuestion && revealedKey === activeKey;

  // The free-text composer only appears once the first batch of listings has
  // been shown — before that, the conversation is driven entirely by the
  // slide-up answer sheets, with nothing docked at the bottom.
  const hasRecommendations = messages.some((m) => m.recommendations);

  // The most recent set of picks is the one the answers panel edits in place, so
  // that's the message that flips to skeletons while a preference change re-ranks.
  let lastRecsIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].recommendations) {
      lastRecsIdx = i;
      break;
    }
  }

  // Scroll the chat container ONLY (never the page) so the top of the newest
  // message is visible. Using scrollIntoView here would bubble up and scroll the
  // whole page; instead we adjust this container's own scrollTop.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const el = lastMsgRef.current;
    if (el) {
      const delta = el.getBoundingClientRect().top - container.getBoundingClientRect().top;
      container.scrollTo({ top: container.scrollTop + delta, behavior: "smooth" });
    } else {
      container.scrollTop = 0;
    }
  }, [messages.length, loading]);

  // Once a bubble finishes typing (and its chips render), scroll so the WHOLE
  // bubble is in view — the bubble's height isn't known until typing completes.
  const scrollToBottom = useCallback(() => {
    const container = scrollRef.current;
    if (container) container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, []);

  // When the answer popup slides up it claims space at the bottom of the window;
  // re-scroll so Proxy's last message rides up above it instead of being hidden.
  useEffect(() => {
    if (!controlsReady) return;
    const id = requestAnimationFrame(() => scrollToBottom());
    return () => cancelAnimationFrame(id);
  }, [controlsReady, activeKey, scrollToBottom]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const text = e.target.value.trim();
      if (text && !loading) {
        onSend(text);
        e.target.value = "";
      }
    }
  };

  const handleSendClick = () => {
    const text = inputRef.current?.value.trim();
    if (text && !loading) {
      onSend(text);
      inputRef.current.value = "";
    }
  };

  return (
    // flex-1 fills the parent flex-col chat box; min-h-0 lets it shrink below content size
    <div className="flex-1 min-h-0 flex flex-col">

      {/* Scrollable message list — grows, shrinks, scrolls internally */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 pt-4 pb-8 space-y-3">
        {messages.length === 0 && loading && (
          <p className="text-xs text-gray-400 text-center pt-2">Proxy is starting up…</p>
        )}
        {messages.map((msg, i) => {
          const isLast = i === messages.length - 1;
          const updatingThis = recsUpdating && i === lastRecsIdx;
          return (
            <div key={i} ref={isLast ? lastMsgRef : null}>
              {msg.recommendations ? (
                // Proxy speaks first (avatar + message), then sends the listing
                // cards just beneath, indented to line up under the message so the
                // whole thing reads as one turn from Proxy.
                <div className="space-y-2">
                  <div className="flex items-end gap-2">
                    <div className="w-7 h-7 rounded-full bg-red-100 text-red-600 text-xs font-bold flex items-center justify-center flex-shrink-0">
                      P
                    </div>
                    <div className="max-w-[75%] bg-gray-100 text-gray-800 rounded-2xl rounded-bl-sm px-3 py-2 text-sm leading-snug">
                      {updatingThis ? "Updating your matches…" : msg.content}
                    </div>
                  </div>
                  {/* Indent past the "P" avatar on the left (w-7 + gap-2 = 2.25rem) and
                      reserve a matching gutter on the right so the cards stay inside
                      Proxy's column and never leak into the user's avatar column. */}
                  <div className="ml-9 mr-9 mt-1">
                    {updatingThis ? (
                      <RecommendationsSkeleton />
                    ) : (
                      <RecommendationCards recommendations={msg.recommendations} />
                    )}
                  </div>
                </div>
              ) : (
                <MessageBubble
                  message={msg}
                  userInitial={userInitial}
                  // The latest question is answered down in the composer; past
                  // prompts get an Edit button beneath the bubble.
                  onEdit={msg.question && !(isLast && !loading) && onEdit ? () => onEdit(msg.question.id) : undefined}
                  onReady={
                    isLast
                      ? () => {
                          scrollToBottom();
                          // Reveal this question's controls now that it's typed out.
                          if (msg.question) setRevealedKey(qKey(msg.question));
                        }
                      : undefined
                  }
                />
              )}
            </div>
          );
        })}
        {loading && (
          <div ref={messages.length === 0 ? lastMsgRef : null}>
            <TypingDots />
          </div>
        )}
      </div>

      {/* Bottom of the window. During the scripted questions nothing is docked
          here — when Proxy finishes asking, the answer options slide up from this
          edge (AnswerSheet). The free-text composer only takes over once the
          first batch of listings exists, so the student can refine / follow up. */}
      {controlsReady ? (
        <AnswerSheet key={activeKey}>
          <QuestionControls question={activeQuestion} onAnswer={onAnswer} />
        </AnswerSheet>
      ) : hasRecommendations ? (
        <div className="flex-shrink-0 border-t border-gray-100 px-4 pb-4 pt-3">
          <div className="flex items-center gap-2 bg-gray-50 rounded-xl border border-gray-200 px-3 py-2">
            <input
              ref={inputRef}
              type="text"
              onKeyDown={handleKeyDown}
              placeholder={loading ? "Proxy is typing…" : "Tell Proxy what to adjust…"}
              disabled={loading}
              className="flex-1 bg-transparent text-sm text-gray-800 placeholder-gray-400 outline-none disabled:opacity-50"
            />
            <button
              onClick={handleSendClick}
              disabled={loading}
              className="w-7 h-7 rounded-full bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white flex items-center justify-center transition flex-shrink-0"
            >
              <svg className="w-3.5 h-3.5 translate-x-px" fill="currentColor" viewBox="0 0 24 24">
                <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
              </svg>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
