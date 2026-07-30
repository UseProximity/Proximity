/*
 * Per-listing working directory under scripts/listing-video/.cache/<listingId>/:
 *   orig/    downloaded source images (kept between runs — free re-runs)
 *   vision/  768px copies sent to the classifier
 *   frames/  1920x1080 prepped start/end frames
 *   segs/    rendered per-segment mp4s
 *   clips/   generated (fal) clips + clips.json cache index
 *   out/     final renders, poster, plan.json, manifest.json
 */
import fs from "node:fs";
import path from "node:path";
import { CACHE_ROOT } from "./env.mjs";

export function listingDirs(listingId) {
  const root = path.join(CACHE_ROOT, listingId);
  const dirs = {
    root,
    orig: path.join(root, "orig"),
    vision: path.join(root, "vision"),
    frames: path.join(root, "frames"),
    segs: path.join(root, "segs"),
    clips: path.join(root, "clips"),
    out: path.join(root, "out"),
  };
  for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { recursive: true });
  return dirs;
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

/* Downloads url to destPath unless it already exists. Returns destPath, or null on failure. */
export async function download(url, destPath) {
  if (fs.existsSync(destPath) && fs.statSync(destPath).size > 0) return destPath;
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) return null;
    fs.writeFileSync(destPath, buf);
    return destPath;
  } catch {
    return null;
  }
}

/* Extension from a URL path, defaulting to jpg. */
export function urlExt(url) {
  const m = new URL(url).pathname.match(/\.([a-zA-Z0-9]{2,5})$/);
  return m ? m[1].toLowerCase() : "jpg";
}
