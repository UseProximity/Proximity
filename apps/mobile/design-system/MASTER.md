# Proximity Mobile — Design System (Master)

> **Scope:** This document describes the **Proximity mobile app only** (`apps/mobile`, Expo + React Native + Expo Router + NativeWind).
> It does **not** change, redefine, or apply to the Proximity **web** app (`apps/web`). Web is referenced in a few places below for brand-continuity context (existing colors, terminology) — that is a reference, not a target. Nothing in this document authorizes or implies a change to any file under `apps/web`.

> **Override logic:** When implementing a specific mobile screen or feature, first check `design-system/pages/<name>.md`. If that file exists, its rules extend/override this Master for that area. Otherwise, follow this Master directly. Today the only overrides are `pages/add-listing.md` and `pages/matchmaking.md` — every other mobile screen (Browse, Listing Detail, Saved, Profile, the 3 auth screens, Profile Completion, Filters, the placeholder Chat tab) implements this Master directly with no override file of its own.

> **Status:** Implemented (Stages A–H, plus a Stage H revision pass after on-device review). `apps/mobile/src/theme/tokens.js` and `apps/mobile/src/components/ui/*` reflect this system.

---

## 1. Brand & Personality

**Direction: "Quiet confidence."** Minimal, modern, trustworthy, youthful, warm, premium but approachable, clean, polished, student-focused. A serious and trustworthy housing product that still feels designed specifically for students — not a generic enterprise tool, not a gamified/playful app.

**Explicitly avoid:**
- Generic AI/SaaS aesthetics
- Overly corporate/enterprise styling
- Overly playful/gamified styling
- Excessive gradients or excessive colors
- Visual clutter
- Unnecessarily huge typography
- Overly flashy/decorative animation
- "Startup template" aesthetics
- Anything that reads cheap or untrustworthy (this includes emoji-as-UI-icon — see §6)

**Brand continuity:** The existing Proximity web app is the reference for brand identity (its actual `red-600` primary color, terminology, functionality) — not for literal visual replication. A few of web's own UI choices are deliberately **not** carried over to mobile; see §11.

---

## 2. Color System

No new brand hue. **Red-600 remains the single primary color.** This is a formalization of what already exists in `apps/mobile/src/theme/tokens.js`, with one addition (`primarySoft`) and explicit documentation of a distinction that already exists in code but was undocumented (`error` vs `primary`).

| Role | Hex | Tailwind/NativeWind name | Usage |
|---|---|---|---|
| `primary` | `#DC2626` | `red-600` | Brand, primary actions, active/selected state |
| `primaryPressed` | `#B91C1C` | `red-700` | Pressed/active state of primary elements |
| `primarySoft` *(new)* | `#FEF2F2` | `red-50` | Selected-chip tint, subtle highlight banners — formalizes a pattern already used ad hoc in a few places |
| `textPrimary` | `#111827` | `gray-900` | Headings, primary body text |
| `textSecondary` | `#6B7280` | `gray-500` | Secondary text, meta info |
| `textMuted` | `#9CA3AF` | `gray-400` | Placeholder text, disabled labels |
| `border` | `#E5E7EB` | `gray-200` | Default borders, dividers |
| `surface` | `#F9FAFB` | `gray-50` | Input backgrounds, subtle section fills |
| `surfaceAlt` | `#F3F4F6` | `gray-100` | Secondary surface fill (e.g. segmented control track) |
| `white` | `#FFFFFF` | `white` | Card/screen backgrounds |
| `success` | `#15803D` | `green-700` | Success states, confirmations |
| `warningBg` / `warningBorder` / `warningText` | `#FEF3C7` / `#FBBF24` / `#92400E` | `amber-100` / `amber-400` / `amber-800` | Warning banners (e.g. "email not verified") |
| `error` | `#EF4444` | `red-500` | Error text/icons — **intentionally distinct from `primary`** (see rule below) |
| `infoBg` / `infoBorder` / `infoText` | `#EFF6FF` / `#BFDBFE` / `#1E3A8A` | `blue-50` / `blue-200` / `blue-900` | Informational tip callouts (e.g. password requirements). Body text within an info callout uses `blue-700` as a lighter second tier under the `blue-900` heading — a deliberate two-shade hierarchy, not a separate token. Added Stage F, formalizing a pattern that already existed ad hoc in `change-password.js`. |

**Rule:** `error` (`red-500`) and `primary` (`red-600`) are deliberately different shades of red. Close enough to read as "the same family," different enough that an error message is never visually confusable with a call-to-action. Do not consolidate these into one red.

**Rule:** No secondary "CTA accent" color. Some marketplace-style palettes pair a trust color with a separate transaction/CTA color — that pattern doesn't apply here, since `primary` already serves as both the brand color and the CTA color everywhere in the app today, and changing that would be the exact "two design systems" problem this whole exercise exists to avoid.

---

## 3. Typography

**Font: DM Sans** — single family, multiple weights, used for both headings and body text. Approved as the Google Fonts-native equivalent of a "premium, modern, clean, sophisticated, balanced" pairing, without the generic "SaaS" connotation of some of the alternatives considered.

- **Weights:** 400 (body/regular), 500 (medium/labels), 600 (semibold/buttons), 700 (bold/headings)
- **Implementation note (for the future code step, not decided further here):** load via `@expo-google-fonts/dm-sans` + `expo-font`'s `useFonts`, applied as the app-wide default rather than per-component overrides.

**Type scale** (extends the partial scale already in `tokens.js` rather than replacing it):

| Token | Size (px) | Weight | Usage |
|---|---|---|---|
| `xs` | 12 | 400/500 | Captions, badges, meta text |
| `sm` | 13 | 400/500 | Secondary text, form labels |
| `base` | 15 | 400 (body) / 700 (section headers) | Body text. **Section headers use bold weight at this size, not a larger size** — matches the existing Listing Detail convention ("Details", "Reviews") |
| `lg` | 17 | 500/600 | Emphasized body, list-row titles |
| `xl` | 20 | 700 | Screen-section headers |
| `title` | 28 | 700/800 | Screen-level headers (e.g. wizard step titles) |
| `display` *(new)* | 40 | 800 | Reserved for one-off brand moments only (the auth screens' wordmark) — not for general use |

**Rule:** Prefer weight-driven hierarchy over size-driven hierarchy wherever both would work. This is what keeps the type system feeling restrained rather than "unnecessarily huge."

Line-height: comfortable (~1.4–1.5×) for body copy; RN's narrow viewport makes the web "65-75 characters per line" guidance largely moot, but generous line-height still matters for readability in descriptions/messages.

---

## 4. Spacing & Radius

**Spacing** — unchanged from `tokens.js`, it already matches real usage closely:

| Token | Value |
|---|---|
| `xs` | 4 |
| `sm` | 8 |
| `md` | 12 |
| `lg` | 16 |
| `xl` | 24 |
| `xxl` | 32 |
| `xxxl` *(new)* | 80 |

`xxxl` formalizes the empty-state vertical offset already used ad hoc (`mt-20`) as a named, documented convention instead of a magic number.

**Radius — a genuine two-tier system**, resolving a real split found between mobile's current mixed usage and web's actual card radius:

| Token | Value | Applies to |
|---|---|---|
| `control` | 12px | Buttons, text inputs, chip-as-rectangle elements — already what `Button.js`/`TextField.js` use |
| `container` | 16px | Cards, sheets, images — matches web's actual `ListingCard`/`MapPopupCard` (`rounded-2xl`), which mobile's current `Card.js` (12px) currently undershoots |
| `pill` | fully rounded | Chips, badges, avatars, chat composer, Browse's search field + its matched circular Filters button (an intentional exception to `control` for standard text inputs/icon buttons — search bars are conventionally pill-shaped in mobile UI, same reasoning as the chat composer) |

The 8px-radius drift originally noted here (Browse's search bar, the Filters button, Listing Detail's contact form inputs) has been resolved — all three are on their correct tiers now.

---

## 5. Elevation / Shadows

**One tier, used sparingly.** This is a deliberate platform difference from web (see §11): mobile's existing code uses almost no shadow at all (one instance app-wide, a map marker), while web's cards lean on `shadow-lg`/`shadow-2xl` fairly liberally. Repeating heavy shadows down a scrolling mobile list reads dated/heavy and costs more to render (particularly Android `elevation`).

**The one tier, for genuinely floating elements only** (bottom sheets/modals when they lift off the page content, floating map controls):

```
shadowColor: "#000000"
shadowOffset: { width: 0, height: 2 }
shadowOpacity: 0.08
shadowRadius: 8
elevation: 3        // Android
```

**Not used for:** standard cards, list rows, or buttons — those stay border-led (`border` token, §2) with no shadow at all.

**A second, lighter tier, narrowly reserved for card-stack pages** (`tokens.js`'s `shadows.subtle`) — a page built as several substantial content cards on a light (`gray-50`) page background (Listing Detail) wants a gentler "just barely lifted" feel than the primary tier gives isolated floating controls, not the same weight repeated down a whole page of cards:

```
shadowColor: "#000000"
shadowOffset: { width: 0, height: 1 }
shadowOpacity: 0.05
shadowRadius: 6
elevation: 2        // Android
```

This is a named, intentional exception, not a general-purpose second tier — new floating controls (sheets, map buttons) still use the primary tier above.

---

## 6. Iconography

**System: `lucide-react-native`**, replacing the Unicode/emoji glyphs currently used throughout the app (♥ / ♡ for favorites, → for send buttons, ✓ for confirmations, 🚶 for walk times, emoji role-pickers in Profile Completion).

**Why this, specifically:**
- Web already uses `lucide-react` (confirmed in `StepUnits.js`, `StepPhotos.js` — `Plus`, `X`, `Camera`). This is mobile converging on web's existing icon vocabulary, not inventing a new one.
- `react-native-svg`, what `lucide-react-native` renders through, is already an installed dependency — low incremental cost.
- Emoji-as-icon is explicitly flagged by UI/UX Pro Max's own rule set as an unprofessional/"cheap" tell, which lines up directly with what you asked to avoid.

**Usage rules:**
- Standard sizes: 20px (inline/compact contexts) or 24px (default touch-adjacent icons), `strokeWidth={2}` (Lucide's default).
- Icon color follows the semantic tokens in §2 — `textSecondary` by default, `primary` when active/selected/pressed, `error`/`success`/`warning` text colors when paired with those states.
- Star ratings may keep a filled/outline approach (via Lucide's `Star` icon) for visual consistency with the rest of the icon system — flagged as an implementation-time decision, not a blocker.

---

## 7. Core Component Principles

**Buttons** — keep the existing 3-variant structure (`primary` / `secondary` / `ghost`), sizes `md`/`lg`. Radius: `control` (12px). Minimum touch height 44px (already true for `md`/`lg`). Press feedback: opacity or color shift to `primaryPressed`, ~150–200ms. Loading state via spinner (unchanged from current `Button.js` behavior).

**Text inputs** — bordered/filled (`surface` background, `border` outline), radius `control` (12px), minimum height 44px, label above, error message below in `error` color. Error messages should be programmatically announced at implementation time (`accessibilityLiveRegion`/`accessibilityRole="alert"`) — see §9.

**Cards** — radius `container` (16px), `border`-outlined, white background, **no default shadow** by default. Tappable cards (e.g. `ListingCard`) get a subtle press state (background or border color shift) rather than a shadow lift. **Exception**: a page built as a stack of a few substantial, non-tappable content sections on a light (`gray-50`) page background — Listing Detail's Quick facts/Description/Amenities & Utilities/Location/Reviews/Contact landlord sections are the first case — uses the lighter `shadows.subtle` tier from §5 on each card, with a soft near-page-color border (`border-gray-50`, blending toward the page background rather than reading as a hard edge), so the cards read as gently lifted surfaces without standing out too heavily against the page. This is deliberately reserved for a handful of major sections per screen, not every piece of content — the goal is a clean hierarchy of a few cards, never a screen full of nested boxes.

**Chips/tags** — `pill` radius. Selected: `primary` background, white text. Unselected: white background, `gray-300` border, `textPrimary`/`gray-700` text. This is already the shape of `wizardShared.js`'s `Chip` — that becomes the canonical pattern going forward (see `pages/add-listing.md`). `ui/Chip.js` (the promoted, canonical version) also supports two additive, opt-in props used by `FilterSheet.js`: `showCheck` (prefixes a small checkmark on the selected state — for contexts like Filters where selection needs to read unambiguously, not just via color) and `icon` (prefixes a small Lucide recognition icon — used for Filters' Amenities/Utilities options that have a clean 1:1 icon, not applied everywhere). The two aren't designed to combine on the same chip.

**Section headers** — a small icon-badged label (`ui/SectionHeader.js`: 28px `primary`-tinted circle containing a 14px Lucide icon, next to a bold title, optional muted subtitle) marks a distinct group within a longer form or content screen. Used to break `FilterSheet.js`'s options into 4 visually distinct clusters (Budget & Size, Property, Amenities & Utilities, Location & Move-in — each in its own `bg-gray-50 rounded-2xl p-4` container) and to separate Listing Detail's sections (Details, Location, Reviews, Contact landlord). This is the standard pattern for "this is a new section" going forward, in place of a bare bold `Text` title.

**Photo-overlay icon treatment** — `HeartIcon.js` supports an opt-in `onImage` prop for icons sitting directly on a photo with **no background container** (`ListingCard`'s corner heart, Listing Detail's hero heart): both saved/unsaved states share a thick white stroke (`strokeWidth={3}` vs. the default `2`) so the icon stays legible against any photo — only **fill** distinguishes the two states, solid `primary` when saved, a semi-transparent black (`rgba(0,0,0,0.35)`) when not, so the photo shows through the heart's interior rather than it reading as a flat dark shape. Default is `false`, so contexts on a plain white background (e.g. none currently in use) are unaffected.

**Persistent collapsing header** — Listing Detail's back button no longer lives inside the hero (where it would scroll away with the rest of the page); it's a fixed header positioned outside the scroll content, transparent with a `bg-black/40` translucent circle + white icon at rest (visually identical to sitting on the hero), crossfading via scroll-position-driven `Animated.Value` opacity into a solid white app bar (bottom hairline border, dark icon) once the page scrolls roughly past the hero's own measured height. This is the standard pattern for any future screen with a full-bleed hero image that scrolls (Airbnb/Zillow-style listing screens) — reuse this technique rather than a fixed floating button, which reads as disconnected from the rest of the UI.

**Bottom sheets/modals** — when the sheet visually lifts off the page content, apply the one shadow tier from §5. Top corners get `container` radius (16px) on partial-height sheets. Full-screen modals need no radius/shadow (they fill the viewport).

**Navigation/tab bar** (5 tabs): **Browse | Chat | Matchmaking | Saved | Profile**. All 5 tabs use the same flat treatment — active: `primary` icon + label, inactive: `textMuted`. Icons from the Lucide set in §6 — Browse→`Search`, Chat→`MessageCircle`, Matchmaking→`Sparkles` (reads as "AI-assisted smart matching," distinct from Chat's speech-bubble meaning despite the two tabs sitting next to each other), Saved→`Heart`, Profile→`User`.

**Revision note:** Matchmaking briefly had a raised, brand-mark (logo) tab treatment — a 52×52 circle lifted above the bar with `ProximityLogoMark` inside, hidden label — as the true center tab. Reverted after on-device review: it read as too special-cased rather than consistent with the other 4 tabs. `ProximityLogoMark` (`src/components/icons/ProximityLogoMark.js`, ported from `apps/web/public/logo.svg`) still exists in the repo, unused, in case a future screen wants the real brand mark (e.g. a splash/about screen) — it is **not** used in the tab bar.

The Chat tab (`app/(tabs)/chat.js`) is a placeholder only — no functionality, see §7's empty-state pattern below (it doesn't need its own page-override file). The real matchmaking/Proxy conversation experience lives at `app/(tabs)/matchmaking.js` (renamed from `chat.js`) — see `pages/matchmaking.md`.

**List rows** — minimum 44px touch height, consistent 16px horizontal padding, `border-gray-100` row separators rather than a shadow/card per row — consistent with the border-led surface direction.

**Segmented toggles** (e.g. Browse's List/Map view control) — fully `pill`-rounded outer track (`bg-gray-100`), selected segment gets a `primary` fill + white text/icon (not a plain white/light highlight — the brand color reads immediately as "active," matching how selection is communicated everywhere else), small paired Lucide icon + label per segment. Matches the pill shape of Browse's search field and Filters button directly above it, so the header reads as one considered control group.

**Image treatment** — `container` radius (16px) on cover images/carousels, `aspect-video` default for listing photos (already used), `surfaceAlt`/`gray-100` placeholder background while loading (already used). Photo carousels with more than one image get a small pagination affordance — a "1 / N" counter pill (`bg-black/50`, white text, bottom-right corner) rather than dot indicators, since dots get cramped past ~5–6 images and a counter degrades gracefully at any count (Listing Detail's hero carousel).

**Badges** — `pill` radius, semantic color roles matching `Badge.js`'s existing variant naming (`default`/`secondary`/`outline`).

**Loading states** — skeleton rows for list content (Browse) instead of a single full-screen spinner. Centered spinner reserved for full-screen initial loads and button-level loading (both already correctly scoped today).

**Empty states** — icon (Lucide, `textMuted`) + one-line message (`textSecondary`) + optional single action button. Replaces today's bare gray `Text`-only pattern (e.g. "No listings match your search.").

**Error states** — same shape as empty states for full-screen errors; inline `error`-colored text near the specific field for form errors (this part is already the current pattern — just standardized on the `error` token and given a11y wiring, see §9).

**Interaction/pressed/disabled states** — pressed: opacity ~0.85, or a shift to `primaryPressed`/`surface` depending on the element. Disabled: opacity ~0.5, non-interactive.

---

## 8. Motion / Interaction Principles

Minimal and functional, never decorative — directly matching "avoid overly flashy animations."

- **150–250ms** for state transitions: press feedback, sheet open/close.
- No purely ornamental motion (no animation that exists just to look impressive).
- Native default transitions for sheet/modal presentation are fine as-is.
- Avoid scale-transform press/hover effects that shift layout (an explicit UI/UX Pro Max rule, and it also just looks cheap).

---

## 9. Accessibility Principles

- **44×44px minimum touch targets.** `HeartIcon` is a fixed 44×44 `Pressable` regardless of visual icon size (resolved in the shared-primitives pass) — the note that used to flag this as an open risk no longer applies.
- **4.5:1 minimum text contrast.** `primary` (`#DC2626`) on white is already safe for body text (~4.8:1).
- **Errors must be programmatically announced**, not color-only — use RN's `accessibilityLiveRegion="polite"` or `accessibilityRole="alert"` on error text, once implemented.
- **Color is never the sole indicator** of state — pair color with text/icon, as the app already mostly does.
- **Visible pressed/focus states** for all interactive elements (see §7's interaction states).

---

## 10. Mapping to Existing Mobile Components

This system extends the existing foundation — it does not replace its architecture. None of this requires touching Add Listing's functionality or behavior, only shared primitive styling.

| File | Expected change at implementation time |
|---|---|
| `src/theme/tokens.js` | Add `primarySoft`; add `display` typography size and `xxxl` spacing; formalize the two-tier radius (`control`/`container`/`pill`) |
| `src/components/ui/Button.js` | Radius/press-state alignment to §7; eventual icon slot once Lucide lands |
| `src/components/ui/TextField.js` | Radius alignment; error a11y wiring (§9) |
| `src/components/ui/Card.js` | Radius bump 12px → 16px (`container`); confirm no default shadow |
| `src/components/ui/Section.js` | No expected change |
| `src/components/listings/wizard/wizardShared.js`'s `Chip` | Promote to a shared `ui/Chip.js` per §7 (also see `pages/add-listing.md`) |

---

## 11. Intentional Differences from Web

These are deliberate platform choices, not oversights — documented so a future contributor doesn't "fix" mobile to match web by mistake:

1. **Shadows** — web's card language (`MapPopupCard.js`) uses `shadow-lg`/`shadow-2xl` liberally; mobile stays flat/border-led (§5).
2. **Listing Detail structure** — web uses a 5-tab sticky layout; mobile's existing single-scroll screen is correct for touch/viewport and stays as-is.
3. **Dropdowns → sheets** — web's inline dropdowns (e.g. the address-suggestion list in `StepAddress.js`) become native bottom-sheet/modal patterns on mobile rather than literal ports.
4. **Formal type scale** — web has no design tokens at all (stock Tailwind, no `theme.extend`, per `CLAUDE.md`). Mobile having one (§3) is a mobile-specific improvement, not something that needs a web equivalent to trace back to.
5. **Icons** — not really a difference; see §6. Mobile is converging toward web's existing `lucide-react` choice, away from mobile's own current ad hoc Unicode/emoji state.

None of the above implies or requires any change to `apps/web`.

---

## 12. Out of Scope for This Phase

- **Dark mode** — explicitly deferred. Design for light mode only; no dark-mode architecture introduced.
- **Add Listing's functionality/behavior** — this document governs visual styling only. Add Listing's wizard logic, validation, and API behavior (completed separately) are unchanged.
- **Any change to `apps/web`** — web is reference-only throughout this document (see scope note at top).
