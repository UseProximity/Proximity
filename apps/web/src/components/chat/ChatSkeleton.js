/*
 * Grey message bubbles that stand in for a conversation while it loads
 * (Wyatt, 2026-10-27): a few alternating left and right shapes, pulsing,
 * instead of a spinner.
 */
const ROWS = [
  { side: "left", w: "w-3/5", lines: 2 },
  { side: "right", w: "w-2/5", lines: 1 },
  { side: "left", w: "w-4/5", lines: 3 },
  { side: "right", w: "w-1/3", lines: 1 },
  { side: "left", w: "w-1/2", lines: 2 },
];

export default function ChatSkeleton({ rows = 5, className = "" }) {
  return (
    <div className={`flex flex-col gap-3 animate-pulse ${className}`} role="status" aria-label="Loading conversation">
      {ROWS.slice(0, rows).map((r, i) => (
        <div key={i} className={`flex ${r.side === "right" ? "justify-end" : "justify-start"} items-start gap-2`}>
          {r.side === "left" && <div className="mt-1 h-6 w-6 shrink-0 rounded-full bg-gray-200" />}
          <div className={`${r.w} space-y-1.5 rounded-2xl px-3.5 py-2.5 ${r.side === "right" ? "rounded-br-sm bg-red-100" : "rounded-tl-sm bg-gray-100"}`}>
            {Array.from({ length: r.lines }).map((_, j) => (
              <div key={j} className={`h-3 rounded ${r.side === "right" ? "bg-red-200" : "bg-gray-200"} ${j === r.lines - 1 && r.lines > 1 ? "w-2/3" : "w-full"}`} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
