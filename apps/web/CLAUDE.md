# Web app (apps/web)

Web-specific details. Architecture, Git workflow, Vercel and local-dev rules, migration rules and security rules are in the root `CLAUDE.md`. If the task also touches mobile (for example a new or changed API route that the mobile app calls), read `apps/mobile/CLAUDE.md` before making changes.

Next.js 15 (App Router), React 18, Tailwind 3, NextAuth v5 beta, Supabase, Cloudflare R2, Nodemailer plus SES, Anthropic SDK. Plain JavaScript.

## Commands (run inside `apps/web`)

- `npm run dev` (port 3000 is set in the script), `npm run build`, `npm run lint`, `npm test` (Node's built-in runner, `src/**/*.test.js`).
- `src/lib/outreach.test.mjs` is not matched by the test glob, and no CI workflow runs tests or lint.

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

## Gotchas

- `/washu` landing pages need two edits: structure and filters in `src/lib/washuPages.js`, copy in `src/content/washu/*.json`. Weekly copy refreshes use the `seo-draft` skill.
