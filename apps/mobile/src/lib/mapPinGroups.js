// Browse map pin grouping and initial fit, ported from
// apps/web/src/components/listings/MapView.js (clusterListings and the
// fit-to-listings maths). Keep the rules and numbers in sync with web.
//
// Web measures pin distances with map.project. Here they come from Web
// Mercator world coordinates at the camera's zoom (512 * 2^zoom points across,
// the scale both Mapbox SDKs use), which gives the same distances for an
// unpitched map at any rotation and needs no async call to the native map.
import { MAP_CAMPUS_CENTER } from "@proximity/shared";

// Listings whose pins would sit closer than this merge into one numbered pin
// (one pin width). Clustering stops at CLUSTER_MAX_ZOOM; a group tap zooms in
// by CLUSTER_ZOOM_STEP levels. From that zoom on, listings at the same spot
// are set side by side instead, so each one can be tapped.
export const CLUSTER_MAX_ZOOM = 17;
export const CLUSTER_ZOOM_STEP = 2;
const CLUSTER_RADIUS = 30;
// Pins closer than this once clustering has stopped count as the same spot,
// and are set this far apart, centred on it.
const STACK_RADIUS = 6;
const STACK_SPREAD = 26;

// Zoom the camera flies to for a picked pin: between 15 and 16. Zoomed in far
// enough to have split a stack of pins, it stays there, or the pin just picked
// would merge back with its neighbours.
export const pinFlyZoom = (zoom) => (zoom >= CLUSTER_MAX_ZOOM ? zoom : Math.min(Math.max(zoom, 15), 16));

// Point at zoom 0 (a 512-point world); multiply by 2^zoom for any other zoom.
export function worldPoint(lng, lat) {
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * 512,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * 512,
  };
}

// Groups listings whose pins overlap at this zoom. Returns { members, lng,
// lat, dx } per pin (lng/lat is the members' average, dx the pin's sideways
// offset in points). The pinned listing (the selected one) is never merged, so
// its larger pin stays visible. Once clustering has stopped nothing is
// merged: listings at the same spot each get their own pin, side by side.
export function clusterListings(listings, zoom, pinnedId) {
  const toGroup = (members) => ({
    members,
    lng: members.reduce((sum, l) => sum + l.longitude, 0) / members.length,
    lat: members.reduce((sum, l) => sum + l.latitude, 0) / members.length,
    dx: 0,
  });
  const spread = zoom >= CLUSTER_MAX_ZOOM;
  const pinned = spread ? [] : listings.filter((l) => String(l._id) === String(pinnedId));
  const pool = listings.filter((l) => !pinned.includes(l));
  // The radius in zoom-0 world units, so the points need no rescaling.
  const radius = (spread ? STACK_RADIUS : CLUSTER_RADIUS) / 2 ** zoom;
  const points = pool.map((l) => worldPoint(l.longitude, l.latitude));
  // Web compares every pair. This runs on each zoom frame on a phone, so the
  // points go in a grid of radius-sized cells and each one is compared only
  // with the 9 cells around it. Candidates are taken in index order, so the
  // groups are exactly web's.
  const cellOf = (p) => [Math.floor(p.x / radius), Math.floor(p.y / radius)];
  const grid = new Map();
  points.forEach((p, i) => {
    const [cx, cy] = cellOf(p);
    const id = cx * 1e7 + cy;
    if (!grid.has(id)) grid.set(id, []);
    grid.get(id).push(i);
  });
  const taken = new Set();
  const groups = pinned.map((l) => toGroup([l]));
  pool.forEach((listing, i) => {
    if (taken.has(i)) return;
    taken.add(i);
    const [cx, cy] = cellOf(points[i]);
    const near = [];
    for (let x = cx - 1; x <= cx + 1; x++) {
      for (let y = cy - 1; y <= cy + 1; y++) {
        for (const j of grid.get(x * 1e7 + y) ?? []) {
          const ddx = points[i].x - points[j].x;
          const ddy = points[i].y - points[j].y;
          if (j > i && !taken.has(j) && ddx * ddx + ddy * ddy < radius * radius) near.push(j);
        }
      }
    }
    near.sort((a, b) => a - b);
    const members = [listing];
    near.forEach((j) => {
      taken.add(j);
      members.push(pool[j]);
    });
    groups.push(toGroup(members));
  });
  if (!spread) return groups;
  return groups.flatMap((group) =>
    group.members.length === 1
      ? [group]
      : [...group.members]
          // By id, so each listing keeps its place whatever order they came in.
          .sort((a, b) => String(a._id).localeCompare(String(b._id)))
          .map((listing, i, all) => ({
            ...group,
            members: [listing],
            dx: (i - (all.length - 1) / 2) * STACK_SPREAD,
          }))
  );
}

// Initial fit covers the bulk of the listings rather than their full extent:
// a handful of far-flung ones would otherwise pull the camera way back and
// leave the dense area around campus unreadably small. The fit then sits
// FIT_ZOOM_OUT levels further out, so the first view shows more groups.
const FIT_PERCENTILE = 0.6;
const FIT_MIN_DELTA_DEG = 0.008; // ~0.5 mi, so a sparse result set can't over-zoom
const FIT_PADDING = 48;
const FIT_MAX_ZOOM = 15.5;
const FIT_ZOOM_OUT = 0.75;
const FIT_FALLBACK_ZOOM = 13;

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

// Web's fit: centred on campus, with the zoom Mapbox's cameraForBounds gives
// for the percentile box in a map of this size, then zoomed out a little.
export function fitCamera(listings, width, height) {
  const { longitude: lng, latitude: lat } = MAP_CAMPUS_CENTER;
  const dLng = Math.max(FIT_MIN_DELTA_DEG, percentile(listings.map((l) => Math.abs(l.longitude - lng)), FIT_PERCENTILE));
  const dLat = Math.max(FIT_MIN_DELTA_DEG, percentile(listings.map((l) => Math.abs(l.latitude - lat)), FIT_PERCENTILE));
  const nw = worldPoint(lng - dLng, lat + dLat);
  const se = worldPoint(lng + dLng, lat - dLat);
  const innerWidth = width - FIT_PADDING * 2;
  const innerHeight = height - FIT_PADDING * 2;
  const zoom =
    innerWidth > 0 && innerHeight > 0
      ? Math.min(FIT_MAX_ZOOM, Math.log2(Math.min(innerWidth / (se.x - nw.x), innerHeight / (se.y - nw.y))))
      : FIT_FALLBACK_ZOOM;
  return { center: [lng, lat], zoom: zoom - FIT_ZOOM_OUT };
}
