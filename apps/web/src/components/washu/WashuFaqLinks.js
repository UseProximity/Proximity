import Link from "next/link";

/**
 * Buttons under a /washu FAQ answer, for answers that point at a guide or tool
 * (budget guide, Lease Check, browse). Kept out of the answer text so the
 * FAQPage JSON-LD stays plain prose.
 */
export default function WashuFaqLinks({ links }) {
  if (!links?.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-white px-3.5 py-1.5 text-sm font-semibold text-red-600 hover:border-red-600 hover:bg-red-50 transition-colors"
        >
          {l.label}
          <span aria-hidden="true">→</span>
        </Link>
      ))}
    </div>
  );
}
