/*
 * Loader for the published legal documents (/privacy, /terms).
 *
 * The markdown in src/content/legal/ is the SINGLE SOURCE OF TRUTH: the same
 * files that were drafted and reviewed in docs/legal/. Nothing here rewrites the
 * text; the page renders exactly what the document says, so a wording change is
 * an edit to the .md file and nothing else.
 *
 * Read with fs rather than a static import because there is no markdown loader
 * configured (and adding one would mean the .md files stop being plain files the
 * team can edit). The root layout calls auth(), which makes every route dynamic,
 * so this read happens on a cold start rather than at build time. The pages call
 * it at module scope and hold the result for the life of the instance. Next's
 * file tracing picks both .md files up into the function bundle (verified in the
 * per-route .nft.json emitted under .next/server/app); if that ever stops
 * happening the pages fail loudly on the first request rather than silently
 * serving stale text.
 */
import fs from "node:fs";
import path from "node:path";

const CONTENT_DIR = path.join(process.cwd(), "src", "content", "legal");

export const LEGAL_DOCS = {
  privacy: {
    slug: "privacy",
    file: "privacy-policy.md",
    title: "Privacy Policy",
    description:
      "How Proximity collects, uses, shares, and protects your personal information across the website and mobile apps.",
  },
  terms: {
    slug: "terms",
    file: "terms-of-service.md",
    title: "Terms of Service",
    description:
      "The agreement between you and Proximity LLC covering accounts, listings, reviews, and use of the Services.",
  },
};

/*
 * Pull the "Last updated:" line out of the document so the page can show it in
 * the header. Returns null rather than throwing if the line is ever reworded:
 * a missing date must never take the whole page down.
 */
function extractLastUpdated(markdown) {
  const match = markdown.match(/^\*\*Last updated:\*\*\s*(.+)$/m);
  return match ? match[1].trim() : null;
}

/*
 * The heading and the effective/last-updated lines are rendered by the page's
 * own header, so strip them from the body to avoid showing them twice. Cuts
 * everything before the first horizontal rule, which both documents place
 * directly after their front matter.
 */
function stripFrontMatter(markdown) {
  const firstRule = markdown.indexOf("\n---\n");
  return firstRule === -1 ? markdown : markdown.slice(firstRule + 5).trimStart();
}

/*
 * Unresolved `[TO INSERT: …]` / `[TO DECIDE: …]` markers would render verbatim
 * on a public legal page. Surfaced to the page so it can warn loudly OUTSIDE
 * production rather than letting a placeholder reach real users unnoticed.
 */
function findPlaceholders(markdown) {
  return [...markdown.matchAll(/\[TO (?:INSERT|DECIDE):[^\]]*\]/g)].map((m) => m[0]);
}

export function getLegalDoc(slug) {
  const doc = LEGAL_DOCS[slug];
  if (!doc) throw new Error(`Unknown legal document: ${slug}`);

  const markdown = fs.readFileSync(path.join(CONTENT_DIR, doc.file), "utf8");

  return {
    ...doc,
    body: stripFrontMatter(markdown),
    lastUpdated: extractLastUpdated(markdown),
    placeholders: findPlaceholders(markdown),
  };
}
