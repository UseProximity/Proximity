// A small spinner with its label, for the agreement signing steps.
export default function Spinner({ label, className = "" }) {
  return (
    <span className={`inline-flex items-center gap-2 text-sm text-gray-600 ${className}`} role="status">
      <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-gray-200 border-t-red-500" aria-hidden="true" />
      {label}
    </span>
  );
}
