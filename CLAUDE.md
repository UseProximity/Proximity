# Claude Code Configuration — Proximity

Proximity is an off-campus housing marketplace for WashU (Washington University in St. Louis) students. Live at https://useproximity.org, deployed on Vercel.

This file mirrors the authoritative project knowledge served by the local **`proximity` MCP** (`mcp/`). When in doubt, read the MCP resources (`proximity://domain`, `proximity://db-schema`, `proximity://api-routes`, `proximity://components`, `proximity://pages`, `proximity://utils`, `proximity://env-vars`).

## Working Agreement (how to ship changes)

- **Branch & PR flow**: For every fix/feature, branch off `staging` (e.g. `feat/...`, `fix/...`). Implement the change, then give the user a **test plan and wait for approval** — do not push before approval. After approval, push the branch and open a **PR into `staging`**.
- **Keep knowledge current**: After any substantial architectural change (new/removed/changed API route, component, page, util, env var, DB schema change, or convention), update the MCP knowledge — call the `update-knowledge` tool (and `log-task` for notable decisions), or re-run `node mcp/scripts/generate-knowledge.mjs` to rescan the codebase.
- Do what's asked — nothing more, nothing less. Prefer editing existing files over creating new ones. Don't create docs/README files unless asked.
- Always read a file before editing it. Never commit secrets, credentials, or `.env*` files.

## Tech Stack

- **Framework**: Next.js 15 (App Router), React 18 — plain JavaScript (no TypeScript except `middleware.ts`)
- **Styling**: Tailwind CSS 3 only (no CSS modules, no inline styles)
- **Auth**: NextAuth v5 (beta) — Google OAuth + email/password, JWT strategy
- **DB**: Supabase (PostgreSQL). Two projects: **dev** and **prod**
- **File storage**: Cloudflare R2 (S3-compatible) via `src/lib/r2.js`
- **Maps**: Mapbox GL + Leaflet (geocoding + walk times); Google Street View Static API for default listing photos
- **Email**: Nodemailer (SMTP)
- **UI libs**: Radix UI, Lucide React, Framer Motion, Recharts, @chatscope/chat-ui-kit-react

## Source Layout

All app code lives under `src/`:

- `src/app` — App Router. Pages are `page.js`; API routes are `src/app/api/<path>/route.js`
- `src/components` — React components (`.js` / `.jsx`)
- `src/lib` — server/shared libraries (`supabase.js`, `r2.js`, `streetview.js`, `email.js`, …)
- `src/utils` — helpers (`walkTimes.js`, `listingFormatters.js`, `analytics.js`, …)
- `supabase/migrations` — SQL migrations
- `mcp/` — the Proximity knowledge MCP server (see below)

Use the `@/` path alias (`@/components/...`, `@/lib/...`, `@/utils/...`). Keep components reasonably small; extract sub-components when they grow.

## Roles & Auth

`session.user.role` is one of `"student" | "landlord" | "super"`.

- **student** (default for new sign-ups): browse/search, save, review, matchmaking, contact landlords, create subleases.
- **landlord**: create/manage listings, view metrics dashboard, receive contact emails.
- **super**: everything, plus `/api/admin/*` and the dev/prod DB toggle.

```js
import { auth } from "@/auth";
const session = await auth();
if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
// super-only:
if (!session || session.user.role !== "super") return Response.json({ error: "Forbidden" }, { status: 403 });
```

Session shape: `session.user.{id, email, role, name, profileComplete}`. `profileComplete=false` triggers the profile-completion modal.

## DB Access

```js
import supabase from "@/lib/supabase";                 // default: targets dev/prod by NODE_ENV
import { getSupabaseClient } from "@/lib/supabase";     // pass "dev"|"prod" for admin dev/prod toggle
```

- Columns are **snake_case** in Supabase; convert to **camelCase** in the JS layer.
- Aggregate listing columns (`min_rent`, `max_rent`, bedroom/bath ranges, etc.) are maintained by DB triggers — don't set them by hand.
- **Schema migrations must be applied to BOTH dev and prod** (via the `supabase-dev` and `supabase-prod` MCP tools, or matching `apply_migration` calls). Verify columns against the live DB before changing schema-related code.

## API Conventions

- Routes live at `src/app/api/<path>/route.js`; export `GET`/`POST`/`PATCH`/`PUT`/`DELETE`.
- Respond with `Response.json(...)`; use `NextResponse.json(...)` only when you need custom status/headers.
- Error shape: `{ error: "message" }` with an appropriate HTTP status.
- Validate user input at the boundary; never trust client-supplied role claims.
- Listing images live in `listing_images` (URL in R2, `sort_order`, `source`). `source = 'street_view'` marks auto-fetched Street View photos; `null` = user upload. `sort_order 0` is the cover.

## Build & Test

```bash
npm run dev      # local dev server
npm run build    # production build (also runs next-sitemap)
npm run lint     # ESLint
```

Run `npm run build` (and `npm run lint`) before opening a PR. There is no unit-test suite; verify changes by running the app and/or querying the DB via the Supabase MCP.

## The Proximity MCP (`mcp/`)

A local MCP **knowledge server** for this app (`node mcp/src/index.mjs`, registered in `.mcp.json`).

- **Resources** (`proximity://…`): `domain`, `db-schema`, `api-routes`, `components`, `pages`, `utils`, `env-vars`, `active-tasks`, `agent-sessions`. Backed by JSON in `mcp/knowledge/` (gitignored, auto-generated).
- **Tools**: `update-knowledge`, `log-task`, `spawn-agents`, `log-agent-step`, `get-agent-status`.
- **Prompts**: scaffold/debug routes, components, pages, auth; plus role briefings.
- **Regenerate knowledge**: `node mcp/scripts/generate-knowledge.mjs` (rescans `src/` for routes, components, pages, utils, env vars; `db-schema.json` is hand-maintained against the live DB).
- After editing the MCP server code, restart Claude Code so the updated tools/resources load.

## Security

- No hardcoded secrets — everything via `process.env.*`. Never commit `.env*`.
- Sanitize anything used in file/storage paths; Supabase parameterized calls (`.eq()`, `.in()`, …) are safe — flag string-interpolated SQL.
- Don't leak stack traces / internal schema names in API error responses.
