"use client";

import { useEffect, useRef, useState } from "react";

function InlineDots() {
  return (
    <span className="inline-flex items-center gap-1 py-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </span>
  );
}

export default function MessageBubble({ message, userInitial, onEdit, onReady }) {
  const isUser = message.role === "user";
  const animate = !isUser && !!message.animate;
  const firedReady = useRef(false);

  // "Typing" effect: 0.5s of dots, then typewrite the text.
  const [phase, setPhase] = useState(animate ? "dots" : "done");
  const [shown, setShown] = useState(animate ? "" : message.content);

  useEffect(() => {
    if (!animate) return;
    const t = setTimeout(() => setPhase("typing"), 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase !== "typing") return;
    const content = message.content ?? "";
    let i = 0;
    const iv = setInterval(() => {
      i += 1;
      setShown(content.slice(0, i));
      if (i >= content.length) {
        clearInterval(iv);
        setPhase("done");
      }
    }, 18);
    return () => clearInterval(iv);
  }, [phase, message.content]);

  const showDots = animate && phase === "dots";
  const ready = !animate || phase === "done";

  // Notify the parent once the bubble is fully typed so it can scroll the bubble
  // into view and reveal the answer controls in the composer.
  useEffect(() => {
    if (ready && !firedReady.current) {
      firedReady.current = true;
      onReady?.();
    }
  }, [ready, onReady]);

  return (
    <div className="group">
      <div className={`flex items-end gap-2 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
        {!isUser ? (
          <div className="w-7 h-7 rounded-full bg-red-100 text-red-600 text-xs font-bold flex items-center justify-center flex-shrink-0">
            P
          </div>
        ) : (
          // User avatar mirrors Proxy's on the opposite side: their first initial,
          // a fixed-width column the bubble never overlaps into.
          <div className="w-7 h-7 rounded-full bg-gray-200 text-gray-600 text-xs font-bold flex items-center justify-center flex-shrink-0">
            {userInitial || (
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 12a5 5 0 100-10 5 5 0 000 10zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5z" />
              </svg>
            )}
          </div>
        )}
        <div
          className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm leading-snug whitespace-pre-wrap ${
            isUser
              ? "bg-red-600 text-white rounded-br-sm"
              : "bg-gray-100 text-gray-800 rounded-bl-sm"
          }`}
        >
          {showDots ? <InlineDots /> : animate ? shown : message.content}

          {message.tradeoff && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[message.tradeoff.optionA, message.tradeoff.optionB].map((opt) => (
                <button
                  key={opt}
                  onClick={() => message.onTradeoffPick?.(opt)}
                  className="px-2.5 py-1 rounded-full bg-white border border-red-300 text-red-700 text-xs font-medium hover:bg-red-50 transition"
                >
                  {opt}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Edit affordance beneath the user's OWN answer bubble (right-aligned to
          mirror the bubble), shown on hover. Rewinds the flow to that question. */}
      {ready && onEdit && (
        <div className={`mt-1 flex ${isUser ? "justify-end mr-9" : "ml-9"}`}>
          <button
            onClick={onEdit}
            className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Edit
          </button>
        </div>
      )}
    </div>
  );
}
