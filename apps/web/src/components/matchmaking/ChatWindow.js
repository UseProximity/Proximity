"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MessageBubble from "./MessageBubble";
import RecommendationCards from "./RecommendationCards";
import QuestionControls from "./AnswerControls";

// Identity for an active question. Consecutive narrowing tradeoffs all share the
// id "tradeoff", so fold in the per-question stepKey to keep them distinct.
// Mirrors qKey in ChatClient.
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
    // pb keeps clear of the iOS home indicator when the page opts into the safe
    // area (env() resolves to 0 otherwise, so this is just normal padding today).
    <div
      className={`flex-shrink-0 border-t border-gray-200 bg-white px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))] transform-gpu transition-all duration-300 ease-out ${
        shown ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
      }`}
    >
      {/* Capped at a share of the viewport (not a fixed height) so a long chip
          set scrolls instead of the sheet growing past the screen, with a little
          padding so the last row never sits flush against the clipped edge. */}
      <div className="max-h-[38vh] overflow-y-auto px-0.5 pb-1">{children}</div>
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

// Editable preview of the note Proxy will email the selected owners. The student
// can tweak it freely and send when ready; once sent it locks to a read-only quote.
function DraftCompose({ draft, loading, onSend }) {
  const [text, setText] = useState(draft.message);
  if (draft.sent) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
        <p className="italic whitespace-pre-wrap">&ldquo;{draft.message}&rdquo;</p>
        <p className="mt-1.5 text-[11px] font-semibold text-green-600">Sent ✓</p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        disabled={loading}
        className="w-full resize-none text-xs leading-relaxed text-gray-800 bg-transparent outline-none p-1.5 disabled:opacity-50"
      />
      <div className="flex items-center justify-between pt-1">
        <span className="text-[10px] text-gray-400">You can edit this before sending.</span>
        <button
          onClick={() => text.trim() && onSend(draft, text.trim())}
          disabled={loading || !text.trim()}
          className="inline-flex items-center gap-1.5 rounded-full bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-xs font-semibold px-3 py-1.5 transition"
        >
          Send
          <svg className="w-3 h-3 translate-x-px" fill="currentColor" viewBox="0 0 24 24">
            <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// A "matches" turn: Proxy's message types out first (markdown-aware), THEN the
// listing cards render beneath it — which in turn hold their own skeletons until
// each card's image has loaded (see RecommendationCards).
function RecsTurn({ msg, updating, userInitial, onTyped, onGrow }) {
  const [textDone, setTextDone] = useState(!msg.animate);
  const bubbleMsg = updating ? { ...msg, content: "Updating your matches…", animate: false } : msg;
  return (
    <div className="space-y-2">
      <MessageBubble
        message={bubbleMsg}
        userInitial={userInitial}
        onGrow={onGrow}
        onReady={() => {
          setTextDone(true);
          onTyped?.();
        }}
      />
      {/* Indent past the "P" avatar on the left (w-7 + gap-2 = 2.25rem) and
          reserve a matching gutter on the right so the cards stay inside
          Proxy's column and never leak into the user's avatar column. */}
      <div className="ml-9 mr-9 mt-1">
        {updating ? (
          <RecommendationsSkeleton />
        ) : textDone ? (
          <RecommendationCards recommendations={msg.recommendations} />
        ) : null}
      </div>
    </div>
  );
}

// An email-draft turn: Proxy's intro types out, then the editable draft appears.
function DraftTurn({ msg, loading, userInitial, onSendDraft, onTyped, onGrow }) {
  const [textDone, setTextDone] = useState(!msg.animate);
  return (
    <div className="space-y-2">
      <MessageBubble
        message={msg}
        userInitial={userInitial}
        onGrow={onGrow}
        onReady={() => {
          setTextDone(true);
          onTyped?.();
        }}
      />
      {textDone && (
        <div className="ml-9 mr-9 mt-1">
          <DraftCompose draft={msg.draft} loading={loading} onSend={onSendDraft} />
        </div>
      )}
    </div>
  );
}

// How far from the bottom the reader can be before we stop auto-following a
// message that's still typing (they've scrolled up to re-read something).
const NEAR_BOTTOM_PX = 80;

export default function ChatWindow({ messages, loading, recsUpdating, userInitial, onSend, onAnswer, onSendDraft, onEdit }) {
  const scrollRef = useRef(null);
  const lastMsgRef = useRef(null);
  const inputRef = useRef(null);

  // Sequential reveal: when several Proxy messages land in one update (e.g. the
  // matches plus the contact offer), each animated bubble stays hidden until the
  // one before it has finished typing — so Proxy "speaks" one message at a time.
  const [typedMap, setTypedMap] = useState({});
  const msgKey = (msg, i) => `${i}:${msg.ts ?? ""}`;
  let firstPendingIdx = messages.length;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].animate && !typedMap[msgKey(messages[i], i)]) {
      firstPendingIdx = i;
      break;
    }
  }

  // The active question lives at the end of the transcript while we're not
  // loading. Its answer controls render down in the composer (next to the text
  // input), but only once ITS OWN bubble has finished typing. Gate on the
  // message (typedMap), not the question id — a re-asked question (e.g. a second
  // "contact owners?" offer) shares its predecessor's id, and an id-based gate
  // would leak the new controls while the bubble is still typing. A non-animated
  // question (re-asked via Edit, or restored from the server transcript) is
  // ready immediately.
  const lastMsg = messages[messages.length - 1];
  const activeQuestion = !loading && lastMsg?.question ? lastMsg.question : null;
  const activeKey = qKey(activeQuestion);
  const controlsReady =
    !!activeQuestion && (!lastMsg?.animate || !!typedMap[msgKey(lastMsg, messages.length - 1)]);

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
  //
  // The ref is on the last RENDERED message, not the last message in the array:
  // messages queued behind one that is still typing aren't in the DOM, so anchoring
  // on the array's tail left the ref null every time Proxy started typing — and
  // the old fallback then slammed the transcript back to the very top. There is
  // no "reset to top" case anymore; with nothing to anchor on, we hold position.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const el = lastMsgRef.current;
    if (!el) return;
    const delta = el.getBoundingClientRect().top - container.getBoundingClientRect().top;
    container.scrollTo({ top: container.scrollTop + delta, behavior: "smooth" });
  }, [messages.length, loading]);

  // Once a bubble finishes typing (and its chips render), scroll so the WHOLE
  // bubble is in view — the bubble's height isn't known until typing completes.
  const scrollToBottom = useCallback(() => {
    const container = scrollRef.current;
    if (container) container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, []);

  // A bubble grew by `delta` px mid-typewriter (its text wrapped onto a new line).
  // Scroll by exactly that much so the line being written stays where the last
  // line was, instead of marching off the bottom of the window. Instant, not
  // smooth: a smooth scroll per line would still be animating when the next line
  // lands, and the text would drift away faster than the view could catch up.
  //
  // Skipped when the user has scrolled up to re-read something — yanking them
  // back down mid-read would be worse than letting the new text go off-screen.
  const handleGrow = useCallback((delta) => {
    const container = scrollRef.current;
    if (!container || !delta) return;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom - delta > NEAR_BOTTOM_PX) return; // reading history
    container.scrollTop += delta;
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
          // Hold back messages queued behind one that is still typing.
          if (i > firstPendingIdx) return null;
          // Anchor the scroll on the last message actually on screen.
          const isLast = i === Math.min(firstPendingIdx, messages.length - 1);
          const updatingThis = recsUpdating && i === lastRecsIdx;
          // Fires when this bubble finishes typing: unblocks the next queued
          // message (and, via typedMap, this question's answer controls) and
          // keeps the newest content in view.
          const onTyped = () => {
            setTypedMap((m) => ({ ...m, [msgKey(msg, i)]: true }));
            scrollToBottom();
          };
          return (
            <div key={i} ref={isLast ? lastMsgRef : null}>
              {msg.recommendations ? (
                <RecsTurn msg={msg} updating={updatingThis} userInitial={userInitial} onTyped={onTyped} onGrow={handleGrow} />
              ) : msg.draft ? (
                <DraftTurn msg={msg} loading={loading} userInitial={userInitial} onSendDraft={onSendDraft} onTyped={onTyped} onGrow={handleGrow} />
              ) : (
                <MessageBubble
                  message={msg}
                  userInitial={userInitial}
                  // Edit lives under the user's OWN answer bubble: tapping it
                  // rewinds the flow to that question, as if answering it fresh.
                  onEdit={msg.role === "user" && msg.questionId && onEdit ? () => onEdit(msg.questionId, msg.tradeoffIndex) : undefined}
                  onReady={onTyped}
                  onGrow={handleGrow}
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
        <div className="flex-shrink-0 border-t border-gray-100 px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {/* Same control scale as the answer chips (see AnswerControls). */}
          <div className="flex items-center gap-2 bg-gray-50 rounded-xl border border-gray-200 px-3 py-1.5">
            <input
              ref={inputRef}
              type="text"
              onKeyDown={handleKeyDown}
              placeholder={loading ? "Proxy is typing…" : "Tell Proxy what to adjust…"}
              disabled={loading}
              className="flex-1 bg-transparent text-[13px] text-gray-800 placeholder-gray-400 outline-none disabled:opacity-50"
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
