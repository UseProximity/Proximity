# Proximity

Off-campus housing marketplace for university students, starting at WashU. Students browse listings, read reviews, answer a short series of questions to get matched to places, and scan a lease for red flags. Landlords post and manage properties and see how they perform.

**Live:** [useproximity.org](https://useproximity.org), deployed on Vercel.

---

## What is in this repo

An npm workspaces monorepo: a Next.js web app that is also the backend, and an Expo mobile app that calls it.

| Path | What it is |
|---|---|
| `apps/web` | Next.js 15 site and the only backend: pages, `/api` routes, cron jobs, auth, database access |
| `apps/mobile` | Expo (React Native) app for iOS and Android |
| `packages/shared`, `packages/auth-core` | Code used by both apps |
| `packages/api-client` | Client for the web API, used by the mobile app |
| `supabase/migrations` | SQL migrations. Committing one does not apply it (see Database) |
| `scripts/` | Ops scripts: prod to dev snapshot, SEO engine, backfills |
| `mcp/` | Local MCP knowledge server for Claude Code (optional) |
| `docs/` | Background docs |
| `.github/workflows/` | CI: knowledge sync, release PR check, weekly snapshot |

---

## Set up

You need:

- **Node** 20.19.4+ (20.x), 22.13+ (22.x), 24.3+ (24.x) or 25+. This is the React Native 0.85 range. CI uses Node 20.
- **Access** to the GitHub repo and the development environment values below. Ask Simão or Wyatt for `apps/web/.env.local` and `apps/mobile/.env.local`. They will send you both files.
- **For mobile:** the tools for a local development build. Follow Expo's [Set up your environment](https://docs.expo.dev/get-started/set-up-your-environment/) guide and choose "Development build". Expo Go does not work.

```bash
git clone git@github.com:UseProximity/Proximity.git
cd Proximity
git switch staging     # web and backend work. For mobile-only work: git switch mobile
npm install            # all workspaces; a postinstall step patches three Expo plugins
npm ci --prefix mcp    # optional, only for the Claude Code MCP server
```

### Environment files

Values are not in the repo and must never be committed. Each app reads its own file.

**Web: `apps/web/.env.local`** (names only):

| For | Names |
|---|---|
| Dev database (the web app errors on load without `DEV_SUPABASE_URL` and `DEV_SUPABASE_SERVICE_KEY`) | `DEV_SUPABASE_URL`, `DEV_SUPABASE_SERVICE_KEY`, `DEV_SUPABASE_DEFAULT_KEY` |
| Chat realtime | `DEV_SUPABASE_JWT_SECRET` |
| Login | `AUTH_SECRET`, `NEXTAUTH_URL` (`http://localhost:3000`), `GOOGLE_ID`, `GOOGLE_SECRET` |
| Photo uploads (Cloudflare R2) | `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_BASE_URL` |
| Email | `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASS` |
| Map and AI features | `NEXT_PUBLIC_MAPBOX_TOKEN`, `ANTHROPIC_API_KEY` |
| Only to run the mobile app against your local web server | `MOBILE_JWT_SECRET`, `APPLE_BUNDLE_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_TEAM_ID`, `GOOGLE_ANDROID_CLIENT_ID`, `GOOGLE_IOS_CLIENT_ID` |
| Optional | `APP_ENV` (defaults to `development` on your machine) |

Other features read more variables: search `process.env` in `apps/web/src`. The `PROD_*` variables are for production scripts only.

**Mobile: `apps/mobile/.env.local`.** Simão or Wyatt sends this file; `apps/mobile/.env.example` shows its shape. Names: `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_DEFAULT_KEY`, `EXPO_PUBLIC_MAPBOX_TOKEN`, `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, and optionally `EXPO_PUBLIC_TEST_EMAIL_TO`. They ship inside the app, so use public values only. Use the staging API and the dev Supabase project (the one that API uses). The app uses Supabase only for chat realtime, which is why it needs the Supabase values.

**Repo root `.env.local`:** not used by either app. Only two one-off production scripts read it, from the directory you run them in. The snapshot script reads `.env.snapshot.local` and the MCP impact tests read `.env.test.local`, both at the root.

---

## Run the web app

```bash
npm run dev -w apps/web -- -p 3000     # http://localhost:3000
```

Use port 3000. `NEXTAUTH_URL` and the dev R2 bucket are set up for that address, so login and photo uploads only work there. `npm run dev:web` alone can end up on 3001.

It works when the terminal shows `Ready` and `Local: http://localhost:3000`, and the browser shows the Proximity home page.

---

## Run the mobile app

1. Put `apps/mobile/.env.local` in place (above).
2. First run, and after native changes: in `apps/mobile`, run `npm run ios` or `npm run android`. It builds the development build, installs it, opens it and starts Metro. Leave it running. The build generates the native folders (`ios/`, `android/`), which are not committed.
3. Later runs, with no native changes: from the repo root, run `npm run dev:mobile`, then open the installed app.

It works when the app opens on the Browse tab (no login needed) and the terminal keeps showing Metro logs.

To use your local web server, set `EXPO_PUBLIC_API_URL` to `http://<your LAN IP>:3000`. A phone cannot reach `localhost`.

### Which API a mobile build uses

The purpose of a build decides its backend. The values are fixed at build time, from the Expo environment named like the EAS profile in `apps/mobile/eas.json`:

| Build | EAS profile | API | Database |
|---|---|---|---|
| Local development build | `development` | staging (default in `.env.local`) | dev |
| Testing, including internal TestFlight | `preview`, `testflight` | staging | dev |
| App Store release | `production` | production | production |

This is the intended policy. The values in each Expo environment are not in the repo. There are no over-the-air updates: every change ships as a new build. Details are in `apps/mobile/CLAUDE.md`.

---

## Check your work

```bash
npm run build:web          # production build, run before opening a PR
npm run lint               # ESLint; only the web app has a lint script
cd apps/web && npm test    # Node test runner; CI does not run it
```

Mobile has no lint, typecheck or working test script yet. Check it on a development build.

---

## Environments

The web app is switched by `APP_ENV` (`apps/web/src/lib/appEnv.js`):

- `production`: prod database and R2 bucket, outgoing email on. The real site.
- `staging`: dev database and bucket, email off. A Vercel deploy on a prod-data snapshot, with a banner.
- `development`: dev database and bucket, email off. Your machine.

---

## Database and migrations

There are two Supabase projects, dev and prod, and no local database. Committing a file to `supabase/migrations/` does **not** apply it. Apply it by hand to both projects, dev first.

---

## Working on a change

- Web, backend and shared code: branch off `staging`, open the PR into `staging`.
- Mobile-only code (`apps/mobile`, `packages/api-client`): branch off `mobile`, open the PR into `mobile`.
- One feature, one branch, one PR. Post a test plan before pushing.
- `CLAUDE.md` has the full workflow, including Vercel preview builds.

---

## Where things live

| I want to work on... | Start here |
|---|---|
| Browse page, map, filters | `components/listings/BrowseContent.js`, then `AvailableListings.js`, `TopFilterBar.js`, `MapView.js` |
| Listing detail | `app/listings/[id]/` and `components/listings/ListingModalInfo.js` |
| Creating a listing | `app/add-listing/page.js`, forks to `components/listings/add/` (manual) or `wizard/` (import) |
| Subleases | `components/listings/SubleaseFormPanel.js`, `app/add-sublease/` |
| Matchmaking | `app/matchmaking/`, `components/matchmaking/`, `lib/matchmaking/` |
| Lease red-flag scanner | `app/lease-check/`, `lib/leaseCheck/` |
| Reviews (listing + dorm) | `app/review/`, `components/reviews/`, `lib/reviews/` |
| Landlord dashboard | `app/dashboard/landlord/` (`_sections/`, `_hooks/`, `_modals/`) |
| Admin tools | `app/dashboard/admin/`, `components/admin/`, `app/api/admin/` |
| PMS integrations (AppFolio, Buildium...) | `lib/pms/`, has its own `README.md` |
| SEO landing pages | `app/washu/[slug]/`, `src/content/washu/*.json`, `lib/seo/` |
| Mobile screens and components | `apps/mobile/app/` (routes), `apps/mobile/src/` |
| Mobile API calls | `packages/api-client/src/resources/`, `apps/mobile/src/lib/apiClient.js` |

Web paths are under `apps/web/src/`. `app/api/` mirrors the URL: `/api/landlord/listings/[listingId]` is `app/api/landlord/listings/[listingId]/route.js`. Read a route's header comment before its code.

Worth knowing:

- **Listings are a three-level tree**: `listings` (a building), `listing_units` (a unit type, not a physical apartment), `unit_leases` (an offering: rent, term, furnished, availability). A place matches only when one offering fits price, term and furnishing. See `lib/listings/listingSelect.js` and `filterListings.js`.
- **Any web page can open a listing modal** with `?listing=<id>`. `GlobalListingModal`, in the root layout, watches that parameter.

---

## Claude Code and the MCP server (optional)

Claude Code reads `CLAUDE.md`. The `proximity` MCP server (`mcp/`) covers `apps/web` only and can lag the code. The Supabase servers in `.mcp.json` need `SUPABASE_ACCESS_TOKEN` in your shell.

## More docs

- `CLAUDE.md`, `apps/web/CLAUDE.md`, `apps/mobile/CLAUDE.md`
- `apps/web/src/lib/pms/README.md`: the property-management-system integration layer
- `apps/web/evals/*/README.md`: how to run the AI evals
- `docs/PMS_APPFOLIO_BRIEF.md`: background on the AppFolio integration
- `apps/mobile/design-system/MASTER.md`: mobile UI rules

## Stack

Web: Next.js 15 (App Router), React 18, Tailwind, NextAuth v5, Supabase Postgres (separate dev and prod projects), Cloudflare R2, Mapbox GL, Anthropic API, Nodemailer, Vercel. Mobile: Expo SDK 56, React Native 0.85, expo-router, NativeWind. Plain JavaScript in both.
