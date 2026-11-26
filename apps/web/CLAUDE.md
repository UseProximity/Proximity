# Web app (apps/web)

Web-specific details. Architecture, Git workflow, Vercel and local-dev rules, migration rules and security rules are in the root `CLAUDE.md`. If the task also touches mobile (for example a new or changed API route that the mobile app calls), read `apps/mobile/CLAUDE.md` before making changes.

Next.js 15 (App Router), React 18, Tailwind 3, NextAuth v5 beta, Supabase, Cloudflare R2, Nodemailer plus SES, Anthropic SDK. Plain JavaScript.

## Commands (run inside `apps/web`)

- `npm run dev` (port 3000 is set in the script), `npm run build`, `npm run lint`, `npm test` (Node's built-in runner, `src/**/*.test.js` and `src/**/*.test.mjs`).
- No CI workflow runs tests or lint.

## Env files

- Next reads `apps/web/.env.local`, not the root `.env.local` (they are separate files, not a symlink). There is no `.env.example` for web.

## Environments and helpers (`src/lib/appEnv.js`)

- `APP_ENV` falls back to `VERCEL_ENV` when unset (preview means staging), then to `NODE_ENV`. A production build with no signal resolves to staging.
- Use the helpers, and don't check `NODE_ENV` directly for data/outreach decisions. Staging builds with `NODE_ENV=production`, so such a check is wrong there.
  - `isProdData()`: selects prod vs dev DB/bucket (used by `supabase.js`, `upload`, `streetview`).
  - `outreachEnabled()`: gate all external outreach (email, Airtable, Formspree) behind this.
  - `isStaging()`: staging-only UI (e.g. `StagingBanner`).
  - `indexingEnabled()`: gates `robots.js` and the `noindex` metadata.
- Send mail only through `sendMailSafe` (`src/lib/outreach.js`). Outside production it redirects or suppresses mail.

## API routes and auth

- Pick the guard deliberately. `auth()` reads the web session only. A route that mobile also calls must use `getRequestUser(req)`, which accepts a web session or a mobile Bearer token. Admin routes use `requireDbRole([...])` (`src/lib/userRole.js`), which re-reads the role from the DB and fails closed (the session role is cached for 60 s). Cron routes check `Authorization: Bearer ${CRON_SECRET}` inline.
- Use the service-role client from `@/lib/supabase`, and authorize in the route (it bypasses RLS).
- Writes that must be attributed to a user go through `src/lib/supabaseWithUser.js` (the `rpc_*_as_user` functions) so `action_log` records who acted.
- Return generic error messages, not `error.message`.

## Proximity MCP tools (web only)

The MCP knowledge covers `apps/web/src` only (see the root file for the global rules).

- **`analyze-impact`**: maps a set of code changes to the testable surfaces they affect. Builds a reverse-dependency graph of `apps/web/src` and walks outward from each changed file to find every API endpoint and page downstream of it (directly or via shared components/libs/utils); also maps DB migration changes to routes querying the affected tables. It does not analyse `apps/mobile`, `packages/*` or TypeScript files. Returns an impact report + suggested test checklist. Inputs: `base` (default `staging`), optional `head` ref, or an explicit `files` list (for CI).
- **`run-impact-tests`**: executes the `analyze-impact` checklist against a running app (`baseUrl`, default `http://localhost:3000`; point at a deployment to test it). Endpoints are judged by auth level: public must respond without crashing; guarded routes must reject anonymous calls (401/403). If test credentials are present in `.env.test.local` (gitignored: `TEST_SESSION_COOKIE`, or `TEST_EMAIL`/`TEST_PASSWORD` + `TEST_ROLE`), it also logs in and verifies guarded **reads** work for a real user. Authenticated **mutations** are skipped unless `allowMutations:true`; leave OFF against a prod-backed environment (real writes/emails). It always sends anonymous mutating requests with an empty body. The never-against-production rule is in the root file ("The Proximity MCP").
- **Prompts**: scaffold/debug routes, components, pages, auth; plus role briefings.
- **Regenerate knowledge**: `node mcp/scripts/generate-knowledge.mjs` (rescans `apps/web/src` for routes, components, pages, utils, env vars; `db-schema.json` is hand-maintained against the live DB).

## Responsive layout

- **Breakpoint roles** (Tailwind defaults): base is phone, `md` (768) is tablet, `xl` (1280) is desktop. The header uses the hamburger menu below `xl` and the full nav from `xl`. Where content goes side by side depends on the page: the browse list and map, the messages list and thread and the landlord sidebar split at `md`; stacked page content (dashboards, about) goes side by side at `lg`; the home hero (headline and listing cards) at 1200px, with a headline that scales between 1200 and 1400px. A side-by-side layout inside a page that already has a sidebar starts at `lg`, not `md`.
- **Desktop is frozen.** A responsive fix must not change anything at 1280px and wider: move the breakpoint later, or scope the class with `max-xl:`.
- **Header height**: `--header-h` in `src/app/globals.css` mirrors the header's own `h-[83px] md:h-[104px]` (`src/components/layout/Header.js`), so change both together. New code uses `top-[var(--header-h)]` or `calc(100dvh-var(--header-h))`, not the pixel values. Some older offsets are still literals derived from it (105/129px in `dashboard/landlord/page.js` and `QuestionsSection.js`, 319/343px in `AgentTab.js`, 107px and the popup's 91px top padding in `ModalListing.js` and `ModalDorms.js`, and the JS in `matchmaking/ChatClient.js`): update them too if the header height changes.
- **`?listing=` on a phone**: below 768px `GlobalListingModal` does not open the popup. It replaces the URL with the full listing page (`/listings/[id]`), adding `back=<where the popup would have been>` only when the site was opened on that link, so the page's back arrow has somewhere to go. Two cases stay a popup at every width: the landlord preview (`preview=1`) and any `/dashboard/admin` address, where `?listing=` filters the admin listings table. A card or link that opens a listing must not push `?listing=` on a phone (that navigates the page underneath first, which scrolls it to the top and costs a round trip): use `listingHref` or `openListingPageOnPhone` from `src/lib/listings/listingLink.js`.
- **Listing page sticky head**: `ListingModalInfo` takes `page` on the full listing page. Below `xl` its title and tabs then stick under the site header (`--header-h` plus the header's 1px border) instead of at 0, and the only heart is the one on the photo.
- **Listing tab bar** (`ListingModalInfo`): below `xl` the actions beside the tabs (waitlist, Furnish This Property, the popup's View on map) sit on their own row above the tabs, and the tabs get a full row that scrolls sideways if needed. Anything added to that slot must work on that row too.
- **Browse filter bar** (`TopFilterBar.js`) uses a one-off `max-[1151px]:` breakpoint: all its controls need about 1115px on one row (with a long Beds & Baths label), which is more than `lg`. Below 1152px it is two rows: search, Clear All and the map switch, then the filter buttons.
- **No control is hover-only.** Controls revealed on hover use `[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100`, so touch devices always see them. `InfoTip` opens on hover or focus.
- **Small dialogs** get `max-xl:max-h-[calc(100dvh-2rem)] max-xl:overflow-y-auto` on the box, so they scroll on a short screen.
- **Form fields on touch**: `globals.css` forces `input`, `select` and `textarea` text to 16px (`!important`) on touch devices below 1280px, because iPhone Safari zooms the page on smaller fields. A text-size class on a field has no effect there.

## Gotchas

- `/washu` landing pages need two edits: structure and filters in `src/lib/washuPages.js`, copy in `src/content/washu/*.json`. Weekly copy refreshes use the `seo-draft` skill.
