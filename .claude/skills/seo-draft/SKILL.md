---
name: seo-draft
description: Weekly SEO content refresh. Reads the measurement engine's flags, drafts copy updates to the /washu content JSONs on a local branch, validates them, and produces a plain-English review sheet with localhost URLs for Ben. NEVER pushes or opens a PR before Ben's explicit local approval.
---

# /seo-draft — local-preview-first content refresh

You are drafting SEO copy updates for Proximity. Ben reviews everything
locally before anything is pushed. Follow this workflow exactly.

## Workflow

1. **Get the flags.** Fetch `https://useproximity.org/api/seo/opportunities`
   with `Authorization: Bearer $CRON_SECRET` (env var or Vercel), or read the
   newest open `SEO weekly report` issue (`gh issue list --label seo-engine`).
   If neither is reachable, stop and tell Ben what is missing.
2. **Pick at most 2 flagged pages.** Prioritize: position_drop on a /washu
   page > low_ctr > impressions_drop > stale. `zero_impressions` is an
   indexation problem, not a copy problem: report it, do not draft for it.
3. **Branch.** `git fetch origin && git checkout -b seo-draft/<ISO-week>
   origin/staging` (in a worktree if the main checkout is busy).
4. **Draft.** Edit ONLY:
   - `apps/web/src/content/washu/<slug>.json` (revise `intro`,
     `directAnswer`, `faqs`, `benchmarkNote` for the flagged queries)
   - `apps/web/src/lib/washuPages.js` (dateModified bump ONLY)
   - `docs/content-drafts/<slug>.md` for a brand-new page idea (markdown
     draft with target queries + proposed route; never create routes or JSX)
5. **Validate.** `node scripts/seo-engine/validate.mjs` MUST pass. If it
   fails, fix the draft, never the validator.
6. **Review sheet.** Write `scripts/seo-engine/reports/<ISO-week>.md`: for
   each change, in plain English: which page, what changed and why (quote
   the flag data), the exact URL to view it (http://localhost:3000/washu/...,
   or the port the preview server uses), and how real visitors reach the
   page (which searches, which internal links).
7. **Present.** Start the dev server, give Ben the review sheet and URLs,
   and STOP. Only after Ben approves: push the branch and open a PR into
   staging (test plan in the body, no AI attribution).

## Voice (from the Obsidian brand files; re-read them when drafting:
`~/Documents/Claude/Projects/Proximity/obsidian-vault/Proximity Brain/08-Brand/Content Strategy.md`)

- Direct, confident, slightly edgy. Talk to students like a trusted friend
  who has toured every building, never like a brand or like Zillow.
- Short, punchy sentences. Say the useful thing first.
- Neutral Proximity voice on these pages: no byline, no first person.
- NO em dashes, ever. No generic housing-content filler ("finding an
  apartment can be an exciting journey").

## Hard content rules (the validator enforces these; understand them too)

- Never invent numbers. Every dollar figure or percentage is either in
  `scripts/seo-engine/benchmark-allowlist.json` (cited HUD SAFMR / Zillow
  ZORI) or already in the page's previous copy. Listing-specific data
  renders live from the database, never gets written into copy.
- Never compute or state an average rent from Proximity's own listings
  (settled antitrust constraint). Market context = HUD/ZORI with attribution.
- Never fabricate reviews, quotes, or student experiences.
- No roommate-matching language of any kind.
- Fair-housing care: no steering by protected class, no "safe for X"
  phrasing, no demographic characterizations of neighborhoods. Neutral,
  factual safety context only.
- FAQ answers must remain literally true against the live site (the FAQ
  text is also emitted as FAQPage schema; Google requires parity).

## Cadence and caps

One draft branch per week, at most 2 pages plus 1 new-page draft doc. If the
flags suggest more work than that, list the remainder in the review sheet as
next week's candidates.
