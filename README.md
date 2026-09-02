# Proximity

Off-campus housing marketplace for university students, starting at WashU. Students browse verified
listings, read reviews written by people who actually lived there, get matched to places by a chat
concierge, and scan a lease for red flags. Landlords post and manage properties and see how they
perform.

**Live:** [useproximity.org](https://useproximity.org) · Deployed on Vercel

---

## Quick start

```bash
git clone git@github.com:UseProximity/Proximity.git
cd Proximity
npm install                       # installs all workspaces

# ask a maintainer for .env.local — put it in the REPO ROOT
# (apps/web/.env.local is a symlink to it; the app and the scripts share one file)

npm run dev:web -- -p 3000        # http://localhost:3000
```

**Local dev must run on port 3000.** `NEXTAUTH_URL` in `.env.local` points at
`http://localhost:3000`, and the dev Cloudflare R2 bucket only allows browser uploads from that
origin. On any other port, login silently bounces and photo uploads fail.

Other commands:

```bash
npm run build:web    # production build — run before opening a PR
npm run lint         # ESLint across all workspaces
```

Node 20+ (24 in use). There is **no unit-test suite** — verify changes by running the app and
querying the database through the Supabase MCP.

---

## Repo map

```
apps/web/            ← the product. Everything real lives here.
  src/app/           Next.js App Router: pages + /api route handlers
  src/components/    React components, grouped by feature
  src/lib/           Server-side domain logic (Supabase, listings, matchmaking, PMS, email…)
  src/utils/         Small pure client-safe helpers (formatters, walk/drive times)
  src/content/washu/ Hand-written SEO landing-page copy (JSON)
  src/auth.js        NextAuth config — the auth entry point
  src/middleware.ts  Edge middleware (injects x-pathname / x-search headers)
  evals/             Offline eval harnesses for the AI features (lease-check, PMS, AEO)

supabase/migrations/ 80+ date-prefixed SQL migrations
scripts/             One-off + recurring ops scripts (prod→dev snapshot, SEO engine, backfills)
mcp/                 Local MCP "knowledge server" — the deep, current docs (see below)
.github/workflows/   CI: knowledge sync, release-PR impact check, snapshot cron

apps/mobile/         ⚠️ SCAFFOLD ONLY — Expo boilerplate; every screen/lib file is `export {}`
packages/            ⚠️ SCAFFOLD ONLY — all 14 files are `export {}`; nothing imports them
```

The monorepo shape (`apps/*` + `packages/*`) was set up in anticipation of a React Native app.
That app was never written. Treat `apps/web` as the whole codebase until someone picks the mobile
work back up.

---

## Where things live

| I want to work on… | Start here |
|---|---|
| Browse page, map, filters | `components/listings/BrowseContent.js` → `AvailableListings.js`, `TopFilterBar.js`, `MapView.js` |
| Listing detail | `app/listings/[id]/` and `components/listings/ListingModalInfo.js` |
| Creating a listing | `app/add-listing/page.js` — forks to `components/listings/add/` (manual) or `wizard/` (import) |
| Subleases | `components/listings/SubleaseFormPanel.js`, `app/add-sublease/` |
| Matchmaking chat | `app/matchmaking/`, `components/matchmaking/`, `lib/matchmaking/` |
| Lease red-flag scanner | `app/lease-check/`, `lib/leaseCheck/` |
| Reviews (listing + dorm) | `app/review/`, `components/reviews/`, `lib/reviews/` |
| Landlord dashboard | `app/dashboard/landlord/` (`_sections/`, `_hooks/`, `_modals/`) |
| Admin tools | `app/dashboard/admin/`, `components/admin/`, `app/api/admin/` |
| PMS integrations (AppFolio, Buildium…) | `lib/pms/` — has its own `README.md` |
| SEO landing pages | `app/washu/[slug]/`, `src/content/washu/*.json`, `lib/seo/` |

`app/api/` mirrors the URL: `/api/landlord/listings/[listingId]` is
`app/api/landlord/listings/[listingId]/route.js`. Most routes carry a header comment explaining
what they do — **the codebase is unusually well-commented, and the comments are accurate. Read
the file header before the code.**

---

## The seven things you need to know

**1. Auth is NextAuth, not Supabase Auth.** `src/auth.js` configures Google OAuth + email/password.
Roles (`student` / `landlord` / `super`) are cached in the JWT and refreshed every 60s. Always read
the role from `session.user.role` — never from `dbUser.role`, which is a foreign-key id.

**2. Database access goes through the service-role client.** `lib/supabase.js` is the admin client
used by API routes; RLS is not the access-control layer here — the route handlers are. Guard every
route explicitly.

**3. User writes go through `lib/supabaseWithUser.js`.** Its RPCs set `app.current_user_id` inside
the same transaction so the `fn_action_log()` trigger can attribute every mutation. Use it for
anything a user initiated; the plain client is for system writes.

**4. There are three environments, switched by `APP_ENV`** (`lib/appEnv.js`):

| | Database + R2 bucket | Outreach (email/Airtable) | Notes |
|---|---|---|---|
| `production` | prod | ON | the real site |
| `staging` | **dev** | **OFF** | Vercel deploy on a prod-data snapshot; shows a banner |
| `development` | **dev** | **OFF** | local |

Never branch on `NODE_ENV` for data or outreach decisions — use `isProdData()` and
`outreachEnabled()`. The resolver is deliberately fail-safe: anything ambiguous resolves to
non-production.

**5. Listings are a four-level tree**, and almost every bug lives in getting it wrong:

```
listing            a building/property (address, amenities, utilities, images)
└── listing_unit   a unit TYPE, e.g. "2BR Corner" — not a physical apartment
    └── unit_lease an OFFERING on that unit: rent, term, furnished, available_from,
                   sublease?, per-person vs whole-unit rent
```

A place is only a real match when **one** offering satisfies price *and* term *and* furnishing.
The canonical query shape is `lib/listings/listingSelect.js`; the browse-side filter rules are
`lib/listings/filterListings.js`.

**6. Any page can open a listing detail modal** by putting `?listing=<id>` in the URL.
`GlobalListingModal`, mounted in the root layout, watches that param. Shareable deep links and
back-button support come free.

**7. Schema migrations must be applied to BOTH the dev and prod Supabase projects.** A migration
file committed to `supabase/migrations/` is *not* applied — a file in the repo has silently broken
production before. Apply it and verify against the live database.

---

## How to ship a change

1. **Refresh the knowledge base first:** `git fetch origin staging` and branch off fresh
   `origin/staging`. `staging` is the trunk — every PR merges there first.
2. Build the change on one branch. One feature = one branch = **one PR** into `staging`.
   Don't stack PRs; use commits for reviewable steps.
3. Run `npm run build:web` and `npm run lint`.
4. Post a test plan and get sign-off before pushing.
5. If you changed a route, component, page, util, env var, or the schema, regenerate the MCP
   knowledge (`node mcp/scripts/generate-knowledge.mjs`) and commit it alongside your code.

No AI attribution in commit messages or PR descriptions.

---

## Deeper docs

The authoritative, machine-generated description of this codebase is the local **`proximity` MCP
server** (`mcp/`, registered in `.mcp.json`). It is regenerated from the source on every push to
`staging`, so it does not go stale the way a hand-written doc does. Read these resources:

| Resource | What it holds |
|---|---|
| `proximity://domain` | Product domain concepts and vocabulary |
| `proximity://db-schema` | All 67 tables, columns, relationships |
| `proximity://api-routes` | Every API route with its auth level |
| `proximity://components`, `://pages`, `://utils` | Full inventories |
| `proximity://env-vars` | Every `process.env.*` the app reads |

It also exposes `analyze-impact` (maps a diff to the pages and endpoints downstream of it) and
`run-impact-tests` (runs that checklist against a running app).

- `CLAUDE.md` — conventions and the working agreement, for humans and coding agents alike.
- `lib/pms/README.md` — the property-management-system integration layer.
- `apps/web/evals/*/README.md` — how to run the AI evals.
- `PMS_APPFOLIO_BRIEF.md` — background on the AppFolio integration.

---

## Stack

Next.js 15 (App Router) · React 18 · Tailwind · plain JavaScript (no TypeScript except
`middleware.ts`) · NextAuth v5 · Supabase Postgres (separate dev + prod projects) · Cloudflare R2 ·
Mapbox GL · Anthropic API (matchmaking, lease-check, listing import) · Nodemailer · Recharts ·
Framer Motion · Vercel.

Conventions: Tailwind only — no CSS modules, no inline styles. Import with the `@/` alias
(`@/components/...`, `@/lib/...`). Keep components small; extract sub-components as they grow.
