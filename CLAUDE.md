# Claude Code Configuration — Proximity

Proximity is an off-campus housing marketplace for WashU (Washington University in St. Louis) students. Live at https://useproximity.org, deployed on Vercel.

This file mirrors the authoritative project knowledge served by the local **`proximity` MCP** (`mcp/`). When in doubt, read the MCP resources (`proximity://domain`, `proximity://db-schema`, `proximity://api-routes`, `proximity://components`, `proximity://pages`, `proximity://utils`, `proximity://env-vars`).

## Working Agreement (how to ship changes)

- **Pull knowledge from `staging` FIRST** — before reading code, planning, or editing anything. `staging` is the trunk (every PR merges there first) and CI keeps `mcp/knowledge/` in sync with it. The MCP serves those files straight from your working tree, so on a stale clone or a long-lived branch it will confidently describe an *older* codebase. Run `git fetch origin staging`; branch off the fresh `origin/staging` for new work, or `git checkout origin/staging -- mcp/knowledge` if you're already mid-branch. Then read the `proximity://` resources. Also check for an open `chore/knowledge-sync-staging` PR — if one exists, `staging` has drifted and that PR holds the newest picture. (`db-schema.json` is hand-maintained and can lag even when current with `staging` — still verify columns against the live DB via the Supabase MCP.)
- **Branch & PR flow**: For every fix/feature, branch off `staging` (e.g. `feat/...`, `fix/...`). Implement the change, then give the user a **test plan and wait for approval** — do not push before approval. After approval, push the branch and open a **PR into `staging`**.
- **One branch, one PR per feature (Wyatt, 2026-08-12)**: keep a single branch open for the whole feature, make multiple commits on it as work lands, and open ONE PR for the entire branch. Never stack PRs and never split one feature across several PRs — commits within the PR provide the reviewable steps. When multiple features are in flight simultaneously (including parallel Claude sessions), give each feature its own branch (use a separate git worktree per feature so sessions don't collide), each ending in its own single PR.
- **Keep knowledge current**: After any substantial architectural change (new/removed/changed API route, component, page, util, env var, DB schema change, or convention), update the MCP knowledge — call the `update-knowledge` tool (and `log-task` for notable decisions), or re-run `node mcp/scripts/generate-knowledge.mjs` to rescan the codebase. Knowledge files (`mcp/knowledge/`, except `agent-sessions.json`) are **committed to git** — commit regenerated knowledge together with your code change so every machine and agent shares it. **`domain.json` is regenerated from a template inside `mcp/scripts/generate-knowledge.mjs`** — edit the script, not the JSON, or your change is wiped on the next run. Only `db-schema.json` and `active-tasks.json` are edited as files.
- **Knowledge-sync CI** (`update-knowledge.yml`): on pushes to `staging`/`main` that touch `apps/web/src/**`, it regenerates knowledge and, if it drifted, **opens a PR** (`chore/knowledge-sync-<base>`) rather than pushing — both branches are protected and Actions can't be given a ruleset bypass. So regenerated files aren't on `staging` until that PR is merged. Committing knowledge with your own change keeps it from ever opening.
- **No AI attribution in git**: Never add a "Co-Authored-By: Claude" trailer or a "Generated with Claude Code" footer to commit messages or PR descriptions — write them as a normal contributor would.
- Do what's asked — nothing more, nothing less. Prefer editing existing files over creating new ones. Don't create docs/README files unless asked.
- Always read a file before editing it. Never commit secrets, credentials, or `.env*` files.

## Conventions

- **Local dev runs on `localhost:3000`** (`npm run dev -- -p 3000`): `NEXTAUTH_URL` in `.env.local` must match the served origin or login silently bounces, and the dev R2 bucket's CORS policy allows browser photo uploads from `http://localhost:3000` only — any Cloudflare R2 testing must happen on 3000 (Wyatt, 2026-08-12).
- Plain JavaScript everywhere (no TypeScript except `middleware.ts`); Tailwind CSS only — no CSS modules, no inline styles.
- Use the `@/` path alias (`@/components/...`, `@/lib/...`, `@/utils/...`). Keep components reasonably small; extract sub-components when they grow.
- API/auth/DB conventions live in `.claude/rules/api.md` (auto-loads when working under `src/`). One rule worth repeating: **schema migrations always go to BOTH dev and prod.**

## Environments (`src/lib/appEnv.js`)

Three environments, distinguished by **`APP_ENV`** (falls back to `NODE_ENV` when unset):

- **production** — the real site (useproximity.org): prod DB, prod R2 bucket, outreach ON.
- **staging** — Vercel staging deploy (`APP_ENV=staging`): **dev DB + dev bucket, outreach OFF**, shows a banner. A sandbox on a prod-data snapshot.
- **development** — local.

Use the helpers — don't check `NODE_ENV` directly for data/outreach decisions:
- `isProdData()` — selects prod vs dev DB/bucket (used by `supabase.js`, `upload`, `streetview`).
- `outreachEnabled()` — gate all external outreach (email, Airtable, Formspree) behind this.
- `isStaging()` — staging-only UI (e.g. `StagingBanner`).

The dev snapshot is refreshed by `scripts/snapshot-prod-to-dev.sh` (clones prod `public` → dev, stamps `app_metadata.snapshot_taken_at`).

## Build & Test

```bash
npm run dev      # local dev server
npm run build    # production build (/sitemap.xml is a dynamic route: src/app/sitemap.js)
npm run lint     # ESLint
```

Run `npm run build` (and `npm run lint`) before opening a PR. There is no unit-test suite; verify changes by running the app and/or querying the DB via the Supabase MCP.

## The Proximity MCP (`mcp/`)

A local MCP **knowledge server** for this app (`node mcp/src/index.mjs`, registered in `.mcp.json`).

- **Resources** (`proximity://…`): `domain`, `db-schema`, `api-routes`, `components`, `pages`, `utils`, `env-vars`, `active-tasks`, `agent-sessions`. Backed by JSON in `mcp/knowledge/` — **committed to git** (shared across machines/agents; regenerate and commit with code changes; CI syncs drift on `staging`/`main`). Only `agent-sessions.json` (local runtime log) stays gitignored.
- **Tools**: `update-knowledge`, `log-task`, `spawn-agents`, `log-agent-step`, `get-agent-status`, `analyze-impact`, `run-impact-tests`.
- **`analyze-impact`**: maps a set of code changes to the testable surfaces they affect. Builds a reverse-dependency graph of `src/` and walks outward from each changed file to find every API endpoint and page downstream of it (directly or via shared components/libs/utils); also maps DB migration changes to routes querying the affected tables. Returns an impact report + suggested test checklist. Inputs: `base` (default `staging`), optional `head` ref, or an explicit `files` list (for CI).
- **`run-impact-tests`**: executes the `analyze-impact` checklist against a running app (`baseUrl`, default `http://localhost:3000`; point at a deployment to test it). Endpoints are judged by auth level — public must respond without crashing; guarded routes must reject anonymous calls (401/403). If test credentials are present in `.env.test.local` (gitignored: `TEST_SESSION_COOKIE`, or `TEST_EMAIL`/`TEST_PASSWORD` + `TEST_ROLE`), it also logs in and verifies guarded **reads** work for a real user. Authenticated **mutations** are skipped unless `allowMutations:true` — leave OFF against a prod-backed environment (real writes/emails).
- **Prompts**: scaffold/debug routes, components, pages, auth; plus role briefings.
- **Regenerate knowledge**: `node mcp/scripts/generate-knowledge.mjs` (rescans `src/` for routes, components, pages, utils, env vars; `db-schema.json` is hand-maintained against the live DB).
- After editing the MCP server code, restart Claude Code so the updated tools/resources load.

## Security

- No hardcoded secrets — everything via `process.env.*`. Never commit `.env*`.
- Sanitize anything used in file/storage paths; Supabase parameterized calls (`.eq()`, `.in()`, …) are safe — flag string-interpolated SQL.
- Don't leak stack traces / internal schema names in API error responses.
