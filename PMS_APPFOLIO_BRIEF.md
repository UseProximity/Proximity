# Execution Brief — PMS v3: AppFolio First

> **Read this cold.** It is written for a session with **zero prior context**. It supersedes
> the AppFolio/Nango setup instructions in `apps/web/src/lib/pms/README.md` §2 and the
> provider assumptions in `PMS_COVERAGE_BRIEF.md` §3. Where they disagree, this file wins.
>
> **Why this exists:** AppFolio is the single most important connector — **most of
> Proximity's landlords use AppFolio** — and the previously-written setup instructions for it
> describe a Nango feature that does not exist. This brief corrects that, and folds in
> research findings that change several earlier decisions.

---

## 0. How to work this brief

### 0.1 Working agreement (from repo `CLAUDE.md` — follow exactly)

- Branch is **`feat/pms-integration`**, off `origin/staging`. **14 commits, unpushed.**
- Implement → **give a test plan → WAIT for approval before pushing.** PRs target `staging`.
- **No AI attribution** in commits or PR descriptions.
- Migrations go to **BOTH dev and prod** via the `supabase-dev` / `supabase-prod` MCP tools.
- Regenerate MCP knowledge (`node mcp/scripts/generate-knowledge.mjs`) when routes/components/
  utils/env vars change; commit it with the code.
- Plain JS + Tailwind. `@/` path alias. Never commit secrets.
- Run `npm run lint` and `npm run build` before every PR.
- **No em dashes in landlord- or student-facing copy.** (Standing instruction from Ben.)

### 0.2 Commands

```bash
cd apps/web
node evals/pms/run.mjs            # 47 checks, no env required
npm run lint

# Build without real Supabase credentials:
DEV_SUPABASE_URL="https://placeholder-dev.supabase.co" \
DEV_SUPABASE_SERVICE_KEY="placeholder" \
DEV_SUPABASE_DEFAULT_KEY="placeholder" \
PROD_SUPABASE_URL="https://placeholder-prod.supabase.co" \
PROD_SUPABASE_SERVICE_KEY="placeholder" \
PROD_SUPABASE_DEFAULT_KEY="placeholder" \
npm run build
```

Local dev runs on **port 3001**. Demo landlord login (dev DB only):
`staging-test+landlord@useproximity.org` / `ProxLocal!2026`

⚠️ **Never run `npm run build` while `npm run dev` is running** — they share `.next/` and the
build corrupts the dev server (symptom: every page 500s). Fix: `rm -rf .next` and restart dev.

### 0.3 Verify, don't trust

Vendor facts here were researched **2026-07-22** with confidence levels. Anything marked
*Low* or ⚠️ must be re-confirmed before building on it.

---

## 1. What already exists (don't rebuild it)

### Schema — applied to **BOTH dev and prod**
- `20260721090000_create_pms_tables.sql` — `pms_connections`, `pms_links`, `pms_sync_events`,
  `pms_review_queue`; `listings.pms_connection_id` + `pms_stale_flagged_at`; revived
  `last_verified_at/by/source`. RPCs `rpc_pms_apply`, `rpc_pms_mark_verified`,
  `rpc_pms_ingest_listing`.
- `20260721190000_pms_guards_rentec_availability_email.sql` — CHECK that `provider='scrape'`
  implies `auto_apply=false`; provider CHECK includes `rentec`;
  `listings.availability_email_sent_at`.
- `20260722100000_pms_integration_requests.sql` — `pms_integration_requests` (landlord
  requests for unsupported systems).

### Code
- **Connector layer** `apps/web/src/lib/pms/`: `types.js` (normalized shapes + coercions),
  `httpRetry.js`, `nango.js`, `index.js` (registry), `mapping.js` (physical units →
  floor-plan types + pre-leasing horizon), `ingest.js`, `mock.js` (demo mode),
  `buildium.js`, `appfolio.js`, `doorloop.js`, `rentec.js`, `README.md`.
- **Routes**: `api/landlord/pms/{connect-session,discover,confirm,links,connect,request-integration}`,
  `api/cron/pms-sync` (daily 09:00 UTC), `api/availability/confirm`,
  `api/cron/availability-check` (daily 16:00 UTC). Crons in `apps/web/vercel.json`, guarded by
  `CRON_SECRET`.
- **UI**: `app/dashboard/landlord/_sections/IntegrationsSection.js`; LIVE badge + trust banner
  in `components/listings/ListingModalInfo.js` and `MapPopupCard.js`.
- **Evals**: `apps/web/evals/pms/run.mjs` — **47 checks, green**, fully offline.

### Design invariants that must survive
- **PMS is the source of truth, ILS-feed style.** Every property/unit keyed by the PMS's
  permanent ID (`pms_links`), never fuzzy address matching. Each sync is a full snapshot.
- **`available: null` means unknown → do nothing.**
- **A broken pull must never reconcile.** Empty snapshot + errors aborts that connection.
- **A degraded pull must never delist.** If `snapshot.errors` is non-empty, delists are
  suppressed and held for review (relists/updates still apply).
- **±20% swing guard** + **mass-delist guard** (counts intended delists, not just units
  entering/leaving the snapshot).
- **Never overwrite the landlord's description or photos.**
- **Reviews are never destroyed.** A listing is only soft-deleted on `exclude` when it was
  PMS-ingested AND has zero reviews; anything with reviews is detached and stays live. The
  review-count check **fails closed** (a failed query counts as "has reviews").
- **All writes go through the audit-safe RPCs** as the system actor
  `00000000-0000-0000-0000-000000000001`.

### Already verified working (live E2E against dev DB, 2026-07-22)
- Ingest reuse (re-running `ingest` does not duplicate a listing).
- `exclude` of a review-less ingested listing → soft-deleted.
- `exclude` of a listing **with a review** → detached, stays live, review intact.
- Refactored two-pass sync cron runs clean.

---

## 2. THE DECISION: stay on Nango. Do not build credential storage.

This was re-examined from scratch (the question asked was literally "do we even need Nango?").
**Answer: keep Nango.** Reasoning, so it isn't relitigated:

- All four providers are API-key or HTTP-Basic. **There is no OAuth token refresh**, which is
  Nango's flagship value. So what Nango actually buys is narrower than the marketing: (a)
  encrypted custody of the credential by someone else, (b) the credential never enters our
  process, DB, or logs, (c) a hosted window so the landlord pastes their key into Nango's UI,
  not ours. That is still most of what we'd otherwise have to build and defend.
- **DIY is defensible but wrong for this team.** AES-256-GCM with a versioned keyring, or AWS
  KMS (~$1/mo, CloudTrail audit trail, instant kill switch), are both legitimate. But the
  code is already built assuming Nango; DIY means throwing it away, writing crypto, owning a
  rotation runbook, and adding a permanent security-review obligation — before a launch that
  is the actual priority. A non-technical founder cannot triage a GCM auth-tag failure.
- **There is no cheap PMS unified API.** Merge.dev, Apideck, Paragon, Unified.to all serve
  HRIS/ATS/CRM/accounting — **no PMS category exists** in any of them. Propexo is genuinely
  the right product and covers all of these, but starts at **$1,495/mo**. Nango at $0–70/mo is
  the only viable option at this stage.
- Cost path: **Free (10 connections) → $50/mo Starter (20, +$1/conn)**. At 40 landlords ≈
  $70/mo. Move to Starter when crossing 10 connected landlords.

### The honest risk of this choice — and the cheap mitigation

**Vendor concentration with no exit.** Nango holds every landlord credential in a form we
cannot read. If Nango raises prices, degrades, or dies, there is **no migration path** — we'd
have to ask every landlord to regenerate and re-paste their key.

**Mitigation (build this now, it is ~20 lines of currently-dead code):**
1. Add `pms_connections.credential_mode text not null default 'nango'` plus nullable
   `cred_ciphertext`, `cred_iv`, `cred_tag`, `cred_key_version`, `cred_fingerprint` columns in
   the same migration. Nothing writes them today.
2. Route every PMS HTTP call through a single `callPms(connection, {path, method, query, body})`
   helper that branches on `credential_mode`. Today every branch goes to Nango.
3. This converts a future rewrite-under-duress into a config flag. **Build the seam, not the
   second path.**

Also: **never take a dependency on Nango Syncs.** Keep the pull loop in our own cron. (Already
the case.)

### ⚠️ Two things NOT to say
- **"Our credential vendor is SOC 2 Type 2 certified"** is **false** on Nango Free and Starter
  (it's a Growth/$500-per-month feature). Do not put it in landlord-facing copy.
- Nango protects the *credential*, not the *data*. Anyone who compromises our Vercel deploy can
  use `NANGO_SECRET_KEY` to pull every landlord's portfolio. Don't oversell it internally.

---

## 3. APPFOLIO — the priority

### 3.1 The headline: there is NO vendor gate ✅

**Confidence: High.** AppFolio does **not** require Proximity to be a registered/approved
partner for API access. This is the **Buildium model, not the Entrata model.**

> Propexo, verbatim: *"Database API integrations are not certified or listed by AppFolio and do
> not require partnership approval."*

AppFolio's own ToS affirmatively sanctions it: *"the use of third party products and their
access to data is subject to a separate agreement between the user and the third party
product, and once you enable third party products, you consent to allowing that product to
access or use your data."*

**Do NOT pursue the AppFolio Stack Marketplace.** It's a go-to-market channel: 3+ month
approval, annual vendor fee, possible rev share, and it is **not a prerequisite** for reading
a landlord's data. Ignore it for launch.

### 3.2 What the landlord does (2 minutes, self-serve)

1. Log into AppFolio Property Manager (needs the **System Administrator** role)
2. Click the account name drop-down (top right)
3. **General Settings**
4. **Manage API Settings**
5. **Reports API Credentials** tab
6. **Generate New Credentials** → Client ID + Client Secret appear and persist there

⚠️ **Onboarding copy trap:** regenerating credentials **invalidates the previous pair**. There
is only one credential set per database, so if the landlord already gave those credentials to
another vendor (Aptly, Celigo, a BI tool), telling them to "generate new credentials" silently
breaks that integration. **Word it as: "If you already have credentials generated, copy those.
Only generate new ones if the section is empty."**

**They give us three strings:** the **database/subdomain** (`{vhost}`), the **Client ID**, and
the **Client Secret**.

### 3.3 Plan gating

| Plan | API access |
| --- | --- |
| Core | ❌ none |
| **Plus** | ✅ read-only — **this is all we need** |
| Max | ✅ read/write |

Read-only is enforced **by plan, not by credential scope**. A Max customer's credentials are
read/write; we simply never write. Say this plainly if a landlord asks — they will.

Core-tier landlords are a dead end for the API → route them to the one-click availability
email (already built), or see §3.7.

### 3.4 The API (Reports API v2)

```
POST https://{vhost}.appfolio.com/api/v2/reports/{report_name}.json
Authorization: Basic base64(clientId + ":" + clientSecret)
Content-Type: application/json          <-- MANDATORY. Wrong/missing => 406 Not Acceptable
```

**Reports we need:**

| Need | Report | Required filters |
| --- | --- | --- |
| Property roster | `property_directory.json` | none |
| Beds/baths/sqft/rent | `unit_directory.json` | none |
| **Availability** | `unit_vacancy.json` | none |
| Lease end dates | `rent_roll.json` | **`as_of_to` (YYYY-MM-DD) — REQUIRED** |
| Lease expirations | `lease_expiration_detail.json` | `filter_lease_date_range_by`, `ends_on_from`, `ends_on_to` (YYYY-MM) |

Also exists and is **highly relevant to student housing**:
**`student_housing_rent_roll_by_bed.json`** — by-the-bed leasing. Worth exploring in a later
pass (our `PmsUnit` shape already has a `beds` field for exactly this).

**Pagination:** response is `{ "results": [...], "next_page_url": "https://..." }`. POST
directly to `next_page_url`. **Do NOT send filters with a `next_page_url` request — v2 rejects
it.** Pages up to 5,000 rows. `next_page_url` results are cached and **expire after 30
minutes**.

**Rate limit:** **7 requests per 15 seconds** (429 on breach). **`next_page_url` requests are
exempt.** ~28 req/min — fine for a nightly sync, not for on-demand reads. Never call AppFolio
from a page render; always read from our DB.

**Key response columns** (Confidence: High for `unit_vacancy` and `unit_directory`):

`unit_vacancy.json` → `available_on`, `unit_status`, `rent_ready`, `advertised_rent`,
`computed_market_rent`, `days_vacant`, `bed_and_bath`, `sqft`, `unit_id`, `property_id`,
`property_name`, `address`, `posted_to_internet`, `next_move_in`, `last_move_out`

⚠️ `bed_and_bath` is a **single combined string** (e.g. `"2 bd / 1 ba"`), not two numbers.
Join to `unit_directory` on `unit_id` for numeric values instead of parsing it.

`unit_directory.json` → `unit_id`, `property_id`, `property_name`, `unit_name`, `unit_address`,
`unit_city`, `unit_state`, `unit_zip`, `bedrooms` (numeric), `bathrooms` (**string**, e.g.
`"1.5"`), `sqft`, `market_rent`, `computed_market_rent`, `advertised_rent`, `rent_status`,
`rent_ready`, `visibility`, `posted_to_internet`, `unit_integration_id`, `marketing_title`,
`marketing_description`, `unit_amenities`

⚠️ **`rent_roll.json` response column names are UNVERIFIED (Confidence: Low)** — AppFolio's
per-report response schema is behind a customer login. Discover them empirically on the first
real connection: call with no `columns` filter (all columns return by default) and log the keys.

### 3.5 🔴 BUGS in the current `appfolio.js` — must fix

`apps/web/src/lib/pms/appfolio.js` was written against assumed field names. Research says it is
wrong in ways that would silently produce garbage:

1. **Availability reads the wrong field.** It does `pick(row, "unit_status", "status")` from
   **`unit_directory`** — but `unit_status` is a column of **`unit_vacancy`**, not
   `unit_directory` (which has `rent_status` / `visibility` / `rent_ready`). Result: `status`
   is `null` for every unit → `available: null` for everything → the sync correctly takes **no
   action, forever.** Silent no-op.
   **Fix:** fetch `unit_vacancy` for availability and `unit_directory` for
   beds/baths/sqft/rent, and **join on `unit_id`**.
2. **`rent_roll` is called with no filters**, but `as_of_to` is **required**. That request very
   likely fails → we lose all lease-end dates → pre-leasing horizon never fires.
   **Fix:** send `{ as_of_to: <today YYYY-MM-DD> }`. Consider
   `lease_expiration_detail.json` instead, which is more targeted.
3. **`Content-Type: application/json` must be present** or AppFolio returns 406. Confirm Nango's
   proxy forwards it (the provider config below sets it as a proxy header).
4. **Rate limiting is unhandled.** 7 req/15s. `httpRetry.js` retries 429 with backoff, which
   mostly covers it, but the first page of each report counts against the budget while
   `next_page_url` follow-ups do not. With 3 reports per connection this is fine; if reports
   are added, throttle deliberately.
5. **`baseUrlOverride` is not passed** (see §3.6) — required for the Private API path.

### 3.6 How AppFolio connects through Nango (works TODAY)

**AppFolio is not in Nango's provider catalog** (verified against `providers.yaml` @ master,
913 providers — only `buildium` and `entrata` exist for PMS). And **Nango Cloud has no
self-serve "custom API" wizard.** The instructions in `apps/web/src/lib/pms/README.md` §2 that
say to "add a custom API config" **describe a feature that does not exist — fix that file.**

**The working path — `private-api-basic` + per-request base URL override. Confidence: High**
(verified by reading Nango's proxy source, not just docs).

```yaml
private-api-basic:
    display_name: Private API (Basic Auth)
    auth_mode: BASIC
    proxy:
        base_url: https://my-private-api   # placeholder; MUST be overridden per request
    credentials:
        username: { type: string, title: Username }
        password: { type: string, title: Password }
```

- Nango vaults `username`/`password` and injects
  `Authorization: Basic base64(username:password)` on every proxy call.
- It has **no `integration_config`**, so a per-integration base URL is impossible — the ONLY
  way to reach `{vhost}.appfolio.com` is the per-request override.
- `apps/web/src/lib/pms/nango.js` **already implements this** (`baseUrlOverride` →
  `Base-Url-Override` header). No change needed there.
- Nango Cloud's SSRF denylist is exact-hostname only (metadata IPs, localhost). A public host
  like `acme.appfolio.com` is not blocked.

**Mapping:** AppFolio **Client ID → `username`**, **Client Secret → `password`**.

**Four limitations to design around:**
1. **No credential verification at connect time** (`private-api-basic` has no `verification`
   block). A typo'd secret creates a "successful" connection that 401s later. **We must fire a
   test call ourselves immediately after connect** and mark the connection healthy/unhealthy.
   `discover` already calls `verifyConnection()` — make sure that path is what gates success.
2. **No subdomain field in Nango's Connect UI** (no `connection_config`). **We collect the
   subdomain in our own form** and store it in `pms_connections.credential_meta` (it is NOT a
   secret — it's the same subdomain that serves the landlord's public listings page).
3. **Generic field labels.** Nango's window will say "Username"/"Password", not "Client
   ID"/"Client Secret". Put instructional copy next to the Connect button.
4. 🚨 **`baseUrlOverride` must be on EVERY call.** Miss one and it hits
   `https://my-private-api` and hard-fails. **Wrap it in one helper so no call site can
   forget.**

🚨 **SECURITY — SSRF.** The subdomain is landlord-supplied text interpolated into a URL.
**Validate server-side against `^[a-z0-9-]{1,63}$` before use, every time.** Without this we
hand a user an SSRF primitive through our own backend. Nango's denylist protects Nango, not us.

### ✅ VERIFIED against Nango Cloud (2026-07-22) — no assumptions left

The `appfolio` integration now exists in the Nango **dev** environment (template
`private-api-basic`, auth Basic, credential fields "Username"/"Password", **no Base URL field
at all** — exactly as predicted above). A live smoke test was run against Nango Cloud with a
throwaway connection (since deleted):

| Test | Result |
| --- | --- |
| Proxy **with** `Base-Url-Override: https://example.com` | **HTTP 200**, real upstream HTML returned |
| Proxy **without** the override | **HTTP 400 `base_url_override_not_allowed`** (placeholder host unreachable) |
| Does Nango inject Basic auth? | **Yes** — `Authorization: Basic …` confirmed via a header echo |

**Conclusions, now facts rather than assumptions:**
1. `Base-Url-Override` is honored on Nango Cloud. The AppFolio plan is viable as written.
2. Nango injects `Authorization: Basic base64(username:password)` from its vault. We never see
   the credential.
3. 🚨 The override is **mandatory on every single call** — a call without it does not fall back
   to anything useful, it fails with `base_url_override_not_allowed`. This is why it must be
   wrapped in one helper (§5 P1.3).

Reference for creating a BASIC connection programmatically (the credential fields are
**top-level**, not nested under `credentials`):
```
POST https://api.nango.dev/connection
{ "connection_id": "...", "provider_config_key": "appfolio",
  "username": "<AppFolio Client ID>", "password": "<AppFolio Client Secret>" }
```

### 3.7 Fallback for Core-tier / unwilling landlords

Every AppFolio customer has a **public, unauthenticated** listings page at
`https://{vhost}.appfolio.com/listings` (verified live, HTTP 200 anonymously). Server-rendered
HTML with stable hooks: `js-listing-item`, `data-listing-id`, `js-listing-address`,
`js-listing-blurb-bed-bath`, `js-listing-blurb-rent`, `js-listing-available`,
`js-listing-square-feet`. Renders "Available Now" / "Available 7/31/26".
`/listings/listings.json` returns 401 — HTML parsing only.

This is a clean fit for the scrape path already designed (`provider='scrape'`,
`auto_apply=false`, signal-only → review queue). **Only with the landlord's written OK**, and
check their `robots.txt`. No lease-end data. Not on the critical path.

**Do NOT pursue AppFolio's ILS syndication feed** — the destination list is fixed by AppFolio,
adding Proximity requires their feeds team (`partnerspecialist@appfolio.com`), and its
availability data is stale by design (price/availability changes require fully unposting and
reposting). Worth one exploratory email someday; not a launch path.

---

## 4. Provider status — corrected

| Provider | Nango catalog? | Path | Landlord cost | Status |
| --- | --- | --- | --- | --- |
| **Buildium** | ✅ real connector | Native (`buildium`), verification `GET /v1/rentals` | Premium ~$400/mo | **Done — already configured in Nango dev** |
| **AppFolio** | ❌ | `private-api-basic` + baseUrlOverride | Plus or Max | **P1 — this brief** |
| **DoorLoop** | ❌ | `private-api-bearer` (or `private-api-generic`) | Premium ~$209/mo | Config only, no code change |
| **Rentec Direct** | ❌ | `private-api-generic`, `X-API-Key` | Pro/PM ~$45/mo, **API free** | Config only, no code change |
| **Entrata** | ✅ real connector | Native (BASIC + subdomain) | 🚩 **see below** | **Blocked — repricing needed** |

### 🚩 Entrata correction — this is now a money question, not an engineering one

LOCAL on Delmar asked for Entrata. Two blockers, both non-engineering:
1. **Dual gate.** Proximity must register as an Entrata API partner (signed Developer
   Interface Agreement with indemnification + "Common Client" scope, IP whitelisting, and a
   named client sponsor) **before** LOCAL can grant access. LOCAL's rep flipping a switch is
   necessary but **not sufficient**.
2. **Cost.** Industry reporting indicates Entrata API access starts around **$5,000/year and
   rises past $50,000** depending on usage (Confidence: Medium-High).

**Action: do not promise LOCAL anything until someone prices this.** Ask whether they would
cover the fee. Otherwise Entrata landlords stay on the one-click availability email backstop
(already built). Nango having the connector is irrelevant if the door costs $5k to open.

---

## 5. What to build (in order)

### P1 — AppFolio end to end

1. ~~Smoke test the `baseUrlOverride` assumption~~ — **DONE and PASSED, see §3.6.** The
   `appfolio` integration already exists in Nango dev. Go straight to step 2.
2. **Migration** (dev **and** prod) — the portability seam plus AppFolio metadata:
   ```sql
   alter table pms_connections
     add column if not exists credential_mode text not null default 'nango',
     add column if not exists cred_ciphertext text,
     add column if not exists cred_iv text,
     add column if not exists cred_tag text,
     add column if not exists cred_key_version text,
     add column if not exists cred_fingerprint text;
   ```
   The subdomain goes in the existing `credential_meta jsonb` as `{"subdomain": "..."}` — no new
   column needed. Update `mcp/knowledge/db-schema.json`.
3. **`lib/pms/appfolio.js` rewrite** per §3.5:
   - Fetch `unit_directory` (identity, beds/baths/sqft/rent) **and** `unit_vacancy`
     (`available_on`, `unit_status`), join on `unit_id`.
   - `rent_roll` with `{ as_of_to: today }`, or `lease_expiration_detail`. Tolerate failure
     (lease dates only enrich `availableFrom`; a failure must degrade, not delist — the cron's
     `snapshot.errors` guard already handles this).
   - Availability: `unit_status` starting with `vacant` → available. Unknown → `null`.
   - `availableFrom` for occupied units from the lease end date, so the **pre-leasing horizon**
     works (a unit whose lease ends within 12 months reads as available with a move-in date).
   - Every call passes `baseUrlOverride: https://{subdomain}.appfolio.com`. **One helper.**
   - Validate subdomain `^[a-z0-9-]{1,63}$` before every use.
4. **Subdomain collection UI** in `IntegrationsSection.js`: an AppFolio-specific input
   (label: "Your AppFolio database name", helper: "the part before .appfolio.com in your
   AppFolio URL") shown **before** opening the Nango Connect window. Persist to
   `credential_meta`. Add copy explaining Nango's window will say "Username"/"Password" and
   that those are the Client ID and Client Secret.
5. **Post-connect verification**: `verifyConnection()` must actually gate success, since
   `private-api-basic` does no verification. On failure show a real error, don't create a
   half-dead connection.
6. **Evals**: add AppFolio fixtures to `evals/pms/run.mjs` covering the `unit_directory` +
   `unit_vacancy` join, the combined `bed_and_bath` string being ignored in favour of numeric
   columns, `next_page_url` pagination, a `rent_roll` failure degrading gracefully, and
   subdomain validation rejecting `evil.com/`, `../`, and an empty string.

### P2 — DoorLoop + Rentec (config only)

Create in the Nango dashboard, no code changes (our `NANGO_*_KEY` env vars can point at any
integration ID):

| Integration ID | Template | Base URL | Auth |
| --- | --- | --- | --- |
| `doorloop` | `private-api-bearer` (or generic) | `https://app.doorloop.com/api` | `Authorization: bearer ${apiKey}` |
| `rentec` | `private-api-generic` | `https://secure.rentecdirect.com/api/v3` | header `X-API-Key`, template `${apiKey}` |

Both templates other than `private-api-generic` also need `baseUrlOverride` per call — check
each template's `integration_config` before assuming the base URL sticks.

### P3 — Contribute the three connectors upstream (half a day, free, permanent)

Merged `feat(integrations)` PRs to `NangoHQ/nango` historically merge in **hours** (sampled:
1h42m, 2h09m, 5h) when written by their team; **3–10 days** for a cold external contributor.
This upgrades the landlord experience from "Private API (Basic Auth)" to a branded AppFolio
form with proper "Client ID / Client Secret" labels, a real subdomain field, and automatic
credential verification. **No AppFolio issue or PR currently exists in their repo — we'd be
first.**

Ready-to-submit entry for `packages/providers/providers.yaml` (insert alphabetically):

```yaml
appfolio:
    display_name: AppFolio
    categories:
        - accounting
        - crm
        - other
    auth_mode: BASIC
    proxy:
        base_url: https://${connectionConfig.subdomain}.appfolio.com
        headers:
            content-type: application/json
        verification:
            method: POST
            headers:
                content-type: application/json
            endpoints:
                - /api/v2/reports/unit_directory.json?paginate_results=false
            data: {}
    docs: https://nango.dev/docs/integrations/all/appfolio
    docs_connect: https://nango.dev/docs/integrations/all/appfolio/connect
    connection_config:
        subdomain:
            type: string
            title: AppFolio Database
            description: The database (subdomain) of your AppFolio Property Manager account
            pattern: '^[a-z0-9_-]+$'
            example: acmeproperties
            prefix: https://
            suffix: .appfolio.com
            doc_section: '#step-1-finding-your-appfolio-database'
            order: 1
    credentials:
        username:
            type: string
            title: Client ID
            description: The Client ID from your AppFolio Reports API credentials
            doc_section: '#step-2-finding-your-client-id-and-client-secret'
            order: 2
        password:
            type: string
            title: Client Secret
            description: The Client Secret from your AppFolio Reports API credentials
            secret: true
            doc_section: '#step-2-finding-your-client-id-and-client-secret'
            order: 3
```

PR also requires (all hard-enforced by their validator):
- `docs/integrations/all/appfolio.mdx`
- `docs/integrations/all/appfolio/connect.mdx` (every `doc_section` anchor must match a real
  `#### Step N: ...` heading; model on `buildium/connect.mdx`)
- `packages/webapp/public/images/template-logos/appfolio.svg` ← easy to miss
- Register `"integrations/all/appfolio"` in `docs/docs.json` alphabetically
- Validate: `npx tsx scripts/validation/providers/validate.ts`
- PR title: `feat(integrations): add support for appfolio`
- Their CONTRIBUTING.md asks you to **file an issue first**; they respond within 24h.

Do the same for `doorloop` (API_KEY, `Authorization: bearer ${apiKey}`,
`https://app.doorloop.com/api`) and `rentec-direct` (API_KEY, `X-API-Key`,
`https://secure.rentecdirect.com/api/v3`), modeled on the `buildium` entry.

Once merged and deployed to Cloud (budget ~1 week post-merge), switch each integration and
drop the `baseUrlOverride` argument. Same `BASIC` credential shape, so migration is cheap.

**Do NOT** rely on Nango's `#request-a-new-api` Slack as the primary path — the free-tier SLA
is **30 days**.

### P4 — Fix the docs
`apps/web/src/lib/pms/README.md` §2 tells the operator to create "Custom API configs" in the
Nango dashboard. **That feature does not exist.** Rewrite it to match §3.6 and §5/P2 above.
This is a live trap for whoever does setup next.

---

## 6. Verification

1. `node evals/pms/run.mjs` → all green (47 + new AppFolio checks).
2. `npm run lint` and `npm run build` clean.
3. **Demo mode** still works end to end (dashboard → PMS Sync → Try the demo → confirm), since
   it short-circuits Nango entirely.
4. **Real AppFolio**: with a landlord's (or a trial) credentials on **staging** — connect →
   discover shows their properties → confirm → `curl -H "Authorization: Bearer $CRON_SECRET"
   <base>/api/cron/pms-sync` → `pms_sync_events` populated, `last_verified_at` refreshed.
5. **Dry run first.** Set `auto_apply=false` on the real connection and let it run for 1–2
   weeks. Read `pms_sync_events` (`applied=false`) and ask: *of the N changes it wanted to
   make, how many were right?* Only then flip it live. This is the single highest-value
   validation tool available and it already works.
6. **Edge cases to force:** lease ending in 2 months (must read available with a date) · lease
   ending in 3 years (not available) · all units leased → listing unavailable · one freed →
   relists · `unit_vacancy` succeeds but `rent_roll` fails (must NOT delist) · empty snapshot
   (must abort) · subdomain `../`, `evil.com`, `""` (must be rejected).

---

## 7. Open questions — resolve with the first real AppFolio landlord

1. **Exact `rent_roll.json` response column names** (Confidence: Low). Call with no `columns`
   filter and log the keys.
2. **Can Core-tier customers generate Reports API credentials?** Every source treats "the API"
   monolithically. Assume Core is a dead end until proven otherwise.
3. Whether `unit_vacancy.json` alone is sufficient (it carries `advertised_rent` and `sqft`),
   which would drop one of the three report calls.

---

## 8. Known deferred items (from the 2026-07-22 pre-launch review)

Not blocking, but documented so they aren't rediscovered:
- `api/landlord/pms/discover` does not bind the client-supplied `nangoConnectionId` to the
  session user's Nango `end_user.id`. Exploiting it requires guessing a server-generated UUID.
  Defense-in-depth only.
- The sync cron will re-list a listing a landlord manually hid ("PMS is source of truth" by
  design). Consider honoring a manual-override flag.
- The shared `Button` primitive's focus ring references a Tailwind token that doesn't resolve,
  so focus rings are invisible app-wide. Overridden at PMS call sites only; worth a global fix.
- `matchUnitsToListingUnits` falls back to bedrooms-only matching, which can attach a unit to
  the wrong bathroom-count floor-plan type.
- AppFolio/Buildium/DoorLoop paginators have no page cap (infinite-loop risk if an API
  misbehaves).

---

## 9. Facts worth keeping

- Buildium is **already configured in Nango dev** (Integration ID `buildium`, auth API Key).
  "No functions deployed" in that dashboard is irrelevant — we use the **Proxy**, not Nango
  Syncs/Functions.
- `NANGO_SECRET_KEY` is already in `apps/web/.env.local`.
- `AVAILABILITY_LINK_SECRET` is optional; it falls back to `AUTH_SECRET`.
- Env overrides exist for every provider key: `NANGO_BUILDIUM_KEY`, `NANGO_APPFOLIO_KEY`,
  `NANGO_DOORLOOP_KEY`, `NANGO_RENTEC_KEY`. If Nango assigns an integration ID we can't rename,
  point the env var at it instead of fighting the dashboard.
- `PMS_LEASING_HORIZON_MONTHS` (default 12) controls the pre-leasing horizon.
- `PMS_MOCK_LEASED="1A,2B"` forces demo units occupied to exercise delist/relist.
- The dev Supabase snapshot **drops ~10 foreign keys and leaves ~226 orphan rows**; they were
  restored as `NOT VALID` on 2026-07-22. If the local app starts 500ing with *"Could not find a
  relationship between 'listings' and 'listing_units'"*, that's this. Re-add the FKs `NOT
  VALID`; **do not delete the orphans** (Ben's developers stage data there) and **do not**
  re-run the prod→dev snapshot (it would wipe dev-only work).
- Local dev needs **both** `DEV_SUPABASE_SERVICE_KEY` (service_role) and
  `DEV_SUPABASE_DEFAULT_KEY` (anon/publishable) in `.env.local`.
