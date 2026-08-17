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
  textPrimary: "#111827", // gray-900
  textSecondary: "#6b7280", // gray-500
  textMuted: "#9ca3af", // gray-400
  border: "#e5e7eb", // gray-200
  surface: "#f9fafb", // gray-50
  surfaceAlt: "#f3f4f6", // gray-100
  white: "#ffffff",
  error: "#ef4444", // red-500
  success: "#15803d", // green-700
  warningBg: "#fef3c7", // amber-100
  warningBorder: "#fbbf24", // amber-400
  warningText: "#92400e", // amber-800
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  full: 999,
};

export const typography = {
  xs: 12,
  sm: 13,
  base: 15,
  lg: 17,
  xl: 20,
  title: 28,
};
