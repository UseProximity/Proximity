/*
 * Renders a legal document's markdown with Proximity's typography.
 *
 * Deliberately styled element-by-element rather than with a prose plugin: these
 * documents lean hard on tables, and a table that overflows on a phone makes a
 * policy unreadable, so every table gets its own horizontal scroll container
 * while the page itself never scrolls sideways.
 *
 * Heading IDs are generated so the in-document cross-references ("see Section 8")
 * can be linked to later, and so a section can be shared by URL.
 */
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

function slugify(children) {
  return String(children)
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

const components = {
  h2: ({ children }) => (
    <h2
      id={slugify(children)}
      className="scroll-mt-24 mt-12 mb-4 text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl"
    >
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3
      id={slugify(children)}
      className="scroll-mt-24 mt-8 mb-3 text-lg font-bold tracking-tight text-gray-950 sm:text-xl"
    >
      {children}
    </h3>
  ),
  p: ({ children }) => (
    <p className="my-4 text-base leading-7 text-gray-700 sm:leading-8">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="my-4 list-disc space-y-2 pl-6 text-base leading-7 text-gray-700 sm:leading-8">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-4 list-decimal space-y-2 pl-6 text-base leading-7 text-gray-700 sm:leading-8">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-1">{children}</li>,
  strong: ({ children }) => (
    <strong className="font-semibold text-gray-950">{children}</strong>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      className="font-medium text-rose-600 underline underline-offset-2 hover:text-rose-700"
      {...(href?.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {children}
    </a>
  ),
  hr: () => <hr className="my-10 border-gray-200" />,
  code: ({ children }) => (
    <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[0.85em] text-gray-800">
      {children}
    </code>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-6 border-l-4 border-rose-200 bg-rose-50/50 py-1 pl-4 text-gray-700">
      {children}
    </blockquote>
  ),
  // Wide tables scroll inside their own container so the page body never does.
  table: ({ children }) => (
    <div className="my-6 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => <thead className="border-b border-gray-300">{children}</thead>,
  tbody: ({ children }) => (
    <tbody className="divide-y divide-gray-200">{children}</tbody>
  ),
  th: ({ children }) => (
    <th className="px-3 py-2.5 align-top font-semibold text-gray-950">{children}</th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-2.5 align-top leading-6 text-gray-700">{children}</td>
  ),
};

export default function LegalDocument({ body }) {
  return (
    <div className="[&>*:first-child]:mt-0">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {body}
      </Markdown>
    </div>
  );
}
