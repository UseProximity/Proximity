# PMS connector eval

Offline test suite for `src/lib/pms/` — no network, DB, or Nango account needed
(global fetch is stubbed with fixtures).

```bash
cd apps/web && node evals/pms/run.mjs
```

## What it asserts

- **Normalization contract** (`types.js`): word-form bedrooms/bathrooms
  ("TwoBed", "OnePointFiveBath"), currency parsing, junk → `null`.
- **Availability mapping** per connector: vacant → `available:true`,
  occupied/leased → `false` (+ `availableFrom` from the active lease end —
  pre-leased ≠ stale), unknown → `null` (sync takes no action).
- **Fail-safe snapshots**: an auth/network failure on the core pull returns
  `{ properties: [], errors: [...] }` — never a partial snapshot that could
  delist a healthy portfolio. Lease-enrichment failures degrade to
  `available:null`, never to `available:true`.
- **Pagination**: Buildium limit/offset pages; AppFolio `next_page_url`.
- **`httpRetry`**: 429/5xx retried with backoff (honoring Retry-After);
  4xx returned as-is.
- **Credential hygiene**: the Nango secret only ever appears in the
  Authorization header, never in URLs.

## Failure → cause map

| Failing check | Likely cause |
| --- | --- |
| `toBedrooms/toBathrooms` | word map in `types.js` edited/removed |
| `* -> available` checks | a connector changed its status mapping — verify against real PMS payloads before trusting the new behavior |
| `empty snapshot + error` | someone made `fetchSnapshot` return partial data on failure — this breaks the sync's "broken pull must not delist" guarantee |
| `next_page_url` / pagination | paging loop changed; check the terminating condition |
| `httpRetry` checks | retry/backoff logic changed in `httpRetry.js` |

## Limits

Fixtures approximate real Buildium/AppFolio/DoorLoop payloads from their public
docs; they are not recorded from live accounts. Before enabling a provider in
prod, run `verifyConnection` + `fetchSnapshot` against a sandbox account (see
`src/lib/pms/README.md`) and extend these fixtures with any shape differences found.
