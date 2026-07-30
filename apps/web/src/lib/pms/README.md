# PMS sync — setup runbook

One-time setup for the PMS freshness integration (`apps/web/src/lib/pms/`,
`/api/landlord/pms/*`, `/api/cron/pms-sync`). Everything in this file is a
**manual step** — the code is already wired and does nothing until these are done.

## 1. Create the Nango account (~10 min, free)

1. Sign up at https://app.nango.dev (free tier: 10 connections, 100k requests/mo —
   plenty for launch; ~$1/extra connection after).
2. In **Environment settings**, copy the **secret key** for each environment you
   set up (Nango has separate dev/prod environments — use dev for staging).

## 2. Configure the four integrations in the Nango dashboard

Integration IDs must match the code's provider config keys (or override via env):

| Provider | Nango integration ID | How |
| --- | --- | --- |
| Buildium | `buildium` | Pre-built provider — just enable it. API-key auth (`x-buildium-client-id` / `x-buildium-client-secret`) is already configured. |
| AppFolio | `appfolio` | Use Nango's **`private-api-basic`** template. See the AppFolio note below — the earlier "custom API config" instructions here described a Nango feature that does not exist. |
| DoorLoop | `doorloop` | **Custom API config.** Base URL `https://app.doorloop.com/api`, auth = API key sent as `Authorization: bearer ${apiKey}`. |
| Rentec Direct | `rentec` | **Custom API config.** Base URL `https://secure.rentecdirect.com/api/v3`, auth = API key sent as header `X-API-Key: ${apiKey}`. The landlord generates a **read-scoped** key at Settings → Tools → Utilities → API Keys (free on Pro/PM; it's a Rentec Labs feature — they may need to enable Labs). |

If you name them differently, set `NANGO_BUILDIUM_KEY` / `NANGO_APPFOLIO_KEY` /
`NANGO_DOORLOOP_KEY` / `NANGO_RENTEC_KEY` to the IDs you chose.

### AppFolio specifically (read before setting it up)

AppFolio is **not** in Nango's provider catalog, and Nango Cloud has **no self-serve
"custom API" wizard** — so there is no per-integration base URL to configure. Full
reasoning in `PMS_APPFOLIO_BRIEF.md` §3.6, which is authoritative for this connector.

1. Create the `appfolio` integration from the **`private-api-basic`** template
   (auth mode BASIC). Leave its placeholder base URL alone — it is overridden on
   every request by the `Base-Url-Override` header that `nango.js` sends.
2. There is **no** `subdomain` field in Nango's Connect UI and none is needed. The
   landlord enters their database name in *our* pre-connect step; it is stored in
   `pms_connections.credential_meta` (not a secret — it is the same subdomain that
   serves their public listings page) and reused by the nightly cron.
3. The credential mapping is **Client ID → Username, Client Secret → Password**.
   Nango's window shows the generic labels "Username"/"Password", so the
   instructional copy next to the Connect button is load-bearing, not decoration.
4. `private-api-basic` has no verification block, so Nango will happily create a
   "successful" connection from a typo'd secret. `/api/landlord/pms/discover` guards
   this: it calls `verifyConnection()` and refuses to save the connection unless a
   real `unit_directory` call succeeds. Keep that ordering — it is the only thing
   turning a bad credential into an error the landlord sees at connect time rather
   than a 401 in the cron at 09:00 UTC.

The landlord needs three strings — database/subdomain, Client ID, Client Secret —
and an AppFolio **Plus or Max** plan. Core has no API at all.

## 3. Environment variables

Add to **both Vercel environments** (Production + Preview) and `.env.local`:

| Var | Value | Notes |
| --- | --- | --- |
| `NANGO_SECRET_KEY` | from step 1 | server-only; prod key on Production, dev key on Preview/staging |
| `NANGO_HOST` | *(omit)* | only for self-hosted Nango |
| `NANGO_*_KEY` overrides | *(omit)* | only if integration IDs differ from the defaults |

`CRON_SECRET` already exists (landlord-nudge uses it); the new
`/api/cron/pms-sync` cron (daily 9:00 UTC, in `apps/web/vercel.json`) reuses it.

## 3.5 Demo mode — test the whole flow with NO PMS account

On staging and local (never production), the dashboard's **PMS Sync** section
shows a **Demo mode** card. Clicking it runs the real discover → confirm → sync
pipeline against sample WashU-area properties (Clemens Ave, Pershing Ave, plus
a downtown one to demo the radius filter) — no Nango, no Buildium.

Full walkthrough:
1. Sign in as a landlord → Dashboard → **PMS Sync** → **Try the demo**.
2. Discover screen: 3 properties, one flagged "Outside the WashU area".
   Choose "Add as a new listing" for the near ones → **Confirm and start syncing**.
3. Two listings appear (dev DB) with Street View covers, the red **LIVE** pill,
   and the "straight from the landlord's own system" banner.
4. Run the sync: `curl -H "Authorization: Bearer $CRON_SECRET" <base>/api/cron/pms-sync`
   → `pms_sync_events` logs per-listing results; `last_verified_at` refreshes.
5. Simulate a lease-up: set env `PMS_MOCK_LEASED="1A,2B"` (Vercel env or local
   shell), re-run the cron → those units flip unavailable (when all units of a
   listing are taken, the whole listing shows "unavailable" — never deleted).
   Clear the env var and re-run → they relist.
6. Disconnect from the dashboard → badge disappears, listings stay.

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
- **Rentec Direct**: Pro or PM plan (~$45/mo) — the API itself is **free**, no
  per-request charges. Cheapest full-API path we support.
- Anyone else (Innago/Avail/TurboTenant/…): no usable API — stays on the
  landlord-nudge email flow.

## Not built yet (deliberately deferred)

- **Scrape connectors** for walled systems (Yardi RentCafe / RealPage OneSite /
  Entrata) — signal-only + review queue, per the brief. Revisit when a target
  landlord actually uses one.
- **Admin review-queue UI** — swing holds are visible in the `pms_review_queue`
  table (dev/prod toggle in the admin dashboard's SQL access or Supabase
  dashboard) until a dedicated screen exists.

## Built alongside (not PMS-specific)

- **One-click "still available?" email** (`lib/availabilityCheck.js`,
  `/api/availability/confirm`, `/api/cron/availability-check` daily 16:00 UTC):
  the backstop for every landlord WITHOUT a PMS — stale live listings
  (unverified >30d) get signed Yes/No links resolving without login; "No"
  hides the listing, "Yes" restamps `last_verified_at`. Per-listing 14-day
  cool-down via `listings.availability_email_sent_at`. Links are HMAC-signed
  with `AVAILABILITY_LINK_SECRET` (falls back to `AUTH_SECRET`).
