# Implementation Plan — Proxy Matchmaking Chatbot

> **Audience:** Sonnet 4.6, executing the build.
> **Status:** Approved by Wyatt 2026-05-21. Cost of Sonnet for chat is acceptable; old form will be archived (not deleted) under `src/_archive/matchmaking-form/`.

---

## 0. Decisions locked

| Decision | Choice |
|---|---|
| Form vs chat | Chat fully replaces the form at `/matchmaking`. Old form moves to `src/_archive/matchmaking-form/`. |
| Auth | Logged-in users only (NextAuth). |
| Listing filter | Lives as a Claude Code skill at `.claude/skills/listing-filter.md`. The chat backend loads the skill markdown at runtime and uses it as the LLM system prompt when scoring listings. Wyatt iterates on the skill markdown without redeploying. |
| Final 3 picks | Slot 1 = "Best Overall Match", Slots 2 & 3 = dynamic intentions derived from the user's top two weights. Each card shows which intention it satisfies. |
| LLM | `claude-sonnet-4-6` for chat orchestration, `claude-haiku-4-5-20251001` for listing-filter calls (cheaper, called on every preference update). |

---

## 1. Architecture overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  /matchmaking page (Next.js client component)                        │
│  ┌──────────────────────┐   ┌──────────────────────────────┐         │
│  │ ChatWindow            │   │ PreferencePanel (side, edit) │         │
│  │ MessageBubble[]       │   │ — name, year, budget, …      │         │
│  │ Composer              │   │ — weights pills              │         │
│  └──────────────────────┘   └──────────────────────────────┘         │
│              │                              │                         │
│              └────────── POST /api/matchmaking/chat ─────────────┐   │
│                                                                   ▼   │
│  src/lib/matchmaking/chatOrchestrator.js                              │
│   ├── loads session from matchmaking_chat_sessions                    │
│   ├── runs Claude conversation (Sonnet 4.6) using questionScript.js   │
│   │     and a structured tool_use schema for preference updates       │
│   ├── after every preference/weight update → calls listingFilter.js   │
│   ├── persists transcript + preferences + recommendations             │
│   └── returns next assistant message + side-panel state               │
│                                                                       │
│  src/lib/matchmaking/listingFilter.js                                 │
│   ├── reads `.claude/skills/listing-filter.md` (cached at module load)│
│   ├── pulls candidate listings from Supabase                          │
│   ├── makes Anthropic (Haiku) call with skill md as system prompt     │
│   └── returns ranked listings + per-listing intention labels          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. File-by-file work order

Execute phases sequentially. Inside each phase, batch reads/writes in a single tool message per CLAUDE.md.

### Phase A — Database (Supabase)

Create one migration file:

**`supabase/migrations/202605210001_matchmaking_chat.sql`**

```sql
-- New table: matchmaking_chat_sessions
CREATE TABLE matchmaking_chat_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'in_progress'
                 CHECK (status IN ('in_progress', 'recommendations_ready', 'abandoned')),
  transcript   JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{role, content, ts}]
  preferences  JSONB NOT NULL DEFAULT '{}'::jsonb, -- structured matchmaking fields
  weights      JSONB NOT NULL DEFAULT '{}'::jsonb, -- {budget: 0.8, location: 0.6, ...}
  candidates   JSONB NOT NULL DEFAULT '[]'::jsonb, -- last filter result (top ~10)
  recommendations JSONB NOT NULL DEFAULT '[]'::jsonb, -- final 3 with intentions
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mcs_user_status ON matchmaking_chat_sessions(user_id, status);

ALTER TABLE matchmaking_chat_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY mcs_owner_all ON matchmaking_chat_sessions FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Extend matchmaking_preferences with weights (nullable for back-compat)
ALTER TABLE matchmaking_preferences
  ADD COLUMN IF NOT EXISTS weights JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Trigger to keep updated_at fresh
CREATE TRIGGER mcs_set_updated_at BEFORE UPDATE ON matchmaking_chat_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

Notes:
- `set_updated_at()` already exists in this project (see migration `202604170024_create_trigger_functions.sql`). If grep shows it's missing, reuse don't redefine.
- Apply via `mcp__supabase-dev__apply_migration` — **not** the prod MCP.
- Validate with `mcp__supabase-dev__list_tables`.

### Phase B — Listing filter skill (the canonical filter spec)

Create **`.claude/skills/listing-filter.md`**:

````markdown
---
name: listing-filter
description: Ranks Proximity listings against a user's matchmaking preferences and weights, returning the top N with per-listing intention labels.
---

# Listing Filter

You are a ranking engine for student off-campus housing listings near WashU.

## Inputs
- `preferences`: structured user prefs (budget_min, budget_max, group_size,
  area, lease_term, furnished, move_in_date_*, open_to_roommates, priorities,
  student_type, commute, medical_campus, notes)
- `weights`: numbers 0..1 indicating how much the user cares about each
  dimension. Keys: budget, location, amenities, value, reviews, walkability,
  group_fit, lease_flexibility, social.
- `candidates`: array of listings with full shape (see LISTING_SELECT in
  src/app/api/getUser/route.js). Each has id, title, address, leases (rent,
  bedrooms, bathrooms), amenities, reviews, lat/long, etc.

## Scoring rules
1. Hard filter: drop listings where the cheapest active lease's rent > budget_max
   or bedrooms < group_size, or where lease_availability conflicts with move-in
   window.
2. Score each surviving listing on each weighted dimension (0..1):
   - budget: 1 if rent ≤ midpoint, decaying linearly to 0 at budget_max
   - location: 1 if address neighborhood ∈ preferences.area, else 0.4 if walk
     distance to WashU campus ≤ 15min, else 0.1
   - reviews: avg rating / 5, weighted by review count saturation (1 - 1/(1+n/3))
   - value: rent per bedroom rank-normalized within candidates
   - amenities: jaccard(preferences-derived amenity wishlist, listing amenities)
   - walkability/social/lease_flexibility/group_fit: use notes + lease_term
3. Final score = Σ weight_k × score_k normalized.

## Intentions
After ranking, assign each top-N listing **one** intention from:
"Best overall match", "Closest to campus", "Best value", "Best reviews",
"Most amenities", "Most flexible lease", "Best social fit".
The caller will request which intentions are needed; honor that.

## Output (JSON ONLY, no prose)
```json
{
  "ranked": [
    {
      "listing_id": "uuid",
      "score": 0.87,
      "intention": "Best overall match",
      "reason": "one sentence the bot can show the user"
    }
  ]
}
```
````

This skill spec is **both** the runtime prompt (loaded by `listingFilter.js`) and the document Wyatt iterates on locally via Claude Code.

### Phase C — Server libs

**`src/lib/matchmaking/questionScript.js`** — exports the ordered question plan. Source of truth for what Proxy asks. Copy verbatim:

```js
// Ordered question plan. The chat orchestrator walks this list and stops to
// resolve tradeoffs whenever two answered prefs conflict on weight.
export const QUESTION_PLAN = [
  { id: "name_confirm",     field: "name",                kind: "confirm_or_replace", prompt: "I have your name as {{name}} — should I call you that, or do you go by something else?" },
  { id: "year",             field: "year_of_school",      kind: "choice",  options: ["Freshman","Sophomore","Junior","Senior","Grad","Med","Other"] },
  { id: "group_size",       field: "group_size",          kind: "choice",  options: ["1","2","3","4","5","6+"] },
  { id: "budget",           field: "budget",              kind: "budget_range" },
  { id: "area",             field: "area",                kind: "multi",   options: ["The Loop","Central West End","Clayton","DeMun","DeBaliviere","No preference"] },
  { id: "lease_term",       field: "lease_term",          kind: "choice",  options: ["Semester only","Full year only","Open to either"] },
  { id: "move_in_window",   field: "move_in_dates",       kind: "date_range" },
  { id: "furnished",        field: "furnished",           kind: "yesno_pref" },
  { id: "commute",          field: "commute",             kind: "multi",   options: ["Walk","Bike","Drive","Transit"] },
  { id: "priorities",       field: "priorities",          kind: "pick_two", options: ["Close to campus","Good value","Great reviews","Amenities","Quiet/study","Social/parties","Close to other WashU students"] },
];

// Mapping: question.id → which weight keys it influences (used to compute weights jsonb)
export const WEIGHT_MAP = {
  budget:     { budget: 0.7 },
  area:       { location: 0.7, walkability: 0.4 },
  lease_term: { lease_flexibility: 0.6 },
  furnished:  { amenities: 0.3 },
  commute:    { walkability: 0.6 },
  priorities: { /* populated dynamically from selected priorities */ },
};
```

**`src/lib/matchmaking/listingFilter.js`** — server-side filter that wraps the skill:

- At module load: `fs.readFileSync('.claude/skills/listing-filter.md', 'utf8')` once, cache in module scope. Use `process.cwd()` + path join. Catch & log if missing; throw if not found (do not silently fall back).
- Export `async function rankListings({ preferences, weights, requestedIntentions, limit = 10 })`.
- Steps inside:
  1. Pull up to ~80 candidate listings from Supabase using the existing `LISTING_SELECT` shape (extract that constant into `src/lib/listings/listingSelect.js` first; then import from both the existing `getUser/route.js` and here — keep behavior identical).
  2. Pre-filter in JS: drop deleted, drop unavailable, drop listings where min active lease rent > `preferences.budget_max * 1.1` (10% slop). Keep ≤ 30.
  3. Call Anthropic with `claude-haiku-4-5-20251001`, system = the skill markdown, user = JSON.stringify({ preferences, weights, candidates: prunedList, requestedIntentions, limit }). Instruct JSON-only in the user message.
  4. Parse, validate with Zod (`zod` already in deps), return `{ ranked: [...], usage }`.
- Add **prompt caching** on the system prompt (the skill md is large and stable): set `cache_control: { type: "ephemeral" }` on the system block. Critical because re-called on every turn.

**`src/lib/matchmaking/chatOrchestrator.js`** — the brain:

- Export `async function handleTurn({ session, userMessage, userId })` returning `{ assistantMessage, session }`.
- Internals:
  1. Append user message to `session.transcript`.
  2. Build the Claude API call:
     - Model: `claude-sonnet-4-6`.
     - System prompt: the Proxy persona (see §F below). Define inline in this file.
     - Tools (Anthropic SDK `tools` parameter — see `claude-api` skill):
       - `update_preferences(patch: Partial<Preferences>)` — merges into `session.preferences`.
       - `update_weights(patch: Partial<Weights>)` — merges into `session.weights`.
       - `ask_tradeoff(optionA, optionB, reasonShown)` — model surfaces a tradeoff Q to the user (orchestrator returns the model's text turn unchanged; this tool is mostly a marker so the UI can render tradeoff chips).
       - `finalize_recommendations(intentions: string[3])` — model declares it's done collecting; orchestrator runs `rankListings` requesting exactly those 3 intentions (one must be "Best overall match") and returns the top 3.
     - Messages: pass `session.transcript` (truncated to last ~20 turns) plus the current user message.
  3. Loop on the assistant response: if tool_use blocks present, execute them (mutating session.preferences/weights/recommendations), then call `rankListings` (top-10) and feed `tool_result` back. Stop when the model returns a pure text turn (or `finalize_recommendations` ran).
  4. After every turn where preferences or weights changed, call `rankListings({ limit: 10 })` and store result in `session.candidates`. Don't surface to user yet — this is for the side panel preview.
  5. Persist updated session to Supabase.
- Guard: max 12 turns before the orchestrator forces `finalize_recommendations`. Caps cost.

### Phase D — Backend route

**`src/app/api/matchmaking/chat/route.js`**:

- `POST` handler: auth required via `auth()`. Body: `{ sessionId?: string, message: string }`.
  - If no `sessionId`, create a fresh `matchmaking_chat_sessions` row. Seed `preferences.name` from `users.name` (so the first `name_confirm` question can interpolate it).
  - If `sessionId`, load it, verify `user_id` matches. Reject otherwise.
  - Call `chatOrchestrator.handleTurn`. Return `{ sessionId, assistantMessage, preferences, weights, candidates, recommendations, status }`.
- `GET` handler: returns the user's most recent in-progress session, or null. Used by the client to resume.
- `PATCH` handler: lets the side panel edit a preference. Body: `{ sessionId, patch: { field: value } }`. Merges into `preferences`, recomputes `candidates` via `rankListings`, returns updated state. Does **not** re-trigger the bot's narrative — the bot will acknowledge edits on the next user turn.

### Phase E — Frontend

**Replace `src/app/matchmaking/page.js`** to render the new client (drop the existing `ConciergeFormClient`). Keep `<Footer />`.

**Move (not delete) the old form**: `git mv src/app/matchmaking/concierge-form-client.js src/_archive/matchmaking-form/concierge-form-client.js`. Keep one stub README in `src/_archive/matchmaking-form/` noting "archived 2026-05-21, replaced by chat at /matchmaking; see docs/matchmaking-chatbot-plan.md".

**New files under `src/components/matchmaking/`:**

| File | Responsibility |
|---|---|
| `ChatClient.js` (the page client, `"use client"`) | Owns session state. On mount: GET `/api/matchmaking/chat`; if no session, send a synthetic "start" message. Renders `ChatWindow` + `PreferencePanel` side-by-side (≥ md), stacked on mobile (panel collapses to a top drawer). |
| `ChatWindow.js` | Scrolling transcript. Sticky composer at bottom. Reuses `@chatscope/chat-ui-kit-react` if it fits — otherwise plain Tailwind (already used in `src/components/chat/ChatWidget.js` — match that style). |
| `MessageBubble.js` | Renders user vs Proxy messages. Renders tradeoff chips when the assistant emitted an `ask_tradeoff` tool call. |
| `PreferencePanel.js` | Right rail. Shows every field in `session.preferences` as an editable row. Edits call `PATCH /api/matchmaking/chat`. Weights shown as horizontal bars with little labels — read-only. |
| `RecommendationCards.js` | Final view. Three big cards stacked, each labeled with its intention ("Best Overall Match", "Best Value", etc.) and showing the listing's hero image, address, rent, top-3 amenities, and Proxy's one-sentence reason. Card click → `/listings/[id]`. |

Side-panel UX rules (lock these in):
- Editing a field **does not** rewind the chat. Bot doesn't re-ask.
- When the user changes a value, show a small toast: "Updated — new matches loading…", and refresh the panel's candidate preview.
- The "weights" section is read-only in v1. Users influence weights only through their answers and tradeoff choices.

Mobile: panel collapses to a "View your answers" button at top of the chat. Tapping opens a bottom sheet.

### Phase F — Question loop behavior (Proxy persona)

Put this **inside** `chatOrchestrator.js` as the system prompt constant. Verbatim:

```
You are Proxy, the matchmaking assistant for Proximity (an off-campus housing
platform for WashU students). Your job: collect the user's housing preferences
through a friendly conversation, then recommend three listings.

Voice: warm, concise, lightly playful. One question per turn. Never produce
walls of text. Acknowledge each answer in one short clause before moving on.

Process:
1. Greet the user, introduce yourself as Proxy.
2. Walk the QUESTION_PLAN in order. For each question, call update_preferences
   the moment the user answers. Recompute weights via update_weights when an
   answer maps to a weight (see WEIGHT_MAP).
3. If two collected preferences imply conflicting weights (e.g. tight budget
   but wants downtown amenities), call ask_tradeoff and pose the tradeoff to
   the user. Use their answer to set the relative weight (winner = 0.8,
   loser = 0.3).
4. When you have answered questions for: name, year, group_size, budget,
   area, lease_term, move_in window, and at least one priority — and you've
   resolved any tradeoffs — call finalize_recommendations with exactly three
   intentions. The first MUST be "Best overall match"; choose the other two
   from the user's top two weighted dimensions.
5. After finalize_recommendations runs, deliver a short closing message
   announcing the 3 picks — the UI shows the cards.

Hard rules:
- Never ask more than one question per message.
- Never invent preferences the user didn't state.
- Never recommend listings inline — only via finalize_recommendations.
- If the user goes off-script, gently steer back.
```

### Phase G — Wire-up smoke tests

After building, manually verify (use the `run` skill or just `npm run dev`):

1. Log in as a test student account.
2. Visit `/matchmaking`. Confirm:
   - Greeting appears within ~2s.
   - First question is the name confirmation, with the user's existing name interpolated.
3. Answer 3 questions. Open the side panel. Confirm fields filled in.
4. Edit a value in the side panel. Confirm toast appears and candidates refresh (check Network tab).
5. Continue until `finalize_recommendations` fires. Confirm 3 cards render with three **distinct** intentions, first one labeled "Best Overall Match".
6. Refresh the page. Confirm the existing in-progress session reloads (via `GET`).
7. Check `matchmaking_chat_sessions` row exists with full transcript + recommendations JSON.
8. Confirm no calls to `/api/matchmaking` (the old form route) happen from the chat path — that route stays available for the archived form but the chat must not touch it.

If any verification fails, do **not** silently work around it — surface the failure to the user and stop.

---

## 3. Out of scope for this PR

Do not build these even if tempted:
- Editing weights directly in the side panel (read-only in v1).
- Sharing/exporting recommendations.
- Re-running the bot from a "start over" button — handled by deleting the in-progress session manually for now.
- Analytics events beyond what already exists in this codebase.
- Migrating existing `matchmaking_preferences` rows into chat sessions.

---

## 4. Risks to flag back to Wyatt before coding

1. **Skill markdown loading in serverless**: Vercel's Next.js runtime needs `.claude/skills/listing-filter.md` to be in the deployment bundle. Use `path.join(process.cwd(), ...)`; verify it ships by checking `.vercel/output/` after a build. If not, duplicate the file into `src/lib/matchmaking/listing-filter.skill.md` and load from there (still authored as a Claude Code skill via symlink or sync script).
2. **RLS**: the new RLS policy assumes `auth.uid()` is the Supabase auth uid. This codebase uses NextAuth and a custom `users` table. Verify the existing `matchmaking_preferences` policy pattern — if writes happen with the service role from the API route, mirror that (do not trust client-side Supabase).
3. **Prompt caching**: confirm the @anthropic-ai/sdk version in package.json (^0.95.1) supports `cache_control` blocks. If not, bump first.

---

## 5. Execution order checklist

```
[ ] 1. Confirm risks 1–3 with the user
[ ] 2. Extract LISTING_SELECT to src/lib/listings/listingSelect.js
[ ] 3. Write & apply supabase migration (dev branch first)
[ ] 4. Create .claude/skills/listing-filter.md
[ ] 5. Build src/lib/matchmaking/{questionScript,listingFilter,chatOrchestrator}.js
[ ] 6. Build src/app/api/matchmaking/chat/route.js
[ ] 7. Build components in src/components/matchmaking/
[ ] 8. Swap src/app/matchmaking/page.js to the new client
[ ] 9. Move old form to src/_archive/matchmaking-form/ via `git mv`
[ ] 10. Run smoke checklist in §G
[ ] 11. npm run lint && npm run build before committing
```
