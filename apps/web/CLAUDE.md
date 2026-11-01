# Web app (apps/web)

Web-specific details. Architecture, Git workflow, migration rules and security rules are in the root `CLAUDE.md`. If the task also touches mobile (for example a new or changed API route that the mobile app calls), read `apps/mobile/CLAUDE.md` before making changes.

Next.js 15 (App Router), React 18, Tailwind 3, NextAuth v5 beta, Supabase, Cloudflare R2, Nodemailer plus SES, Anthropic SDK. Plain JavaScript.

## Commands (run inside `apps/web`)

- `npm run dev -- -p 3000`, `npm run build`, `npm run lint`, `npm test` (Node's built-in runner, `src/**/*.test.js`).
- `src/lib/outreach.test.mjs` is not matched by the test glob, and no CI workflow runs tests or lint.
- Run `npm run build` (and `npm run lint`) before opening a PR.

## Local dev

- **Local dev runs on `localhost:3000`** (`npm run dev -- -p 3000`): `NEXTAUTH_URL` in `apps/web/.env.local` must match the served origin or login silently bounces, and the dev R2 bucket's CORS policy allows browser photo uploads from `http://localhost:3000` only, so any Cloudflare R2 testing must happen on 3000 (Wyatt, 2026-08-12).
- **When a change is done, restart the dev server on port 3000 when appropriate and tell the user when it is ready.** A dev server left running from another worktree keeps serving that worktree's code on whatever port it grabbed, so a stale `localhost:3001` (or a timed-out 3000) shows the new work missing and looks like a bug in the change (Wyatt, 2026-09-11).
- **Never run `npm run build` (or `npm run build:web`) while a dev server is running on the same worktree.** Both write to the same `.next`, so the production build overwrites the dev server's chunks and the running site starts serving pages with no CSS at all. It looks like a broken stylesheet, not a build collision. Stop the dev server, build, then `rm -rf apps/web/.next` and restart dev.
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

## Vercel

- **Vercel builds are opt-in on feature branches (Wyatt, 2026-10-16)**: build minutes are our biggest Vercel cost. `scripts/vercel-ignore-build.sh` (the `ignoreCommand` in `apps/web/vercel.json`) builds `main`, `staging` and `sandbox` only when `apps/web/`, `packages/` or the root `package*.json` changed, and builds any other branch only when the **latest pushed commit message contains `[preview]`**. So: prepare commits locally as needed, but only create them with the user's explicit approval. Push once when the work is ready to test, not after every commit. Add `[preview]` only when the user asks for a shareable preview URL (put it on the last commit of the push, since only that message is checked), and never push just to back up work.

## Proximity MCP tools (web only)

The MCP knowledge covers `apps/web/src` only (see the root file for the global rules).

- **`analyze-impact`**: maps a set of code changes to the testable surfaces they affect. Builds a reverse-dependency graph of `apps/web/src` and walks outward from each changed file to find every API endpoint and page downstream of it (directly or via shared components/libs/utils); also maps DB migration changes to routes querying the affected tables. It does not analyse `apps/mobile`, `packages/*` or TypeScript files. Returns an impact report + suggested test checklist. Inputs: `base` (default `staging`), optional `head` ref, or an explicit `files` list (for CI).
- **`run-impact-tests`**: executes the `analyze-impact` checklist against a running app (`baseUrl`, default `http://localhost:3000`; point at a deployment to test it). Endpoints are judged by auth level: public must respond without crashing; guarded routes must reject anonymous calls (401/403). If test credentials are present in `.env.test.local` (gitignored: `TEST_SESSION_COOKIE`, or `TEST_EMAIL`/`TEST_PASSWORD` + `TEST_ROLE`), it also logs in and verifies guarded **reads** work for a real user. Authenticated **mutations** are skipped unless `allowMutations:true`; leave OFF against a prod-backed environment (real writes/emails). It always sends anonymous mutating requests with an empty body, and must never be pointed at production.
- **Prompts**: scaffold/debug routes, components, pages, auth; plus role briefings.
- **Regenerate knowledge**: `node mcp/scripts/generate-knowledge.mjs` (rescans `apps/web/src` for routes, components, pages, utils, env vars; `db-schema.json` is hand-maintained against the live DB).

## Gotchas

- `/washu` landing pages need two edits: structure and filters in `src/lib/washuPages.js`, copy in `src/content/washu/*.json`. Weekly copy refreshes use the `seo-draft` skill.
