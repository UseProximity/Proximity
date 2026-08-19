// Canonical design tokens for new mobile screens (Add Listing onward).
// `primary` mirrors web's actual brand color (apps/web/src/components/ui/
// Button.js's default variant, bg-red-600) and the value already dominant
// across the app (Badge.js, FilterSheet.js) — not the gray-900/#111827
// primary used ad hoc in a few older screens, which is the drift this file
// exists to stop from spreading further.
//
// New components should prefer NativeWind className strings using these same
// Tailwind color names (bg-red-600, text-gray-900, etc.) directly; this file
// is for the cases that need a raw value (icon/ActivityIndicator colors,
// inline styles) so there is one place to look it up instead of a fresh hex
// guess per screen.

export const colors = {
  primary: "#dc2626", // red-600
  primaryPressed: "#b91c1c", // red-700
  primarySoft: "#fef2f2", // red-50 — selected-chip tint, subtle highlight banners
  textPrimary: "#111827", // gray-900
  textSecondary: "#6b7280", // gray-500
  textMuted: "#9ca3af", // gray-400
  border: "#e5e7eb", // gray-200
  surface: "#f9fafb", // gray-50
  surfaceAlt: "#f3f4f6", // gray-100
  white: "#ffffff",
  error: "#ef4444", // red-500 — deliberately distinct from `primary` (red-600):
  // close enough to read as "the same family," different enough that an
  // error message is never visually confusable with a call-to-action.
  success: "#15803d", // green-700
  warningBg: "#fef3c7", // amber-100
  warningBorder: "#fbbf24", // amber-400
  warningText: "#92400e", // amber-800
  infoBg: "#eff6ff", // blue-50 — informational tips (e.g. password requirements)
  infoBorder: "#bfdbfe", // blue-200
  infoText: "#1e3a8a", // blue-900
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 80, // empty-state vertical offset
};

// Two-tier radius system (design-system/MASTER.md §4): `control` for
// buttons/inputs/chip-rectangles, `container` for cards/sheets/images,
// `pill` for chips/badges/avatars. `sm`/`md`/`lg`/`full` are kept as-is
// alongside these (nothing in the codebase referenced them yet, so this is
// purely additive, not a rename).
export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  full: 999,
  control: 12,
  container: 16,
  pill: 999,
};

export const typography = {
  xs: 12,
  sm: 13,
  base: 15,
  lg: 17,
  xl: 20,
  title: 28,
  display: 40, // reserved for one-off brand moments only (e.g. the auth wordmark)
};

// The app's primary shadow tier (design-system/MASTER.md §5) — was
// independently redefined as a local FLOATING_SHADOW constant in
// BrowseMapView.js and Browse's index.js; promoted here once a 3rd caller
// (Listing Detail's card sections) needed the identical values, so all three
// now share one source.
export const shadows = {
  floating: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  // A deliberately lighter second tier, narrowly reserved for Listing
  // Detail's DetailCard stack (design-system/MASTER.md §5/§7) — a page built
  // as several substantial content cards wants a softer "just barely lifted"
  // feel, not the more pronounced lift `floating` gives isolated controls
  // (search bar, filter button, map toggle). Not a general-purpose second
  // tier for arbitrary use.
  subtle: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
};
