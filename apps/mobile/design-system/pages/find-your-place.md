# Page Override: Find Your Place

> Rules in this file extend/override `design-system/MASTER.md` for the Find Your Place tab only. Everything not mentioned here follows the Master directly.

**Scope:** `apps/mobile/app/(tabs)/find-your-place.js`, `apps/mobile/src/components/findYourPlace/*`.

**What it is:** the mobile version of the website's Find Your Place (`/find-your-place`), which replaced the chat-style Matchmaking on 2026-11-10. The questions, options, wording and rules come from the website and from `@proximity/shared` (`findYourPlace/options.js`); this file only covers how they are laid out on a phone.

**Why this gets an override file:** it is a three-page flow with a fixed header and footer around a scrolling page, unlike the list/detail/form screens the Master describes.

---

## Layout

- **Header** (fixed, `border-gray-100` bottom hairline): a thin progress bar (4px, `gray-100` track, `primary` fill, fully rounded, no number) and "Start over" (`text-xs`, `textSecondary`) on the right. Start over keeps its place and is invisible until there is something to clear.
- **Body:** a scroll view with 16px padding. Each page starts at its top. On page 1 the commute follow-up question scrolls into view when it appears.
- **Footer** (fixed, `border-gray-100` top hairline): the back action on the left ("Back", or "Edit Preferences" on the matches page), the forward action on the right ("Next", disabled until all five answers are given, or "Show My Matches"). Footer buttons are pills (40px high): primary is `primary` fill with white text, disabled is `gray-200` with `textMuted` text, secondary is `gray-100` with `gray-700` text.

## Answers

- Every answer is the canonical `Chip` (`src/components/ui/Chip.js`): red fill when selected, white with a grey edge when not. "No Preference" uses the `muted` tone (grey) and turns red when selected.
- Typed answers (rent, the exact size of a 5+ group, an "Other" lease length) are pill-shaped number fields (40px high), with a red edge and red text once they hold a value. They follow chips in the same wrapping row.
- "Other" move-in opens a bottom sheet listing the next 18 months (top corners at `container` radius). The chip then shows the chosen month.
- Page 2's text box uses `control`-plus radius (`rounded-2xl`), `surface` background, and grows to a fixed maximum before it scrolls. Prompt rows sit under it, separated by `border-gray-100` hairlines, each with its label above its chips.

## Matches

- One column of cards, each following the Browse `ListingCard` treatment (photo on top at 16:9, `container` radius, `border-gray-100`, heart on the photo), then the reason in `text-sm` `gray-700` and any caveat in `text-xs` red. The card ends with an outlined red "Contact" pill and the rating.
- While the search runs, four grey skeleton cards sit under "Finding your top matches...". The set is shown together once every listing has loaded, or after 2.5 s.
- "Browse All N Matches" is an outlined red pill under the heading.
- Error and empty states are a title (`text-[15px]` semibold) and a line of `textSecondary` text, with one primary `Button` (or the outlined Browse pill for the empty state).
