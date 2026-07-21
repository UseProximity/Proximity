# PMS sync — setup runbook

One-time setup for the PMS freshness integration (`apps/web/src/lib/pms/`,
`/api/landlord/pms/*`, `/api/cron/pms-sync`). Everything in this file is a
**manual step** — the code is already wired and does nothing until these are done.

## 1. Create the Nango account (~10 min, free)

1. Sign up at https://app.nango.dev (free tier: 10 connections, 100k requests/mo —
   plenty for launch; ~$1/extra connection after).
2. In **Environment settings**, copy the **secret key** for each environment you
   set up (Nango has separate dev/prod environments — use dev for staging).

## 2. Configure the three integrations in the Nango dashboard

Integration IDs must match the code's provider config keys (or override via env):

| Provider | Nango integration ID | How |
| --- | --- | --- |
| Buildium | `buildium` | Pre-built provider — just enable it. API-key auth (`x-buildium-client-id` / `x-buildium-client-secret`) is already configured. |
| AppFolio | `appfolio` | **Custom API config.** Base URL `https://${connectionConfig.subdomain}.appfolio.com`, auth = Basic. Add a required connection-config field `subdomain` so the Connect UI collects it (the landlord's `{subdomain}.appfolio.com`). |
| DoorLoop | `doorloop` | **Custom API config.** Base URL `https://app.doorloop.com/api`, auth = API key sent as `Authorization: bearer ${apiKey}`. |

If you name them differently, set `NANGO_BUILDIUM_KEY` / `NANGO_APPFOLIO_KEY` /
`NANGO_DOORLOOP_KEY` to the IDs you chose.

## 3. Environment variables

Add to **both Vercel environments** (Production + Preview) and `.env.local`:

| Var | Value | Notes |
| --- | --- | --- |
| `NANGO_SECRET_KEY` | from step 1 | server-only; prod key on Production, dev key on Preview/staging |
| `NANGO_HOST` | *(omit)* | only for self-hosted Nango |
| `NANGO_*_KEY` overrides | *(omit)* | only if integration IDs differ from the defaults |

`CRON_SECRET` already exists (landlord-nudge uses it); the new
`/api/cron/pms-sync` cron (daily 9:00 UTC, in `apps/web/vercel.json`) reuses it.

## 4. Sandbox verification before real landlords

1. **Buildium**: Premium includes one free sandbox account — create API keys in
   it (Settings → API keys), connect through the dashboard's **PMS Sync** section
   on staging, and confirm: discover shows the sandbox properties → confirm →
   listings created (dev DB) → `curl -H "Authorization: Bearer $CRON_SECRET" 
   https://<staging>/api/cron/pms-sync` applies availability. Lease a unit in the
   sandbox and re-run the cron: the unit's type flips unavailable and
   `pms_sync_events` logs it.
2. **AppFolio/DoorLoop**: no free sandbox — verify with the first friendly
   landlord's account on staging (read-only, zero risk to their data).

## 5. Prod rollout

Enable Buildium for 1–2 friendly landlords, watch `pms_sync_events` +
`pms_connections.last_sync_status` for a few cycles, then broaden. Swing-guard
holds land in `pms_review_queue` (`reason='swing_guard_hold'`) — resolve by
checking what actually changed in the landlord's PMS.

## Landlord plan requirements (sales-call checklist)

API access is plan-gated on the landlord's side — ask before promising sync:

- **Buildium**: Premium plan ($400/mo) — Essential/Growth have no API.
- **AppFolio**: Plus or Max (Reporting API; read-only is enough). Core has none.
- **DoorLoop**: Premium plan.
- Anyone else (Innago/Avail/TurboTenant/…): no usable API — stays on the
  landlord-nudge email flow.

## Not built yet (deliberately deferred)

- **Scrape connectors** for walled systems (Yardi RentCafe / RealPage OneSite /
  Entrata) — signal-only + review queue, per the brief. Revisit when a target
  landlord actually uses one.
- **Admin review-queue UI** — swing holds are visible in the `pms_review_queue`
  table (dev/prod toggle in the admin dashboard's SQL access or Supabase
  dashboard) until a dedicated screen exists.
- **Landlord stale-confirm email** (replaces the bi-weekly blast for non-API
  landlords) — the current landlord-nudge cron still covers them.
