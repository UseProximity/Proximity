#!/usr/bin/env node
//
// Pre-renders the Browse map's rating pins to static PNGs (1x/2x/3x) and
// writes the require() map the app imports. Run after changing the pin
// artwork or the rating buckets:
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
// Artwork is ported from apps/web/src/components/listings/MapView.js's
// buildPinSVGElement: a white dot for unreviewed listings, or a star clipped
// to the fractional rating (gold when a perfect 5). Pin red is the design
// system's `primary` (#DC2626).
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

const PIN_PATH =
  "M2.10342 24.897C4.01562 32.1187 12.8496 42.2217 17.49 47.001C22.6189 42.2217 30.6445 31.1218 32.8766 24.897C35.6237 17.2363 34.3335 1.67745 17.4901 1.00098C1.36353 1.67745 -0.827361 17.1308 2.10342 24.897Z";
const STAR_PATH =
  "M17.0293 8.79004C17.1878 8.34883 17.8122 8.34883 17.9707 8.79004L20.4404 15.668C20.6507 16.2534 21.2013 16.6479 21.8232 16.6602L29.2773 16.8076C29.7553 16.817 29.9486 17.427 29.5635 17.71L23.6768 22.0293C23.1599 22.4086 22.9415 23.0747 23.1328 23.6865L25.2832 30.5664C25.4241 31.0173 24.9192 31.3935 24.5273 31.1299L18.3379 26.9619C17.8315 26.621 17.1685 26.621 16.6621 26.9619L10.4727 31.1299C10.0808 31.3935 9.57593 31.0173 9.7168 30.5664L11.8672 23.6865C12.0585 23.0747 11.8401 22.4086 11.3232 22.0293L5.43652 17.71C5.05135 17.427 5.24468 16.817 5.72266 16.8076L13.1768 16.6602C13.7987 16.6479 14.3493 16.2534 14.5596 15.668L17.0293 8.79004Z";
const STAR_BOTTOM = 31.4;
const STAR_HEIGHT = 23.06;

const WIDTH = 35;
const HEIGHT = 49;
const SCALES = [1, 2, 3];

// Keep in sync with src/components/listings/pinIcons.js (ratingIconId).
const RATING_STEP = 0.25;
const RATING_BUCKETS = Array.from({ length: Math.round(5 / RATING_STEP) + 1 }, (_, i) => i * RATING_STEP);
const VARIANTS = [
  { rating: null, isActive: false },
  { rating: null, isActive: true },
  ...RATING_BUCKETS.flatMap((rating) => [
    { rating, isActive: false },
    { rating, isActive: true },
  ]),
];

function iconId(rating, isActive) {
  const bucket = rating == null ? "none" : (Math.round(rating / RATING_STEP) * RATING_STEP).toFixed(2);
  return `pin-${bucket}-${isActive ? "active" : "inactive"}`;
}

function buildPinSvg({ rating, isActive }) {
  const hasRating = rating != null && rating > 0;
  const pinBodyStop2 = isActive ? "#FFDFDF" : "#DC2626";
  const pinBodyStopOpacity = isActive ? 0.9 : 1;
  const bodyGradient = `<linearGradient id="pg" x1="17.5" y1="1" x2="17.5" y2="47" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FFFFFF"/>
      <stop offset="0.18" stop-color="${pinBodyStop2}" stop-opacity="${pinBodyStopOpacity}"/>
    </linearGradient>`;
  const body = `<path d="${PIN_PATH}" fill="url(#pg)" stroke="#DC2626" stroke-width="2"/>`;
  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">`;

  if (!hasRating) {
    const circleFill = isActive ? "#FFA2A2" : "#FFFFFF";
    return `${open}<defs>${bodyGradient}</defs>${body}<circle cx="17.5" cy="20" r="5.5" fill="${circleFill}" opacity="0.9"/></svg>`;
  }

  const fillHeight = (rating / 5) * STAR_HEIGHT;
  const clipY = STAR_BOTTOM - fillHeight;
  const isGold = rating >= 5 && !isActive;
  const starPaint = isGold ? "url(#sg)" : isActive ? "#FFA2A2" : "#FFFFF6";
  const goldGradient = isGold
    ? `<linearGradient id="sg" x1="17.5" y1="8.2" x2="17.5" y2="31.4" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#D69121"/>
      <stop offset="0.45" stop-color="#F7D14A"/>
      <stop offset="0.78" stop-color="#F7EF84"/>
      <stop offset="1" stop-color="#FFFDEB"/>
    </linearGradient>`
    : "";

  return `${open}<defs>${bodyGradient}${goldGradient}<clipPath id="sc"><rect x="4" y="${clipY}" width="27" height="${fillHeight}"/></clipPath></defs>${body}<path d="${STAR_PATH}" fill="${starPaint}" clip-path="url(#sc)"/><path d="${STAR_PATH}" fill="none" stroke="${starPaint}" stroke-width="0.75"/></svg>`;
}

async function main() {
  const mobileRoot = path.resolve(__dirname, "..");
  const assetsDir = path.join(mobileRoot, "assets/map-pins");
  const mapFile = path.join(mobileRoot, "src/components/listings/pinIconAssets.js");
  fs.mkdirSync(assetsDir, { recursive: true });

  const entries = [];
  for (const variant of VARIANTS) {
    const id = iconId(variant.rating, variant.isActive);
    const svg = Buffer.from(buildPinSvg(variant));
    for (const scale of SCALES) {
      const suffix = scale === 1 ? "" : `@${scale}x`;
      // SVG is rasterized at density 72 * scale so each file is crisp vector
      // output at its own resolution, not an upscaled 1x bitmap.
      await sharp(svg, { density: 72 * scale })
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
