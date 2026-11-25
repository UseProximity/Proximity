#!/usr/bin/env node
//
// Pre-renders the Browse map's pins to static PNGs (1x/2x/3x) and writes the
// require() map the app imports. Run after changing the pin artwork or the
// rating buckets:
//
//   npm run generate:pin-icons -w @proximity/mobile
//
// Why this exists: the pins used to be rasterized on the device at runtime
// (hidden react-native-svg views + Svg#toDataURL). On iOS that call looks the
// view up in a native registry and, when the lookup misses, logs "Invalid svg
// returned from registry" and never calls back, so no pin ever appeared. The
// variants are a small fixed set known at build time, so they ship as assets
// instead. Mapbox.Images resolves the @2x/@3x files by device density.
//
// Artwork is ported from apps/web/src/components/listings/MapView.js
// (pinMarkup, buildPinSVGElement, buildClusterPinElement): the flat Figma pin,
// red when available and grey when not, a star filled from the bottom up by
// rating or a dot when unrated, and the gold "Suggested for you" badge. A
// group pin is the bare pin: the map layer draws its count as text. The
// selected pin is the same image drawn larger, so it has no variant here.
//
// Needs `sharp`, which npm hoists to the repo root through the web app's Next
// dependency. It is only used here, at dev time; the PNGs are committed.
const fs = require("fs");
const path = require("path");

let sharp;
try {
  sharp = require("sharp");
} catch {
  console.error("generate-pin-icons: `sharp` is not installed. Run `npm install` at the repo root first.");
  process.exit(1);
}

// Keep the colours and shapes in sync with web's MapView.js.
const AVAILABLE_PIN_COLOR = "#F71C1E";
const UNAVAILABLE_PIN_COLOR = "#A3A3A3";
const UNAVAILABLE_STAR_COLOR = "#E6E7EB";
const PIN_PATH =
  "M30 15.191C30 29 15 42 15 42C15 42 0 29.936 0 15.191C0 6.801 6.716 0 15 0C23.284 0 30 6.801 30 15.191Z";
const STAR_PATH =
  "M6.398 13.684C6.009 13.73 5.853 14.21 6.14 14.475L10.209 18.238C10.326 18.347 10.378 18.508 10.347 18.664L9.267 24.1C9.191 24.483 9.6 24.78 9.941 24.589L14.778 21.882C14.917 21.804 15.086 21.804 15.225 21.882L20.06 24.589C20.402 24.78 20.81 24.483 20.734 24.1L19.654 18.664C19.623 18.508 19.675 18.347 19.792 18.238L23.86 14.476C24.148 14.21 23.992 13.73 23.604 13.684L18.1 13.031C17.942 13.012 17.805 12.913 17.738 12.768L15.417 7.736C15.253 7.381 14.748 7.381 14.585 7.736L12.263 12.768C12.197 12.913 12.059 13.012 11.901 13.031L6.398 13.684Z";
const STAR_TOP = 7.47;
const STAR_BOTTOM = 24.65;
const SUGGESTED_BADGE =
  '<circle cx="25.5" cy="4.5" r="5" fill="#F5B301"/><path d="M25.5 1.8l0.77 1.93 1.93 0.77-1.93 0.77-0.77 1.93-0.77-1.93-1.93-0.77 1.93-0.77z" fill="white"/>';

// The 30x42 pin sits in a larger canvas so its drop shadow and the badge are
// not cut off. Nothing is added below the tip and the sides are equal, so the
// layer's bottom-centre anchor stays on the pin's tip (only the faint shadow
// just under the tip is cropped). Keep in sync with PIN_CANVAS in pinIcons.js.
const PAD_X = 4;
const PAD_TOP = 2;
const WIDTH = 30 + PAD_X * 2;
const HEIGHT = 42 + PAD_TOP;
const SCALES = [1, 2, 3];

// Keep in sync with src/components/listings/pinIcons.js.
const RATING_STEP = 0.25;
const RATING_BUCKETS = Array.from({ length: Math.round(5 / RATING_STEP) + 1 }, (_, i) => (i * RATING_STEP).toFixed(2));
const LOOKS = ["available", "suggested", "unavailable"];

// Web's pinMarkup: the pin with its soft shadow (CSS drop-shadow(1px 2px 2px
// rgba(0,0,0,0.18)), whose 2px blur radius is a 1px standard deviation).
function pinSvg(color, inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs><filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="1" dy="2" stdDeviation="1" flood-color="#000" flood-opacity="0.18"/></filter></defs>
  <g transform="translate(${PAD_X} ${PAD_TOP})" filter="url(#sh)"><path d="${PIN_PATH}" fill="${color}"/>${inner}</g>
</svg>`;
}

// Web's buildPinSVGElement.
function listingPinSvg(bucket, look) {
  const unavailable = look === "unavailable";
  const color = unavailable ? UNAVAILABLE_PIN_COLOR : AVAILABLE_PIN_COLOR;
  const mark = unavailable ? UNAVAILABLE_STAR_COLOR : "white";
  const badge = look === "suggested" ? SUGGESTED_BADGE : "";
  if (bucket === "none") return pinSvg(color, `<circle cx="15" cy="15.2" r="4.5" fill="${mark}"/>${badge}`);
  const fillHeight = (Number(bucket) / 5) * (STAR_BOTTOM - STAR_TOP);
  const clipY = (STAR_BOTTOM - fillHeight).toFixed(2);
  return pinSvg(
    color,
    `<defs><clipPath id="sc"><rect x="4" y="${clipY}" width="22" height="${(fillHeight + 1).toFixed(2)}"/></clipPath></defs>
    <path d="${STAR_PATH}" fill="none" stroke="${mark}" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${STAR_PATH}" fill="${mark}" stroke="${mark}" stroke-linecap="round" stroke-linejoin="round" clip-path="url(#sc)"/>${badge}`
  );
}

// Web's buildClusterPinElement, without the count.
function clusterPinSvg(look) {
  const unavailable = look === "unavailable";
  return pinSvg(unavailable ? UNAVAILABLE_PIN_COLOR : AVAILABLE_PIN_COLOR, look === "suggested" ? SUGGESTED_BADGE : "");
}

const VARIANTS = [
  ...["none", ...RATING_BUCKETS].flatMap((bucket) =>
    LOOKS.map((look) => ({ id: `pin-${bucket}-${look}`, svg: listingPinSvg(bucket, look) }))
  ),
  ...LOOKS.map((look) => ({ id: `cluster-${look}`, svg: clusterPinSvg(look) })),
];

async function main() {
  const mobileRoot = path.resolve(__dirname, "..");
  const assetsDir = path.join(mobileRoot, "assets/map-pins");
  const mapFile = path.join(mobileRoot, "src/components/listings/pinIconAssets.js");
  // Start clean so artwork from an older scheme is never left behind.
  fs.rmSync(assetsDir, { recursive: true, force: true });
  fs.mkdirSync(assetsDir, { recursive: true });

  const entries = [];
  for (const { id, svg } of VARIANTS) {
    for (const scale of SCALES) {
      const suffix = scale === 1 ? "" : `@${scale}x`;
      // SVG is rasterized at density 72 * scale so each file is crisp vector
      // output at its own resolution, not an upscaled 1x bitmap.
      await sharp(Buffer.from(svg), { density: 72 * scale })
        .resize(WIDTH * scale, HEIGHT * scale)
        .png()
        .toFile(path.join(assetsDir, `${id}${suffix}.png`));
    }
    entries.push(`  "${id}": require("../../../assets/map-pins/${id}.png"),`);
  }

  const source = `// Generated by scripts/generate-pin-icons.js. Do not edit by hand.
// Metro needs static require() paths, so the id -> asset map is written out.
export const PIN_ICON_IMAGES = {
${entries.join("\n")}
};
`;
  fs.writeFileSync(mapFile, source);
  console.log(`Wrote ${VARIANTS.length * SCALES.length} PNGs to assets/map-pins and ${path.relative(mobileRoot, mapFile)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
