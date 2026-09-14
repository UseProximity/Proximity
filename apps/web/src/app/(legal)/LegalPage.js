/*
 * Page shell shared by /privacy and /terms: title block, last-updated stamp,
 * a link across to the sibling document, and the rendered markdown.
 */
import Link from "next/link";
import { appEnv } from "@/lib/appEnv";
import LegalDocument from "@/components/legal/LegalDocument";

const SIBLING = {
  privacy: { href: "/terms", label: "Terms of Service" },
  terms: { href: "/privacy", label: "Privacy Policy" },
};

export default function LegalPage({ doc }) {
  const sibling = SIBLING[doc.slug];

  return (
    <main className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <header className="border-b border-gray-200 pb-8">
          <h1 className="text-3xl font-bold tracking-tight text-gray-950 sm:text-4xl">
            {doc.title}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-500">
            {doc.lastUpdated && <span>Last updated {doc.lastUpdated}</span>}
            <span aria-hidden className="hidden text-gray-300 sm:inline">
              &middot;
            </span>
            <Link
              href={sibling.href}
              className="font-medium text-rose-600 underline underline-offset-2 hover:text-rose-700"
            >
              Read our {sibling.label}
            </Link>
          </div>
        </header>

        {/* A `[TO INSERT: …]` left in the document would otherwise render verbatim
            on a public legal page. Loud outside production, invisible on the real
            site: the point is that the team sees it on staging, not that a user
            is told about it. */}
        {doc.placeholders.length > 0 && appEnv() !== "production" && (
          <div className="mt-8 rounded-xl border border-amber-300 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-900">
              {doc.placeholders.length} unresolved placeholder
              {doc.placeholders.length === 1 ? "" : "s"} in this document
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-800">
              {doc.placeholders.map((p) => (
                <li key={p}>
                  <code className="font-mono text-xs">{p}</code>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-amber-700">
              Fill these in before this page is published. This warning is not shown in
              production.
            </p>
          </div>
        )}

        <article className="mt-8">
          <LegalDocument body={doc.body} />
        </article>
      </div>
    </main>
  );
}
