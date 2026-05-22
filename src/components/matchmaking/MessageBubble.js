"use client";

export default function MessageBubble({ message }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex items-end gap-2 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-red-100 text-red-600 text-xs font-bold flex items-center justify-center flex-shrink-0">
          P
        </div>
      )}
      <div
        className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm leading-snug whitespace-pre-wrap ${
          isUser
            ? "bg-red-600 text-white rounded-br-sm"
            : "bg-gray-100 text-gray-800 rounded-bl-sm"
        }`}
      >
        {message.content}
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
  );
}
