# Listing Walkthrough Video — Build Brief

**Status:** Ready to execute. Research complete (2026-07-29). No code written yet.
**Owner:** Ben Flicker
**For:** Fable 5, executing in a fresh chat.

> Read `CLAUDE.md` first. Working agreements that apply here: branch off `staging`, give Ben a
> test plan and **wait for approval before pushing**, PR into `staging`, apply migrations to
> **both dev and prod**, update the MCP knowledge with `update-knowledge`, and **never** put AI
> attribution in commit messages or PR descriptions.

---

## 0. Watch this first

**https://youtu.be/ReASV_e1mwc** — "How to Turn Real Estate Photos Into a Cinematic Walkthrough
With AI (Higgsfield + Kling 3.0)", Market U, 2:55.

This is the exact output we are trying to reproduce, at scale and automatically. Watch it (or pull
the transcript with `yt-dlp --write-auto-sub --skip-download`) before writing any code, so you
understand the target. The creator's method, from the video description verbatim:

1. **Order your photos like a route** → outside, entrance, living room, kitchen, patio, final
   exterior. *"If the images don't flow logically, no AI will save it."*
2. **Generate in overlapping pairs** → image 1+2, then 2+3, then 3+4. *"That overlap is what makes
   each scene feel connected instead of cut together."*
3. **Direct the camera per clip** → toward the entrance, turn slightly right going inside, pull
   back through the living room, push forward into the kitchen. *"You're not generating clips —
   you're building a route."*
4. **Keep prompts simple** → "smoothly blend from image one into image two, stable camera, seamless
   transition." *"Overcomplicating the prompt breaks the consistency."*

Everything in this brief is that method, made automatic and made safe for a marketplace.

---

## 1. What we're building

Auto-generated cinematic walkthrough videos for property listings, built from the still photos
landlords already upload. Two consumer-facing goals:

1. Listings get a video instead of a static gallery (conversion + a hook for signing landlords).
2. Watermarked video is free; the clean/unwatermarked file is a paid landlord perk.

The technique is copied from a proven method (Higgsfield + Kling 3.0): order photos as a physical
route through the property, then generate **overlapping-pair transitions** — photo 1→2, 2→3, 3→4 —
using Kling's start-frame/end-frame interpolation. Each pair becomes a short clip that appears to
be a continuous camera move. Stitch the clips into one video.

**Execution order: Phase 1 (3 test videos) → Ben reviews → Ben says "go" → Phase 2 (full catalog)
→ Phase 3 (automation layer).** Do not start Phase 2 without an explicit go from Ben.

---

## 2. Research already done — do not redo this

### 2.1 The image library (queried from prod, 2026-07-29)

| Metric | Value |
|---|---|
| Active listings (`deleted_at is null`) | 123 |
| Total images | 1,656 (all `media_type = 'image'`, zero video today) |
| Real photos vs Street View | 1,638 real / only 18 `source = 'street_view'` |
| Resolution range | 2048×1367 → 6016×4016 (professional MLS-grade) |

Distribution of **usable** photos per active listing (excluding `source = 'street_view'`):

| Usable photos | Listings | Treatment |
|---|---|---|
| 0 | 14 | No video |
| 1–3 | 6 | No video |
| 4–5 | 6 | Ken Burns only (no AI generation) |
| 6–7 | 8 | Full hybrid |
| 8–11 | 33 | Full hybrid |
| 12+ | 56 | Full hybrid |

**97 listings qualify for the full pipeline. 6 get the reduced treatment. 20 get nothing.**

### 2.2 Three data problems found (these drive the whole design)

1. **`sort_order` is alphabetical by filename, not route order.** A real listing's sequence runs
   `10-web…`, `11-web…`, `3f6d…`, `4-web…`, `74172…`, `b6eb…`. Feeding that order to Kling
   produces incoherent output. Route order must be reconstructed. See §4.
2. **Image sets are contaminated.** Real listings mix actual photos with architectural
   **renderings** (`King_s_Court_Interior_Rendering`, `DGCourtyardRender`) and **floorplan
   diagrams** (`Floorplan_Rendering`, `1-Bedroom.jpg`). A floorplan fed to Kling produces garbage.
   Renderings are also a legal problem — they are not the real unit.
3. **Some listings pull images from multiple R2 prefixes**, which can mean multiple units mixed
   into one listing. The curator must detect and handle finish/palette inconsistency.

### 2.3 The critical model constraint

Kling's own documentation:

> "The content of the first and last frames should be as similar as possible, as significant
> differences may cause a **lens switch**."

Listing photos are **different rooms** — by definition "significant differences." Naive pairing
will regularly produce jarring cuts, warped geometry, and invented architecture. **This is why a
pure auto-pipeline does not work, and why §4.3 (adjacency gating) exists.** It is the single most
important design decision in this document.

### 2.4 Provider decision — fal.ai (RE-VALIDATE THIS FIRST)

> **Your first task, before any code:** independently re-check that fal.ai + Kling 3.0 is still the
> best choice for this specific job. This research is from **2026-07-29** and this space moves
> weekly. Check current pricing, and check whether a newer or better-suited model has shipped —
> compare at minimum Kling 3.0, Runway Gen-4/Gen-5, Google Veo, Luma Ray, MiniMax/Hailuo, and
> Seedance, on these criteria in priority order:
>
> 1. **Start-frame + end-frame interpolation** (non-negotiable — the whole method depends on it)
> 2. **Architectural fidelity** — does it warp walls, invent doorways, morph furniture? This
>    matters more than cinematic flair; see R3/§2.5
> 3. Pay-per-use with **no large minimum top-up**
> 4. Commercial-use rights
> 5. Price per second at 1080p
>
> Report your findings to Ben with a recommendation **before** building. If something clearly
> better exists, say so and use it — the architecture in this brief is provider-agnostic; only
> §2.4 and the call shape below would change. If fal.ai still wins, say that and proceed.

Findings as of 2026-07-29:

| Option | Verdict |
|---|---|
| **fal.ai** — `fal-ai/kling-video/o3/standard/image-to-video` | **USE THIS.** `image_url` (start) + `end_image_url` (optional end frame), `duration` 3–15s, **$0.084/s** audio off, pay-per-use, no minimum, commercial use |
| Kling direct (`kling.ai/dev`) | Same $0.084/s but credit packages appear to start at **$700**. Absurd for a 3-video pilot |
| Higgsfield | Its "unlimited" tiers are **web-UI only** — the pricing page states unlimited is "not accessible on MCP/CLI." Cannot power automation |
| vProp (turnkey, $12–19/video) | Pan-and-zoom slideshow, not generative walkthrough. Different product |

fal.ai call shape (verified from their docs):

```js
{
  image_url: "<start frame public URL>",
  end_image_url: "<end frame public URL>",   // optional
  duration: "5",                              // string enum, 3–15
  prompt: "<see §4.4>"
}
```

Note: this endpoint uses `image_url`, **not** `start_image_url` (differs from their v3 endpoints).

### 2.5 Legal constraints — non-negotiable

A HousingWire piece (2026-06-30) names this exact use case as a disclosure trigger: *"an
AI-generated video that appears to show … a walkthrough when the source material was only still
photography. The images may be real. The experience is not."*

| Jurisdiction | Status |
|---|---|
| California AB 723 | In force, covers **rental ads**, $250/violation |
| Wisconsin Act 69 | Effective 2027, covers AI-altered advertising incl. generated video |
| New York S9584 | Pending, would cover video and immersive media |
| **Missouri (us)** | No AI-specific statute yet, but the Merchandising Practices Act (§407.020) is broad on deceptive advertising |

**Therefore, hard requirements — do not let these be "polish later":**

- **R1.** Every video carries a persistent, legible on-screen label: `AI preview · not filmed
  footage` — small, bottom-left, present for the entire duration, on both watermarked and clean
  renders. Exact spec in §6.
- **R2.** Never publish a video built from **renderings** — only real photographs of the actual
  unit. Renderings get filtered out in §4.1.
- **R3.** The prompt must forbid adding/removing/altering furniture, fixtures, or architecture.
- **R4.** Store a full **provenance manifest** per video: every source image ID in order, which
  transitions were generated vs. safe, the exact prompt and model params. This satisfies the
  "show what was real and what was changed" standard.
- **R5.** A human approves every video before it is publicly visible (all phases, including
  Phase 3 — see §7.4).

This matters beyond compliance: Proximity's stated values are Transparency, Simplicity, Trust, and
the whole pitch is honest listings. A student touring an apartment that doesn't match the
"walkthrough" is the exact failure this company exists to fix.

---

## 3. Architecture overview

```
listing_images (unordered, contaminated)
        │
        ▼
[A] CURATE     — vision model: classify, filter, reject       → usable set
        │
        ▼
[B] ORDER      — canonical tour route + dedupe                → ordered sequence
        │
        ▼
[C] SCORE      — adjacency score for each consecutive pair    → transition plan
        │
        ├── score ≥ 2 → GENERATED clip  (Kling, 5s, ~$0.42)
        └── score <  2 → SAFE segment   (ffmpeg Ken Burns + crossfade, 3s, free)
        │
        ▼
[D] RENDER     — stitch, label, title card (silent)           → two mp4s
        │
        ▼
[E] QC         — automated checks, then human approval        → published
```

**The hybrid transition model (C) is the core idea.** Not every transition needs to be generated.
Only spatially-adjacent pairs get the expensive, risky AI interpolation; everything else gets a
clean, honest Ken Burns move. This simultaneously:

- kills the "lens switch" failure mode (we simply don't generate the pairs that would break),
- cuts cost by roughly half on a typical listing,
- and guarantees the video always completes — a failed or rejected clip **downgrades to the safe
  segment** rather than blocking the listing.

---

## 4. Solving the ordering problem (the hard part)

### 4.1 Stage A — Classify and filter

One vision pass over all of a listing's images. Use `claude-sonnet-5` via `@anthropic-ai/sdk`
(already a dependency; see `src/lib/leaseCheck/analyzeLease.js` for the established client,
structured-output, and cost-tracking pattern). Batch images per request; downscale to ~768px for
the classification pass to keep tokens sane.

Return per image:

| Field | Values |
|---|---|
| `content_type` | `photo` \| `rendering` \| `floorplan` \| `graphic` \| `map` \| `logo` |
| `space` | `exterior_front`, `exterior_rear`, `entry_hall`, `living`, `dining`, `kitchen`, `hallway`, `stairwell`, `bedroom`, `bathroom`, `laundry`, `closet`, `balcony_patio`, `amenity_gym`, `amenity_lounge`, `amenity_pool`, `parking`, `view_window`, `detail`, `other` |
| `shot_type` | `wide` \| `medium` \| `detail` |
| `quality` | `usable` \| `dark` \| `blurry` \| `cluttered` |
| `has_people` | bool |
| `palette_cluster` | short label of finish/color scheme, for detecting mixed units |

**Reject** from the video: `content_type != 'photo'` (kills floorplans, renderings, graphics —
satisfies R2), `quality != 'usable'`, `has_people = true` (faces warp badly under interpolation),
and `shot_type = 'detail'` (close-ups interpolate poorly; keep them out of the route).

If `palette_cluster` splits the set into two clearly different unit finishes, keep only the
largest cluster and note the drop in the manifest.

### 4.2 Stage B — Route ordering

Sort the surviving photos by canonical tour order. This is not true spatial adjacency — it's the
order a human would walk and film a place, which is what makes the result read as a tour:

```
1  exterior_front
2  entry_hall
3  living
4  dining
5  kitchen
6  hallway
7  bedroom      (group all bedrooms together)
8  bathroom
9  laundry / closet
10 balcony_patio
11 amenity_*    (lounge, gym, pool)
12 view_window
13 exterior_rear
```

Within a space that has multiple photos: prefer `wide` over `medium`, keep at most 2 per space,
and drop near-duplicates. For dedupe use a perceptual hash (dHash) — add `sharp` as a dependency
for crop/resize/hash, or do it with the ffmpeg binary if you'd rather not add a package. Hamming
distance ≤ 6 counts as a duplicate.

**Deterministic fallback:** if the vision call fails or returns malformed output, fall back to
ordering by `space` priority using filename heuristics, and force `mode = kenburns` (no
generation). Never hard-fail a listing because the classifier had a bad day.

### 4.3 Stage C — Adjacency scoring (the gate)

For each **consecutive pair** in the ordered sequence, one vision call asking:

> Do these two photographs show overlapping physical space — a shared wall, a visible doorway
> between them, a continuous floor, or a sightline from one into the other? Score 0–3.
> 0 = unrelated spaces. 3 = clearly the same space from a different angle, or one photo visibly
> looks into the other.

Combine with a cheap mechanical signal: dominant-color histogram similarity between the two
images (a proxy for same-room lighting/finish).

| Combined score | Transition |
|---|---|
| ≥ 2 | **Generated** — Kling start/end frame, 5s |
| < 2 | **Safe** — Ken Burns push/pan on the first image, 3s, 0.5s crossfade into the next |

This is validated by real data: in a sampled listing, a bedroom photo visibly looked through a
doorway into the living room from another photo — a genuine score-3 pair. Those exist, and they're
the ones worth paying for.

**Cost cap:** maximum **8 generated clips per listing**, chosen as the 8 highest-scoring pairs.
Everything else is safe regardless of score.

### 4.4 Stage D — Prompt template

Keep it simple; the source video's creator was explicit that overcomplicating the prompt breaks
consistency. Fixed template, with the camera direction varying by the space pair:

```
Smoothly blend from the first frame into the second frame. Slow, stable, continuous
real-estate walkthrough camera move, {direction}. Seamless transition. Photorealistic.
Do not add, remove, or alter any furniture, fixtures, walls, windows, or architectural
features. No people. No text or captions.
```

`{direction}` is derived from the space pair, e.g. `moving forward through the doorway`,
`pulling back to reveal the room`, `panning slowly to the right`.

R3 is enforced by the "do not add, remove, or alter" clause — keep it verbatim.

### 4.5 Image prep before generation

- Crop to **16:9** (sources are mostly 3:2 — center-crop loses ~11% of height, acceptable and
  standard). Do this **before** sending frames, so start/end frames match the output aspect.
- Downscale to max 1920px wide, JPEG q85.
- Verify aspect ratio lands within Kling's accepted **1:2.5 – 2.5:1** and min 300px per side.
- Upload prepped frames to R2 under a `video-frames/{listingId}/` prefix — fal needs publicly
  fetchable URLs. These are intermediate artifacts; they can be cleaned up after render.

---

## 5. Eligibility rules and edge cases

Evaluate **after** Stage A filtering, on the count of surviving usable photos (`U`) and the count
of distinct `space` values (`S`).

| Condition | Outcome | `skip_reason` |
|---|---|---|
| `U` ≤ 3 | **No video** | `insufficient_photos` |
| `U` 4–5 | Ken Burns only, no generation, ~20s | — (`mode = kenburns`) |
| `U` ≥ 6 **and** `S` ≥ 3 | Full hybrid pipeline | — (`mode = hybrid`) |
| `U` ≥ 6 but `S` < 3 | Ken Burns only (e.g. 12 shots of one bedroom) | — (`mode = kenburns`) |
| All images are floorplans/renderings | **No video** | `no_real_photos` |
| Only Street View images | **No video** | `street_view_only` |
| Listing `deleted_at` is set | Skip entirely | — |
| Any image fails to download / 404s | Drop that image, continue | — |
| Image aspect outside 1:2.5–2.5:1 after crop | Drop that image, continue | — |
| Vision classifier fails | Fall back to `mode = kenburns` | — |
| A Kling clip fails or fails QC | **Downgrade that one transition to safe**, continue | — |
| All generated clips fail | Ship as `mode = kenburns` | — |
| Final duration < 12s | **No video** (too thin to be worth it) | `too_short` |

**Principle: a listing never blocks on video.** Every failure path degrades to something shippable
or to a clean skip with a recorded reason. Nothing throws.

### Idempotency

Cache every generated clip by
`sha256(from_image_url + to_image_url + prompt + model + duration + resolution)`.
Store in `listing_video_clips`. **Never regenerate an identical pair** — this makes re-runs free
and makes Phase 2 safely resumable if it dies halfway.

---

## 6. Output spec

| Property | Value |
|---|---|
| Container / codec | mp4 / H.264 |
| Resolution | 1920×1080 (16:9) |
| Frame rate | 30 fps |
| Target duration | 25–45s |
| Generated clip length | 5s |
| Safe segment length | 3s + 0.5s crossfade |
| **Audio** | **None for now — silent.** See below |
| Title card | 1.5s — property address + Proximity logo |
| **Persistent label (R1)** | See spec below |
| Poster frame | Extracted at 1.0s, stored as `poster_url` |
| Renders | **two**: watermarked (free/public) and clean (paid) |

**Audio — none for v1.** Ship the videos silent. Mux a **silent AAC track** rather than omitting
the audio stream entirely, since some browsers and social embeds mishandle audio-less mp4s.
Do not add music, and do not add AI voiceover. Keep the render pipeline's audio stage as a
single swappable step so a licensed track can be dropped in later without a rewrite.

**Label spec (R1) — small, bottom-left, always on.**

| Property | Value |
|---|---|
| Text | `AI preview · not filmed footage` |
| Position | Bottom-left, 24px from left edge, 20px from bottom |
| Size | **14px at 1080p** (~1.3% of frame height) — deliberately small and unobtrusive |
| Style | White, 70% opacity, with a subtle 1px dark drop shadow so it stays readable over bright kitchens and windows |
| Duration | Entire video, including the title card |
| Renders | Appears on **both** the watermarked and the clean render |

Do not shrink it below 14px. It has to remain legible on a phone to do its job (§2.5) — the drop
shadow is what lets it stay this small without disappearing against white walls. Verify legibility
against a bright, blown-out window shot before calling it done.

Watermark for the free render (separate from the label): Proximity logo, bottom-**right**, ~15%
opacity.

---

## 7. Phased execution

### Phase 0 — Scaffold with no credentials

Build everything runnable in **dry-run** first. No API keys needed to get here.

- **Step 1 — watch the reference video (§0) and re-validate the provider choice (§2.4).** Report
  to Ben before writing code. This is the only research step; don't let it sprawl.
- `apps/web/scripts/listing-video/` — the pipeline as a local Node script.
- `--dry-run` mode: runs curation and ordering against **cached local copies** of images, prints
  the full transition plan (ordered images, per-pair scores, generated vs. safe, estimated cost)
  and writes a plan JSON. **Makes zero paid API calls.**
- `--kenburns-only` mode: renders a complete real video using only ffmpeg. **Costs nothing** and
  proves the render/stitch/label path end-to-end before a cent is spent on generation.

Get both working and show Ben the dry-run plan output for 3 listings. This is the checkpoint where
he can sanity-check the ordering logic before paying for anything.

### Phase 1 — Three test videos

Once Ben has added credentials (§9), run the full pipeline on **exactly three** listings chosen to
span the range:

| Listing | ID | Why |
|---|---|---|
| 7307 Delmar Blvd, University City | `c0b68f37-24b7-48da-a00f-ccf6c8d2bda1` | 25 images — best case |
| 5608 Pershing Ave, St. Louis | `08b03a77-bb66-4ac1-b7f5-bb5f7a473297` | 25 images — second best case |
| Kingsland Courtyard | `45bc9599-65ec-4cac-9cde-5a3f148bca84` | 20 images, **known contaminated** with renderings + floorplans — proves the filter works |

Deliver to Ben: the 3 mp4s, plus for each one the transition plan (what was generated vs. safe and
why), the actual cost, and the list of images that were filtered out with reasons.

**Then stop and wait.** Do not proceed without an explicit "go."

### Phase 2 — Full catalog (only on Ben's "go")

- Run over all eligible active listings (~97 hybrid + 6 Ken Burns-only).
- Process serially with a concurrency cap of 3 and a hard **spend ceiling** passed as a flag
  (`--max-spend-usd`), aborting cleanly if hit.
- Resumable: the clip cache (§5) means a re-run skips completed work.
- Write a summary report: per-listing status, cost, duration, skip reasons, total spend.
- Videos land in `status = 'review'`. **Nothing publishes automatically** (R5).
- Build a simple super-only review page at `/dashboard/admin/listing-videos` to watch, then
  approve or reject each one in a queue.

### Phase 3 — Automation layer

Only after Phase 2 is reviewed and live.

**7.4.1 Trigger.** When a listing is created or its images change materially, enqueue a video job.
Hook the existing listing-create path (`src/app/api/addListing`, and the PMS ingest path in
`src/lib/pms`) plus a nightly reconciliation cron (`/api/cron/listing-video`, add to
`apps/web/vercel.json` alongside the three existing crons).

**7.4.2 Landlord control.** On the landlord's listing management UI:

- A toggle: **"Show AI walkthrough video on this listing"** — default **on**.
- When a landlord toggles it **off**, open a textarea: *"What's wrong with it? (optional — helps
  us fix it)"*. Save to `listing_video_feedback`. Email Ben on submission via
  `src/lib/email.js`, gated behind `outreachEnabled()` per `src/lib/appEnv.js`.
- Toggling off hides the video immediately; it does not delete it.
- Show the landlord the clean/unwatermarked download only if their account is entitled (the paid
  perk). Leave the entitlement check behind a single helper so billing can be wired later.

**7.4.3 Render host — decision needed.** Phases 1–2 run locally where ffmpeg exists. Production
has no ffmpeg binary on Vercel. Options, in order of preference:

1. **fal.ai's ffmpeg compose endpoint** — keeps everything serverless, no infra to run. Preferred.
2. `ffmpeg-static` npm package inside a Vercel function — ~80MB, fits under the 250MB limit but
   tight; needs a long `maxDuration`. Workable, slightly risky.
3. A small dedicated worker (Railway/Fly) pulling from a job queue. Most robust, most overhead.

Pick (1) unless it can't do the crossfades and text overlay we need; confirm with Ben before
committing to (3).

**7.4.4 Human approval stays.** Even automated, new videos land in `review`. Ben (or any super)
approves from the queue. This is R5 and it is not optional given §2.5.

---

## 8. Database schema

Migrations go in `supabase/migrations`, and must be applied to **both dev and prod** (`supabase-dev`
and `supabase-prod` MCP tools). Columns snake_case in Postgres, camelCase in the JS layer.

```sql
-- New: one row per listing video
create table listing_videos (
  id                uuid primary key default gen_random_uuid(),
  listing_id        uuid not null references listings(id) on delete cascade,
  status            text not null default 'pending',
                    -- pending|curating|generating|review|published|failed|skipped
  skip_reason       text,
  mode              text,              -- hybrid | kenburns
  url               text,              -- clean / unwatermarked
  watermarked_url   text,
  poster_url        text,
  duration_seconds  numeric,
  manifest          jsonb not null default '{}'::jsonb,  -- R4 provenance
  model             text,
  cost_cents        integer not null default 0,
  error             text,
  generated_at      timestamptz,
  published_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index listing_videos_listing_id_key on listing_videos(listing_id);
create index listing_videos_status_idx on listing_videos(status);

-- New: generated-clip cache, makes re-runs free and Phase 2 resumable
create table listing_video_clips (
  id            uuid primary key default gen_random_uuid(),
  listing_id    uuid references listings(id) on delete cascade,
  cache_key     text not null unique,
  from_image_id uuid references listing_images(id) on delete set null,
  to_image_id   uuid references listing_images(id) on delete set null,
  kind          text not null,         -- generated | safe
  url           text,
  cost_cents    integer not null default 0,
  created_at    timestamptz not null default now()
);

-- New: landlord opt-out feedback
create table listing_video_feedback (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid not null references listings(id) on delete cascade,
  video_id    uuid references listing_videos(id) on delete set null,
  landlord_id uuid,
  reason      text,
  created_at  timestamptz not null default now()
);

-- Listing-level control
alter table listings add column video_enabled boolean not null default true;
alter table listings add column video_opt_out_at timestamptz;
```

`manifest` shape (R4):

```json
{
  "ordered_images": [{"id": "...", "space": "living", "shot_type": "wide"}],
  "filtered_out":   [{"id": "...", "reason": "floorplan"}],
  "transitions":    [{"from": "...", "to": "...", "score": 3, "kind": "generated",
                      "prompt": "...", "duration": 5, "cost_cents": 42}],
  "model": "fal-ai/kling-video/o3/standard/image-to-video",
  "curator_model": "claude-sonnet-5",
  "generated_at": "2026-07-29T00:00:00Z"
}
```

---

## 9. What Ben must obtain — do this LAST

Everything above is buildable and dry-run testable with **no credentials**. Only when Phase 0 is
done and the plan output looks right does Ben need to set these up.

### Required

| # | What | Where | Cost | Env var |
|---|---|---|---|---|
| 1 | **fal.ai account + API key** (or whichever provider wins §2.4 re-validation) | fal.ai | Pay-per-use, **no minimum**. Load ~$25 for Phase 1 | `FAL_KEY` |
| 2 | **Anthropic key for the curator** | Already have one pattern in the repo (`LEASE_SCANNER_KEY`) | ~$0.03–0.05/listing | reuse existing or add `LISTING_VIDEO_KEY` |

R2 and Supabase credentials already exist in the project — nothing new needed there.

**No music subscription needed.** v1 ships silent (§6).

### Not required — explicitly do not buy

- **Higgsfield subscription** — its unlimited tier is web-UI only and cannot be automated.
- **Kling direct API** — same price as fal but credit packs appear to start at $700.
- **vProp or similar** — different product (slideshow, not generative).

### Env var wiring (last step)

Add to `.env.local` for local runs, and to Vercel for staging + production. Never commit
`.env*`. Follow the existing convention in `src/lib/appEnv.js` — gate anything outward-facing
behind `outreachEnabled()`.

---

## 10. Cost model

Per listing, assuming ~6 transitions of which ~4 are generated (typical after adjacency gating):

| Item | Cost |
|---|---|
| 4 generated clips × 5s × $0.084/s | $1.68 |
| Retries (~2.5× realistic on room-to-room pairs) | ~$4.20 total |
| Vision curation + adjacency scoring | ~$0.04 |
| Safe segments, stitching, R2 storage/egress | ~$0.00 (R2 egress is free) |
| **Realistic per listing** | **~$4–8** |

| Milestone | Estimate |
|---|---|
| Phase 1 — 3 test videos | **$15–25** |
| Phase 2 — ~97 hybrid + 6 Ken Burns | **$400–800** |
| Ongoing — per new listing | ~$5 |
| Storage — ~100 videos ≈ 1.5 GB on R2 | ~$0.02/mo |

Pass `--max-spend-usd` on every batch run. Track actual spend in `listing_videos.cost_cents` and
report the total in the Phase 2 summary.

---

## 11. Definition of done per phase

**Phase 0:** `--dry-run` prints a sane transition plan for the 3 test listings; `--kenburns-only`
produces a real, watchable, correctly-labeled mp4. Zero spend. Ben has seen the plan output.

**Phase 1:** 3 mp4s delivered with per-video transition plans, filter reports, and actual cost.
Kingsland's renderings and floorplans are provably excluded. Ben has reviewed. **Stopped, awaiting
"go."**

**Phase 2:** All eligible listings processed, summary report delivered, videos sitting in `review`,
admin review queue works, nothing auto-published, spend within ceiling.

**Phase 3:** New listings auto-enqueue; landlord toggle + feedback textarea live and writing to
`listing_video_feedback`; Ben gets an email on opt-out; human approval gate still enforced; render
host decided and working in production.

Before any PR: run `npm run build` and `npm run lint`, regenerate MCP knowledge
(`node mcp/scripts/generate-knowledge.mjs` or the `update-knowledge` tool) and commit it with the
code, then give Ben a test plan and wait for approval.

---

## 12. Open questions for Ben

1. **Clean-file entitlement** — which landlords qualify today? (Leave it behind one helper if
   billing isn't ready.)
2. **Render host** — confirm fal's ffmpeg endpoint is acceptable for Phase 3, or whether you'd
   rather stand up a small worker.

Already decided, do not re-litigate: **no music** (silent v1, §6), **label text and placement**
(`AI preview · not filmed footage`, small, bottom-left, §6).
