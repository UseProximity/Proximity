const plugin = require("tailwindcss/plugin");

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx}", "./src/**/*.{js,jsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      // DM Sans (design-system/MASTER.md §3), loaded via
      // @expo-google-fonts/dm-sans in app/_layout.js. `font-sans` is applied
      // once at the root (see _layout.js) and cascades to descendant Text
      // via NativeWind v4's style inheritance, rather than needing every
      // screen to opt in.
      fontFamily: {
        sans: ["DMSans_400Regular"],
      },
    },
  },
  plugins: [
    // @expo-google-fonts/dm-sans registers each weight as its own font
    // family name (DMSans_400Regular, DMSans_700Bold, ...) — React Native
    // does not synthesize bold from a single custom family the way it does
    // for system fonts. Redefining the font-weight utilities to also set
    // the matching family keeps the existing font-normal/medium/semibold/
    // bold className vocabulary working across the app without a per-file
    // rewrite.
    plugin(({ addUtilities }) => {
      addUtilities({
        ".font-normal": { fontFamily: "DMSans_400Regular", fontWeight: "400" },
        ".font-medium": { fontFamily: "DMSans_500Medium", fontWeight: "500" },
        ".font-semibold": { fontFamily: "DMSans_600SemiBold", fontWeight: "600" },
        ".font-bold": { fontFamily: "DMSans_700Bold", fontWeight: "700" },
      });
    }),
  ],
};
