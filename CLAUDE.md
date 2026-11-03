# Claude Code Configuration — Proximity

Proximity is an off-campus housing marketplace for WashU (Washington University in St. Louis) students. Live at https://useproximity.org, deployed on Vercel.

It is a monorepo: a Next.js web app (`apps/web`) that is the application's only backend, and an Expo mobile app (`apps/mobile`) that calls it.

This file is a companion to the project knowledge served by the local **`proximity` MCP** (`mcp/`). That knowledge covers `apps/web/src` only, can lag the code, and knows nothing about `apps/mobile` or `packages/*`, so verify it against the code. When in doubt, read the MCP resources (`proximity://domain`, `proximity://db-schema`, `proximity://api-routes`, `proximity://components`, `proximity://pages`, `proximity://utils`, `proximity://env-vars`).

## Product terms

- **Matchmaking** is a feature that helps students find suitable housing by answering a series of questions. It has nothing to do with finding roommates: Proximity does not offer roommate finding or matching, so do not add it or describe it that way. (Mentioning roommates as rent-splitting context in guides is fine.)

## Monorepo

| Path                  | What it is                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`            | Next.js 15 site and the application's only backend: API routes, cron jobs, authentication and server-side database access |
| `apps/mobile`         | Expo (React Native) app for iOS and Android                                                                               |
| `packages/shared`     | Constants, formatters, matchmaking question engine (used by web and mobile)                                               |
| `packages/auth-core`  | Roles, validators, errors (used by web and mobile)                                                                        |
| `packages/api-client` | Client for the web API (plain JavaScript, used by mobile only)                                                            |
| `supabase/migrations` | All SQL migrations                                                                                                        |
| `mcp/`                | Proximity MCP knowledge server (not an npm workspace)                                                                     |
| `scripts/`            | Ops scripts (prod-to-dev snapshot, Vercel ignore step, ...)                                                               |

npm workspaces (`apps/*`, `packages/*`): run `npm install` at the root.

### How mobile and web fit together

There is no separate API service. `apps/web` serves every endpoint mobile uses, so mobile work often means reading or changing web code.

- **API**: mobile calls the web API at `EXPO_PUBLIC_API_URL` through `@proximity/api-client` (`apps/mobile/src/lib/apiClient.js`). Which deployment a build talks to (staging or production) is fixed at build time.
- **Auth**: web uses NextAuth v5 (Google, email/password, chat-link). Mobile uses its own JWTs from `/api/auth/mobile/{login,google,apple,refresh}` (`apps/web/src/lib/authMobile.js`; access token 15 min, refresh token 30 days), sent as a Bearer header. `getRequestUser(req)` accepts either a web session or a mobile token. Signup, password reset and email verification reuse the normal `/api/auth/*` routes.
- **Database access**: the web server handles all application data access through Supabase. API routes and server components use the service-role key (`apps/web/src/lib/supabase.js`), which bypasses RLS, so each route must check authorization itself. Apart from chat Realtime (next bullet), no client talks to Supabase directly: web client components call the API routes, and mobile has no `supabase-js` and runs no queries.
- **Realtime chat** is the only direct client access to Supabase. Web browsers and the mobile app connect to Supabase Realtime with the public Supabase key and a short-lived JWT from `GET /api/chat/realtime-token`, and row level security decides what those connections can see. Realtime events are only nudges; the REST routes remain the source of truth.
- **Push and links**: web sends push notifications (`expo-server-sdk`) and mobile registers its token at `/api/devices/push-token`. Web also serves the iOS universal-links file (`/.well-known/apple-app-site-association`).
- **Shared code**: a change in `packages/shared` or `packages/auth-core` affects both apps.
- **Compatibility**: mobile ships as store binaries and there is no OTA update path (no `expo-updates`). Old app versions keep calling the API long after a release, so API changes must be backward compatible: add fields and routes, do not remove or rename ones mobile uses.

### Per-app instructions

`apps/web/CLAUDE.md` and `apps/mobile/CLAUDE.md` hold the app-specific details. Claude Code loads them when working with files in that directory, so they may not be in context at the start of a session. Read the matching one before changing web or mobile code. **When a task spans web and mobile (for example a mobile feature that needs a new or changed API route), read both `apps/web/CLAUDE.md` and `apps/mobile/CLAUDE.md` before making any changes.**

## Working Agreement (how to ship changes)

- **Pull knowledge from `staging` FIRST**: before reading code, planning, or editing anything. The MCP resources only cover web and backend code, so mobile-only work can skip them. It still depends on API routes that may exist only on `staging` (the `mobile` branch can lag it), so before relying on an endpoint, check it on `origin/staging` (after a read-only `git fetch origin staging`, for example `git show origin/staging:apps/web/src/app/api/<route>/route.js`). `staging` is the trunk (every PR merges there first). CI regenerates `mcp/knowledge/` on `staging` but, on drift, only opens a sync PR (see Knowledge-sync CI), so the knowledge can stay outdated until that PR is merged. The MCP serves those files straight from your working tree, so on a stale clone or a long-lived branch it will confidently describe an _older_ codebase. Run `git fetch origin staging`; for new web or backend work, create a branch off the fresh `origin/staging` (mobile-only work branches off `mobile`, see Mobile branch), or, if you're already mid-branch, ask the user before running `git checkout origin/staging -- mcp/knowledge`. Then read the `proximity://` resources. Also check for an open `chore/knowledge-sync-staging` PR: if one exists, `staging` has drifted and that PR holds the newest picture. (`db-schema.json` is hand-maintained and can lag even when current with `staging`, so still verify columns against the live DB via the Supabase MCP.) Read-only Git such as `git fetch` needs no approval, but `git checkout origin/staging -- mcp/knowledge` overwrites files in the working tree, so it does (see Git approval below).
- **Branch & PR flow**: For every web or backend fix/feature, create a branch off `staging` (e.g. `feat/...`, `fix/...`); mobile-only work gets a branch off `mobile` instead (see Mobile branch). Implement the change and commit it on that branch, then give the user a **test plan and wait for approval**: do not push before approval. After the user has reviewed it, ask before pushing the branch and before opening a **PR into `staging`**: each needs the user's explicit approval (see Git approval).
- **Git approval**: no approval is needed for read-only Git (`status`, `log`, `diff`, `show`, `fetch`), `git pull` of the current branch from its own remote, creating branches and worktrees, switching branches, and committing. Pushing and opening a PR each need the user's explicit approval for that particular operation. So do any other merge, rebase, reset, stash, force-push, and anything else that can discard or rewrite work. Approving a test plan does not approve any of them.
- **Mobile branch**: mobile-only changes (`apps/mobile`, `packages/api-client`) go on a branch off `mobile` (create it yourself) with the PR into `mobile`, with the same test plan and approval step. Web, backend and shared code used by web (`apps/web`, `supabase/migrations`, `packages/shared`, `packages/auth-core`) always goes through `staging` first, even when a mobile feature needs it. Vercel rebuilds `staging` whenever `packages/` or the root `package*.json` changes (`scripts/vercel-ignore-build.sh`), so a `mobile` merge that touches `packages/api-client` or a dependency also triggers a web build, even though web does not import `api-client`. `mobile` is kept current by merging `staging` into it, and the whole `mobile` branch is merged into `staging` when the user decides. Both merges need the user's explicit approval, and once approved they are run by the user, not by you. `staging` merges into `main` weekly.
- **One branch, one PR per feature (Wyatt, 2026-08-12)**: keep a single branch open for the whole feature, make multiple commits on it as work lands, and open ONE PR for the entire branch. Never stack PRs and never split one feature across several PRs: commits within the PR provide the reviewable steps. When multiple features are in flight simultaneously (including parallel Claude sessions), give each feature its own branch (use a separate git worktree per feature so sessions don't collide), each ending in its own single PR. You may create the branches, worktrees and commits yourself; pushing and the PR need the user's explicit approval (see Git approval).
- **Vercel builds are opt-in on feature branches (Wyatt, 2026-10-16)**: build minutes are our biggest Vercel cost. `scripts/vercel-ignore-build.sh` (the `ignoreCommand` in `apps/web/vercel.json`) builds `main`, `staging` and `sandbox` only when `apps/web/`, `packages/` or the root `package*.json` changed, and builds any other branch only when the **latest pushed commit message contains `[preview]`**. So: commit locally as often as you like, but push once when the work is ready to test, not after every commit (a push needs the user's explicit approval). Add `[preview]` only when the user asks for a shareable preview URL (put it on the last commit of the push, since only that message is checked), and never push just to back up work.
- **Keep knowledge current**: After any substantial architectural change (new/removed/changed API route, component, page, util, env var, DB schema change, or convention), update the MCP knowledge: call the `update-knowledge` tool (and `log-task` for notable decisions), or re-run `node mcp/scripts/generate-knowledge.mjs` to rescan the codebase. Knowledge files (`mcp/knowledge/`, except `agent-sessions.json`) are **committed to git**: commit the regenerated files together with your code change so every machine and agent shares it. **`domain.json` is regenerated from a template inside `mcp/scripts/generate-knowledge.mjs`**: edit the script, not the JSON, or your change is wiped on the next run. Only `db-schema.json` and `active-tasks.json` are edited as files. The generator scans `apps/web/src` only, so mobile and `packages/*` changes need no knowledge update.
- **Knowledge-sync CI** (`update-knowledge.yml`): on pushes to `staging`/`main` that touch `apps/web/src/**` or `mcp/scripts/generate-knowledge.mjs` (no manual trigger), it regenerates knowledge and, if it drifted, **opens a PR** (`chore/knowledge-sync-<base>`) rather than pushing: both branches are protected and Actions can't be given a ruleset bypass. So regenerated files aren't on `staging` until that PR is merged. Committing knowledge with your own change keeps it from ever opening.
- **No AI attribution in git**: Never add a "Co-Authored-By: Claude" trailer or a "Generated with Claude Code" footer to commit messages or PR descriptions — write them as a normal contributor would.
- Do what's asked — nothing more, nothing less. Prefer editing existing files over creating new ones. Don't create docs/README files unless asked.
- Always read a file before editing it. Never commit secrets, credentials, or `.env*` files.

## Conventions

- **Local dev runs on `localhost:3000`**: `NEXTAUTH_URL` in `apps/web/.env.local` must match the served origin or login silently bounces, and the dev R2 bucket's CORS policy allows browser photo uploads from `http://localhost:3000` only, so any Cloudflare R2 testing must happen on 3000 (Wyatt, 2026-08-12). Start it with `npm run dev:web`: it always uses port 3000. If it fails because 3000 is busy, another dev server is running: stop it.
- Plain JavaScript everywhere (no TypeScript source except `apps/web/src/middleware.ts`; `apps/mobile/nativewind-env.d.ts` is a NativeWind-generated type file that stays committed, so do not edit or delete it); Tailwind CSS only (NativeWind `className` in `apps/mobile`), with no CSS modules and no inline styles for static styling (inline `style` is acceptable only for dynamic values).
- In `apps/web`, use the `@/` path alias (`@/components/...`, `@/lib/...`, `@/utils/...`); `apps/mobile` uses relative imports and `@proximity/*` for packages. Keep components reasonably small; extract sub-components when they grow.
- **No em dashes.** Not in code comments, UI copy, commit messages, PR descriptions or docs (Wyatt, 2026-09-03). Use a full stop, a comma, a colon or brackets instead. This applies to anything written into this repo, including mobile UI copy. It covers new and edited text: do not rewrite existing text only to remove them.
- API/auth/DB conventions live in `apps/web/CLAUDE.md` (API routes and auth) and in the Security section below. One rule worth repeating: **schema migrations always go to BOTH dev and prod** (how they are written and applied is in Security).

## Environments (`apps/web/src/lib/appEnv.js`)

Three environments, distinguished by **`APP_ENV`** (the exact fallback order is in `apps/web/CLAUDE.md`):

- **production** — the real site (useproximity.org): prod DB, prod R2 bucket, outreach ON.
- **staging** — Vercel staging deploy (`APP_ENV=staging`): **dev DB + dev bucket, outreach OFF**, shows a banner. A sandbox on a prod-data snapshot.
- **development** — local.

Use the helpers: don't check `NODE_ENV` directly for data/outreach decisions (staging builds with `NODE_ENV=production`, so such a check is wrong there). The helpers and their usage are in `apps/web/CLAUDE.md`.

The dev snapshot is refreshed by `scripts/snapshot-prod-to-dev.sh` (clones prod `public` → dev, stamps `app_metadata.snapshot_taken_at`).

### Mobile builds

The purpose of a build decides its backend, not how it is distributed. Intended policy: testing builds (including internal TestFlight beta) use the staging API with the dev database, and App Store release builds use the production API and database. The Expo-hosted environment values behind the EAS profiles have **not** been verified: never state that Expo is configured this way, and if a task depends on it, ask the user to check Expo. The profile table and details are in `apps/mobile/CLAUDE.md`.

## Build & Test

```bash
npm run dev:web     # web dev server on port 3000 (see Conventions)
npm run dev:mobile  # Expo dev server (needs a development build, see apps/mobile/CLAUDE.md)
npm run build:web   # production build (/sitemap.xml is a dynamic route: apps/web/src/app/sitemap.js)
npm run lint        # ESLint (apps/web only, mobile has no lint script)
```

**When a change is done, restart the dev server on port 3000 when appropriate and tell the user when it is ready.** A dev server left running from another worktree keeps serving that worktree's code on whatever port it grabbed, so a stale `localhost:3001` (or a timed-out 3000) shows the new work missing and looks like a bug in the change (Wyatt, 2026-09-11).

**Never run `npm run build` (or `npm run build:web`) while a dev server is running on the same worktree.** Both write to the same `.next`, so the production build overwrites the dev server's chunks and the running site starts serving pages with no CSS at all. It looks like a broken stylesheet, not a build collision. Stop the dev server, build, then `rm -rf apps/web/.next` and restart dev.

For web changes, run `npm run build:web` and `npm run lint` before opening a PR. Web has a small unit-test suite (`npm test` inside `apps/web`, Node's built-in runner; no CI runs it). Mobile has no lint, typecheck, build or working test script (see `apps/mobile/CLAUDE.md`). Verify changes by running the app and/or querying the DB via the Supabase MCP (read-only, see Security).

## The Proximity MCP (`mcp/`)

A local MCP **knowledge server** for this app (`node mcp/src/index.mjs`, registered in `.mcp.json`). It covers `apps/web/src` only, not `apps/mobile` or `packages/*`, and its knowledge can be outdated: CI only opens a sync PR when it drifts, so it can lag until that PR is merged.

- **Resources** (`proximity://…`): `domain`, `db-schema`, `api-routes`, `components`, `pages`, `utils`, `env-vars`, `active-tasks`, `agent-sessions`. Backed by JSON in `mcp/knowledge/`, **committed to git** (shared across machines/agents; regenerate and commit with code changes; on drift, CI opens a sync PR on `staging`/`main`). Only `agent-sessions.json` (local runtime log) stays gitignored.
- **Tools**: `update-knowledge`, `log-task`, `spawn-agents`, `log-agent-step`, `get-agent-status`, `analyze-impact`, `run-impact-tests`. `update-knowledge`, `log-task` and `spawn-agents` write files. What the impact tools do and how to regenerate knowledge are in `apps/web/CLAUDE.md`.
- **Never run `run-impact-tests` against production.** It always sends anonymous mutating requests with an empty body, whatever `allowMutations` says, so use it only against local or staging.
- After editing the MCP server code, restart Claude Code so the updated tools/resources load.

## Security

- No hardcoded secrets: everything via `process.env.*`. Never commit `.env*`. `EXPO_PUBLIC_*` values are embedded in the mobile app bundle, so never put a secret in one.
- Sanitize anything used in file/storage paths; Supabase parameterized calls (`.eq()`, `.in()`, …) are safe — flag string-interpolated SQL.
- Don't leak stack traces / internal schema names in API error responses.
- **Every new `SECURITY DEFINER` function must be locked down in the same migration**: `REVOKE ALL ... FROM PUBLIC, anon, authenticated`, `GRANT EXECUTE ... TO service_role`, and `SET search_path = public, pg_temp`. Postgres makes new functions callable by everyone, and the anon key ships in the browser and mobile bundles, so an unrevoked definer function bypasses RLS for anyone (see `202610220003_lock_down_as_user_rpcs.sql`). A later `CREATE OR REPLACE` keeps the grants but drops the `search_path`, so repeat that line.
- **The Supabase MCP is read-only for both projects** (`supabase-dev` and `supabase-prod` in `.mcp.json`): queries, listing tables, logs and advisors only. Never run writes, DDL or `apply_migration` on either, and never change production data. This is a behavioural rule: the MCP configuration does not currently enforce it, so be especially careful with prod. Do not change the MCP configuration or tokens.
- **Never apply migrations.** You may write migration SQL in `supabase/migrations/`; the user applies it manually, development first and production afterwards. Existing versions are not a clean sequence (mostly 12-digit `YYYYMMDDNNNN`, plus some 14-digit and 8-digit prefixes, with several duplicated), so do not assume the next number: list the directory, choose a version identifier that is unique and sorts after the latest existing one, and never reuse an existing prefix. When you hand it over, give the filename, what it changes, whether it is destructive or idempotent, and the apply order (dev, verify, then prod).
