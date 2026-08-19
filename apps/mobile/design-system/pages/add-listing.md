# Page Override: Add Listing

> ⚠️ Rules in this file extend/override `design-system/MASTER.md` for the Add Listing wizard only. Everything not mentioned here follows the Master directly.

**Scope:** `apps/mobile/app/listings/add/`, `apps/mobile/src/components/listings/wizard/*`.

**Why this gets an override file:** Add Listing's wizard shell already established its own real, working visual vocabulary (step frame, progress dots, chips, stepper) before this design system existed. That vocabulary is genuinely different in structure from the rest of the app (a multi-step form flow vs. list/detail/browse screens) and is worth documenting explicitly rather than pretending it's identical to the Master's generic component list.

**Explicitly not covered here:** Add Listing's functionality, validation, navigation logic, or API behavior. This file is about re-skinning existing structure onto the Master visual system (§2–§8 of MASTER.md) — nothing here changes what the wizard does or how it behaves.

---

## Step frame pattern

`wizardShared.js`'s `StepFrame` (big question title + optional one-line subtitle + content) is the correct, keep-as-is structural pattern for every wizard screen. At implementation time: title uses `title` (28px/700) from the Master type scale, subtitle uses `sm` (13px) in `textSecondary`.

## Progress indicator

The tappable dot-bar header (`Step X of N · Label` + row of pill segments) stays. Segment colors map directly to Master tokens: active = `primary`, completed = `primarySoft`-adjacent tint (currently `red-300` — reconcile toward a token at implementation time), upcoming = `border`/`gray-200`.

## Chip

`wizardShared.js`'s `Chip` (pill radius, `primary` fill when selected, white/`border` when not) is the **canonical shape** for chips app-wide per MASTER.md §7. At implementation time, promote it out of `wizard/` into `ui/Chip.js` so other screens (e.g. `FilterSheet.js`, which currently has its own near-duplicate local `Chip`) can share one implementation instead of two.

## Stepper

The +/- bedroom/bathroom counter (`wizardShared.js`'s `Stepper`) stays **scoped to the wizard** — no other screen in the app needs a numeric stepper control, so it does not get promoted to `ui/`.

## Cards (unit cards)

`StepUnits.js`'s per-unit `Card` follows Master's `container` radius (16px) and border-led, no-shadow treatment directly — no override needed here.

## Review screen rows

`StepReview.js`'s label/value/"Change" row pattern is specific to this screen and stays as-is structurally; colors/type follow Master directly (label = `xs`/`textMuted`/uppercase, value = `sm`/`textPrimary`, "Change"/"Add" link = `sm`/`primary`).
