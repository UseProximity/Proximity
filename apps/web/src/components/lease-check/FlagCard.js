const SEVERITY_STYLES = {
  red: "bg-red-50 border border-red-200 text-red-700",
  yellow: "border border-amber-400 bg-amber-50 text-amber-900",
  green: "border border-emerald-200 bg-emerald-50 text-emerald-800",
};

const SEVERITY_LABELS = {
  red: "Red flag",
  yellow: "Worth asking about",
  green: "Good sign",
};

export default function FlagCard({ flag }) {
  const style = SEVERITY_STYLES[flag.severity] ?? SEVERITY_STYLES.yellow;
  return (
    <div className={`rounded-2xl p-5 ${style}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-70">
        {SEVERITY_LABELS[flag.severity] ?? flag.severity}
      </p>
      <h3 className="mt-1 text-base font-bold">{flag.title}</h3>
      <p className="mt-2 text-sm leading-6">{flag.explanation}</p>
      {flag.quote && (
        <blockquote className="mt-3 border-l-2 border-gray-300 pl-3 text-xs italic opacity-80">
          &ldquo;{flag.quote}&rdquo;
        </blockquote>
      )}
      <p className="mt-3 text-sm">
        <span className="font-semibold">Ask the landlord:</span> {flag.question}
      </p>
    </div>
  );
}
