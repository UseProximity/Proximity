# Page Override: Chat

> ⚠️ Rules in this file extend/override `design-system/MASTER.md` for the Chat tab only. Everything not mentioned here follows the Master directly.

**Scope:** `apps/mobile/app/(tabs)/chat.js`, `apps/mobile/src/components/matchmaking/*`.

**Why this gets an override file:** Chat is a bubble-and-composer interface — structurally unlike every other screen in the app (list/detail/browse/form). Bubble layout, message-direction-based styling, and a pill-shaped composer are conventions specific to chat UIs and don't belong in the Master's general component list.

---

## Message bubbles

- **Assistant ("Proxy") bubbles:** `surfaceAlt`/`gray-100` background, `textPrimary` text, rounded with one flattened corner toward the avatar (`rounded-2xl rounded-tl-sm`, already the current shape) — keep.
- **User bubbles:** use `primary` background with white text, or a `primarySoft` tint with `textPrimary` text — pick one consistently at implementation time (not decided further here; both are Master-compliant options, this is a visual-preference call for whoever implements it).
- **Avatar:** small circular `primary`-filled badge with a single-letter mark ("P" for Proxy) — keep the existing shape, just confirm it sits on the `primary` token rather than a hardcoded hex.

## Typing indicator

Keep the existing shape (avatar + `surfaceAlt` bubble + muted text, "Proxy is typing…") — it already matches Master's restrained-motion principle (no elaborate animation, just a static indicator).

## Composer

The message input is **pill-shaped** (`pill` radius / fully rounded) — this is an intentional exception to Master's `control` radius (12px) for standard text inputs. Chat composers are conventionally pill-shaped across the industry, and it visually pairs with the circular send button next to it. Send button: circular, `primary` fill when text is present, a lighter/disabled tint (`red-200`-equivalent) when empty — reconcile the disabled tint toward a documented token at implementation time rather than a one-off hex.

## Quick-reply / answer chips

`AnswerBar.js`, `ChoiceChips.js`, `MultiChoiceChips.js`, `BudgetInput.js` all reuse the Master's canonical `Chip` (see `pages/add-listing.md` for where that shared component lives) — no separate chip styling needed here.

## Recommendation cards

`RecommendationCard.js` follows Master's `container` radius (16px) and border-led card treatment directly — no override needed.
