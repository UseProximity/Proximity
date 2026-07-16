# Lease Check — Eval Harness (agent runbook)

> Audience: an AI coding agent (e.g. a Claude Code session) or an engineer. This file is
> written to be **executed**, not just read. Follow the sections in order. Every command,
> expected output, and failure-to-cause mapping is explicit.

## 0. What this is

An offline evaluation of the Lease Check analysis (`apps/web/src/lib/leaseCheck/`). It
generates **synthetic lease documents with known ground truth** (crisp PDFs and degraded
images that mimic bad phone photos/scans), runs each through the **real `claude-sonnet-5`
call the app uses**, and asserts the results against facts we control. It exists to catch
regressions in the parts of this feature that are correctness-critical and easy to break
silently: rent normalization, hallucinated quotes, PII/address leakage, and image robustness.

It does **not** touch the database, R2, staging, or production. It only calls the Anthropic
API. It is safe to run anytime.

## 1. When to run it

Run the full suite after ANY change to these files, and treat a HARD FAIL as a blocker:
- `src/lib/leaseCheck/prompt.js` (the system/user prompt)
- `src/lib/leaseCheck/analyzeLease.js` (schema, request shape, `perPersonPerMonth`, em-dash strip)
- The model id, `max_tokens`, or `output_config` in the analyze call.

A prompt or schema edit that looks harmless can move rent extraction, quoting, or the
privacy behavior. This suite is the guard.

## 2. Prerequisites

1. `LEASE_SCANNER_KEY` (the Anthropic API key) must be available in the environment.
   It lives in `apps/web/.env.local` (gitignored). Load it, don't hardcode it.
2. Node 18+ (uses global `fetch`, ESM). `sharp` and `@anthropic-ai/sdk` are already
   `apps/web` dependencies — no install step.
3. Working directory must be `apps/web` (paths and the `.env.local` load assume it).

## 3. Run it

```bash
cd apps/web
set -a && source .env.local && set +a      # loads LEASE_SCANNER_KEY into the env
node evals/lease-check/run.mjs        # full suite (14 cases, ~1-2 min, ~$1-3)
```

Subset by case id (fast iteration while fixing one thing):

```bash
node evals/lease-check/run.mjs rent_whole_term_total pii_redaction
```

Case ids: `rent_per_person`, `rent_whole_term_total`, `rent_per_month_all_tenants`,
`rent_ambiguous`, `pii_redaction`, `bedrooms_partial_lease`, `green_terms`,
`non_lease_document`, `image_clean`, `image_blurry`, `image_low_res`, `image_cut_off`,
`multi_photo`, `near_empty`.

## 4. How to read the output

- Per check: `✓` pass, `✗` hard fail, `! (soft)` soft warn.
- Per case: `PASS` / `WARN` (only soft fails) / `FAIL` (≥1 hard fail) / `FATAL` (model
  returned nothing parseable).
- Footer: `HARD FAILS: N`. **The exit code is 0 only when `HARD FAILS == 0`.**
- Every case's full analysis JSON is written to `evals/lease-check/results/<timestamp>/<id>.json`.
  Read these to see exactly what the model returned. (This dir is gitignored.)

**Decision rule:** `RESULT: GREEN` → the analysis behaves correctly on every modeled edge
case. Any `HARD FAIL` → do not ship; diagnose using §6.

## 5. What each case guarantees

| Case | Asserts (hard unless noted) |
|---|---|
| `rent_per_person` / `rent_whole_term_total` / `rent_per_month_all_tenants` | All three phrasings normalize to **$780/person/month**; `numTenants==3`; `bedrooms==3`; joint-and-several + sublet flagged. This is the rent trap — the highest-risk path. |
| `rent_ambiguous` | A bare "$3,600" with no period yields low confidence and the **comps gate stays CLOSED** (never compare an ambiguous number). |
| `pii_redaction` | An injected SSN and bank number appear in **no** stored field; the guarantor clause is still flagged; address not leaked. |
| `bedrooms_partial_lease` | Leasing 2 of 4 bedrooms yields `bedrooms == 2` or `null`, **never 4** (guards the comps bedroom filter). |
| `green_terms` | Genuinely tenant-friendly terms produce ≥1 green flag; 0 red (soft). |
| `non_lease_document` | A non-lease (recipe) produces **no fabricated lease flags** and low confidence. |
| `image_clean` | The image path works: reads $780 from a photo. |
| `image_blurry` / `image_low_res` | Degraded photo either reads $780 **or** reports low confidence — it must **never** report a *wrong* rent. |
| `image_cut_off` | A half-cropped page does not crash and is not reported at high confidence (soft). |
| `multi_photo` | Two photos of one lease are combined (soft: $780, 3 tenants). |
| `near_empty` | A near-blank PDF fabricates nothing. |

**Universal checks applied to every case** (in `run.mjs`):
1. No em dash survives into stored text (summary/flags).
2. Hallucination guard: for text PDFs, **every** `quote` must appear (whitespace/punctuation-
   insensitive) in the source we generated. A fabricated or altered quote is a hard fail.
3. Address (`6633 Clemens` / "clemens") never appears in summary or any flag field.
4. Injected PII digit-strings never appear in any stored field.

## 6. If something fails — diagnosis map

| Symptom | Most likely cause | Where to look |
|---|---|---|
| Rent case: `per-person != 780` | `perPersonPerMonth` math, or the prompt let the model do arithmetic / mis-set `rentType` or `numTenants` | `analyzeLease.js` `perPersonPerMonth`; the RENT rules in `prompt.js` |
| `rent_ambiguous`: gate not CLOSED | Confidence floor bypassed, or model over-confident on a bare number | comps gate `confidence < 0.7` logic in `propertyContext.js` + route; `prompt.js` "set confidence to 0 if not clearly stated" |
| `every quote is real` fails | Model is paraphrasing/inventing quotes | tighten the "quote verbatim" instruction in `prompt.js` |
| `address not stored` fails | Privacy instruction weakened; model put the address in the summary/flags | the PRIVACY block in `prompt.js` (keep address out of summary/flags/quote) |
| `no SSN/bank PII` fails | PII redaction instruction weakened | PRIVACY block in `prompt.js` |
| `bedrooms != 2` on partial lease | Model inferring bedrooms from the building, not the lease | the `bedrooms` guidance in `prompt.js` |
| `FATAL: parsed_output null` | Schema drift between `run.mjs` and `analyzeLease.js`, or an API error | keep the zod schema in `run.mjs` in lockstep with `analyzeLease.js`; check the error text |
| Image case wrong rent | genuine model limitation on that degradation | acceptable only if confidence is low; if it's confidently wrong, consider raising the comps confidence floor for image inputs |

After a fix, re-run just the failing case id, then the full suite before declaring green.

## 7. Adding a case

Append an object to `CASES` in `cases.mjs`:
- `build()` returns `{ documents: [<generator output>], sourceText, address, pii }`.
  Use `makePdf(lines)` for crisp text; `makeLeaseImage(lines, {blur,shrink,rotate,jpegQ,cropTop})`
  for a degraded photo. `sourceText` enables the quote guard (set `null` for images, since OCR
  varies). `address`/`pii` enable the privacy/PII universal checks.
- `check(analysis, { perPerson, gateOpen })` returns `[{ label, pass, detail?, soft? }]`.
  Mark a check `soft: true` when the correct behavior is a range rather than one value.

## 8. Limits (do not over-claim from a green run)

This suite proves the modeled edge cases pass. It does **not** cover:
- Real scanned/crumpled leases (the synthetic images are cleaner than real phone photos).
- Very long (50-100 page) leases, non-English leases, or unusual multi-unit/option-A-B structures.
- The property/landlord/comps **database** logic — that is exercised by
  `landlord-matcher-test.mjs` (LLM landlord matching) and must be verified end-to-end on
  **staging** with real listing data.
- Anything about upload/R2/deletion/persistence — those are staging-only.

A green run means "the analysis is correct on every case we thought to write." Keep adding
cases as new failure modes are discovered in the wild.
