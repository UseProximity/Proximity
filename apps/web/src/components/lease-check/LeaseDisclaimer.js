// Reused in two spots: the one-liner next to the upload button and the block under
// the results. Text-only by design — callouts in this codebase don't use alert icons.
export default function LeaseDisclaimer({ variant = "footer" }) {
  if (variant === "inline") {
    return (
      <p className="text-xs text-gray-400 mt-2">Not legal advice — AI makes mistakes.</p>
    );
  }
  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 text-sm text-gray-600">
      This isn&apos;t legal advice. Proximity isn&apos;t a law firm, and AI makes mistakes —
      it can miss things, and it can be wrong about what it finds. Read your lease. If
      something matters, talk to a lawyer or WashU Student Legal Services.
    </div>
  );
}
