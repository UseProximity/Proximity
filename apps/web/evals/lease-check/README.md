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
silently: flag quality, hallucinated quotes, PII/address leakage, and image robustness.

It does **not** touch the database, R2, staging, or production. It only calls the Anthropic
API. It is safe to run anytime.

> Scope: the cheaper-comps feature (and the rent-number extraction that fed it) was removed
> from this feature. This suite reflects that — it does not extract or assert a rent number.
> If comps is ever restored, restore the rent-normalization cases from git history alongside it.

## 1. When to run it

Run the full suite after ANY change to these files, and treat a HARD FAIL as a blocker:
- `src/lib/leaseCheck/prompt.js` (the system/user prompt)
- `src/lib/leaseCheck/analyzeLease.js` (schema, request shape, em-dash strip)
- The model id, `max_tokens`, or `output_config` in the analyze call.

A prompt or schema edit that looks harmless can move flag quality, quoting, or the privacy
behavior. This suite is the guard.

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
node evals/lease-check/run.mjs               # full suite (10 cases, ~1 min, ~$1-2)
node evals/lease-check/landlord-matcher.mjs  # landlord/company matcher unit eval (Haiku)
```

Subset by case id (fast iteration while fixing one thing):

```bash
node evals/lease-check/run.mjs flags_core pii_redaction
```

Case ids: `flags_core`, `pii_redaction`, `green_terms`, `non_lease_document`, `near_empty`,
`image_clean`, `image_blurry`, `image_low_res`, `image_cut_off`, `multi_photo`.

## 4. How to read the output

- Per check: `✓` pass, `✗` hard fail, `! (soft)` soft warn.
- Per case: `PASS` / `WARN` (only soft fails) / `FAIL` (≥1 hard fail) / `FATAL` (model
  returned nothing parseable).
- Footer: `HARD FAILS: N`. **The exit code is 0 only when `HARD FAILS == 0`.**
- Every case's full analysis JSON is written to `evals/lease-check/results/<timestamp>/<id>.json`.
  Read these to see exactly what the model returned. (This dir is gitignored.)

**Decision rule:** `RESULT: GREEN` → the analysis behaves correctly on every modeled edge
case. A soft `WARN` is acceptable to ship (it flags a borderline behavior worth a glance).
Any `HARD FAIL` → do not ship; diagnose using §6.

## 5. What each case guarantees

| Case | Asserts (hard unless noted) |
|---|---|
| `flags_core` | Joint-and-several liability, sublet ban, and auto-renewal each get flagged. This is the core value: catching the clauses that burn students. |
| `pii_redaction` | An injected SSN and bank number appear in **no** stored field; the guarantor clause is still flagged; address not leaked. |
| `green_terms` | Genuinely tenant-friendly terms produce ≥1 green flag; 0 red (soft). |
| `non_lease_document` | A non-lease (recipe) produces **no fabricated lease flags**; low confidence (soft). |
| `near_empty` | A near-blank PDF fabricates nothing. |
| `image_clean` | The image path works: reads a photo and produces a summary + flags. |
| `image_blurry` / `image_low_res` | A degraded photo is either read or reported unreadable — it must never crash or return an empty analysis. |
| `image_cut_off` | A half-cropped page does not crash and is not reported at very high confidence (soft). |
| `multi_photo` | Two photos of one lease are combined into one analysis. |

**Universal checks applied to every case** (in `run.mjs`):
1. No em dash survives into stored text (summary/flags).
2. Hallucination guard: for text PDFs, **every** `quote` must appear (whitespace/punctuation-
   insensitive) in the source we generated. A fabricated or altered quote is a hard fail.
3. Address (`6633 Clemens` / "clemens") never appears in summary or any flag field.
4. Injected PII digit-strings never appear in any stored field.

## 6. If something fails — diagnosis map

| Symptom | Most likely cause | Where to look |
|---|---|---|
| `flags_core`: a clause not flagged | Prompt's "what to hunt for" list weakened | the WHAT TO HUNT FOR block in `prompt.js` |
| `every quote is real` fails | Model is paraphrasing/inventing quotes | tighten the "quote verbatim" instruction in `prompt.js` |
| `address not stored` fails | Privacy instruction weakened; model put the address in the summary/flags | the PRIVACY block in `prompt.js` (keep address out of summary/flags/quote) |
| `no SSN/bank PII` fails | PII redaction instruction weakened | PRIVACY block in `prompt.js` |
| `non_lease`/`near_empty`: fabricated flags | Model inventing terms not in the doc | the ACCURACY line in `prompt.js` ("only flag what the document actually says") |
| Image case: empty/crash | image block construction, or a genuinely unreadable input | `analyzeLease.js` document/image block building; acceptable if `unreadablePages` is populated |
| `FATAL: parsed_output null` | Schema drift between `run.mjs` and `analyzeLease.js`, or an API error | keep the zod schema in `run.mjs` in lockstep with `analyzeLease.js`; check the error text |

After a fix, re-run just the failing case id, then the full suite before declaring green.

## 7. Adding a case

Append an object to `CASES` in `cases.mjs`:
- `build()` returns `{ documents: [<generator output>], sourceText, address, pii }`.
  Use `makePdf(lines)` for crisp text; `makeLeaseImage(lines, {blur,shrink,rotate,jpegQ,cropTop})`
  for a degraded photo. `sourceText` enables the quote guard (set `null` for images, since OCR
  varies). `address`/`pii` enable the privacy/PII universal checks.
- `check(analysis)` returns `[{ label, pass, detail?, soft? }]`. Mark a check `soft: true`
  when the correct behavior is a range rather than one value.

## 8. Limits (do not over-claim from a green run)

This suite proves the modeled edge cases pass. It does **not** cover:
- Real scanned/crumpled leases (the synthetic images are cleaner than real phone photos).
- Very long (50-100 page) leases, non-English leases, or unusual multi-unit structures.
- The property/landlord **database** logic — the LLM landlord matcher is exercised by
  `landlord-matcher.mjs`, but the DB retrieval that feeds it real candidates, plus the
  address→listing match and review pull, must be verified end-to-end on **staging** with
  real listing data.
- Anything about upload/R2/deletion/persistence — those are staging-only.

A green run means "the analysis is correct on every case we thought to write." Keep adding
cases as new failure modes are discovered in the wild.
