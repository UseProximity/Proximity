/*
 * All image/video work goes through the ffmpeg binary — no image-processing npm deps.
 * Requires ffmpeg/ffprobe on PATH (Phase 0–2 run locally; the Phase 3 render host is a
 * separate decision, see the brief §7.4.3).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { ASSETS } from "./env.mjs";

const execFileAsync = promisify(execFile);
const FPS = 30;

async function ff(args, { allowLargeBuffer = false } = {}) {
  return execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    maxBuffer: allowLargeBuffer ? 64 * 1024 * 1024 : 8 * 1024 * 1024,
  });
}

async function ffRaw(args) {
  const { stdout } = await execFileAsync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", ...args],
    { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 }
  );
  return stdout;
}

export async function probe(file) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-show_entries", "format=duration",
    "-of", "json",
    file,
  ]);
  const parsed = JSON.parse(stdout);
  const stream = parsed.streams?.[0] || {};
  return {
    width: stream.width || 0,
    height: stream.height || 0,
    duration: parseFloat(parsed.format?.duration) || 0,
  };
}

/* ---------- image prep ---------- */

/* Small copy for the vision model (~768px, JPEG). */
export async function makeVisionCopy(src, dest) {
  await ff(["-i", src, "-vf", "scale='min(768,iw)':-2:flags=area", "-q:v", "6", dest]);
  return dest;
}

/*
 * 16:9 center-crop master at 2880x1620 (headroom for Ken Burns zoom without upscale
 * artifacts), plus the 1920x1080 q85 frame that would be sent to the video model.
 */
export async function prepFrames(src, masterDest, frameDest) {
  const crop = "crop='min(iw,ih*16/9)':'min(ih,iw*9/16)'";
  await ff(["-i", src, "-vf", `${crop},scale=2880:1620:flags=lanczos`, "-q:v", "2", masterDest]);
  await ff(["-i", masterDest, "-vf", "scale=1920:1080:flags=lanczos", "-q:v", "3", frameDest]);
  return { masterDest, frameDest };
}

/* ---------- perceptual signals ---------- */

/* dHash: 9x8 grayscale, bit per left<right comparison. Returns 64-char bit string. */
export async function dhash(file) {
  const buf = await ffRaw([
    "-i", file,
    "-vf", "scale=9:8:flags=area,format=gray",
    "-f", "rawvideo", "-frames:v", "1", "-",
  ]);
  let bits = "";
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      bits += buf[row * 9 + col] < buf[row * 9 + col + 1] ? "1" : "0";
    }
  }
  return bits;
}

export function hamming(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

/* 64-bin RGB histogram (4 bins/channel) from a 32x32 thumbnail, normalized. */
export async function histogram(file) {
  const buf = await ffRaw([
    "-i", file,
    "-vf", "scale=32:32:flags=area,format=rgb24",
    "-f", "rawvideo", "-frames:v", "1", "-",
  ]);
  const bins = new Array(64).fill(0);
  for (let i = 0; i + 2 < buf.length; i += 3) {
    bins[(buf[i] >> 6) * 16 + (buf[i + 1] >> 6) * 4 + (buf[i + 2] >> 6)]++;
  }
  const total = bins.reduce((a, b) => a + b, 0) || 1;
  return bins.map((b) => b / total);
}

/* Histogram intersection: 0 (disjoint) → 1 (identical). */
export function histSimilarity(h1, h2) {
  let sim = 0;
  for (let i = 0; i < h1.length; i++) sim += Math.min(h1[i], h2[i]);
  return sim;
}

/* ---------- segment rendering ---------- */

export const KENBURNS_CYCLE = ["pan_right", "push_in", "pan_left", "pull_back"];

/*
 * One camera-move segment from a 2880x1620 master. Motion is cosine-eased (no hard
 * starts/stops) and computed on a 2x supersampled frame so zoompan's integer x/y
 * rounding stays sub-pixel after downscale — this is what kills the stutter.
 *
 * Styles and their boundary contract (zoom at first/last frame):
 *   push_in    1.00 → 1.06   starts on the exact photo framing (safe after a hard cut)
 *   settle     1.06 → 1.00   ends on the exact photo framing (safe before a hard cut)
 *   breathe    1.00 → 1.00   both (sandwiched between two generated clips)
 *   pan_right / pan_left / pull_back — free-moving, only for crossfaded boundaries
 */
export async function kenburnsSegment(masterPath, dest, style, seconds = 3) {
  const frames = Math.round(seconds * FPS);
  const last = frames - 1;
  const ease = `(0.5-0.5*cos(PI*on/${last}))`;
  const centered = { x: "iw/2-(iw/zoom)/2", y: "ih/2-(ih/zoom)/2" };
  let z, x, y;
  if (style === "push_in") {
    z = `1+0.06*${ease}`;
    ({ x, y } = centered);
  } else if (style === "settle") {
    z = `1.06-0.06*${ease}`;
    ({ x, y } = centered);
  } else if (style === "breathe") {
    z = `1+0.04*sin(PI*on/${last})`;
    ({ x, y } = centered);
  } else if (style === "pull_back") {
    z = `1.06-0.06*${ease}`;
    ({ x, y } = centered);
  } else if (style === "pan_right") {
    z = "1.05";
    x = `(iw-iw/zoom)*${ease}`;
    y = centered.y;
  } else {
    z = "1.05";
    x = `(iw-iw/zoom)*(1-${ease})`;
    y = centered.y;
  }
  await ff([
    "-i", masterPath,
    "-vf",
    `scale=5760:3240:flags=lanczos,zoompan=z='${z}':x='${x}':y='${y}':d=${frames}:s=1920x1080:fps=${FPS},format=yuv420p`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    dest,
  ]);
  return dest;
}

/*
 * Speed + stabilize a generated clip. Kling output carries a handheld-style bob;
 * two-pass vidstab (the standard editor de-shake) locks it into a gimbal glide
 * (Ben, 2026-07-30: "sleek, all one clean shot"). zoom crops ~3% to hide edge
 * correction; smoothing=30 targets low-frequency walk-bob, not intended motion.
 */
export async function speedClip(src, dest, factor) {
  // Canonical vid.stab settings for short AI clips (researched 2026-07-30):
  // shakiness 5 / smoothing 15 low-passes handheld bob while preserving intended
  // pans; optzoom=1 static zoom avoids per-frame "breathing"; crop=black avoids
  // smeared borders on AI content. If a clip looks WORSE stabilized, its shake is
  // non-rigid AI warp, not camera motion — regenerate instead.
  const trf = `${dest}.trf`;
  await ff(["-i", src, "-vf", `vidstabdetect=shakiness=5:accuracy=15:stepsize=6:result=${trf}`, "-f", "null", "-"]);
  await ff([
    "-i", src,
    "-vf",
    `vidstabtransform=input=${trf}:smoothing=15:optzoom=1:zoom=1:interpol=bicubic:crop=black,unsharp=5:5:0.8:3:3:0.4,setpts=PTS/${factor},fps=${FPS},format=yuv420p`,
    "-an",
    "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    dest,
  ]);
  fs.rmSync(trf, { force: true });
  return dest;
}

/*
 * Bridge halves for stylized edits between rooms with no verified connection.
 * These are deliberately edit-language (whip blur / zoom punch), never a simulated
 * walkthrough — the honesty rule behind the v4 design.
 */
export async function bridgeOut(masterPath, dest, style, frames = 8) {
  const last = frames - 1;
  if (style === "punch") {
    await ff([
      "-i", masterPath,
      "-vf", `scale=5760:3240:flags=lanczos,zoompan=z='1+0.4*pow(on/${last},2)':x='iw/2-(iw/zoom)/2':y='ih/2-(ih/zoom)/2':d=${frames}:s=1920x1080:fps=${FPS},format=yuv420p`,
      "-c:v", "libx264", "-preset", "medium", "-crf", "18", dest,
    ]);
  } else {
    await ff([
      "-i", masterPath,
      "-vf", `scale=5760:3240:flags=lanczos,zoompan=z='1.12':x='(iw-iw/zoom)*pow(on/${last},2)':y='ih/2-(ih/zoom)/2':d=${frames}:s=1920x1080:fps=${FPS},boxblur=40:1:cr=0:ar=0,format=yuv420p`,
      "-c:v", "libx264", "-preset", "medium", "-crf", "18", dest,
    ]);
  }
  return dest;
}

export async function bridgeIn(masterPath, dest, style, frames = 8) {
  const last = frames - 1;
  if (style === "punch") {
    await ff([
      "-i", masterPath,
      "-vf", `scale=5760:3240:flags=lanczos,zoompan=z='1.35-0.35*(1-pow(1-on/${last},2))':x='iw/2-(iw/zoom)/2':y='ih/2-(ih/zoom)/2':d=${frames}:s=1920x1080:fps=${FPS},format=yuv420p`,
      "-c:v", "libx264", "-preset", "medium", "-crf", "18", dest,
    ]);
  } else {
    await ff([
      "-i", masterPath,
      "-vf", `scale=5760:3240:flags=lanczos,zoompan=z='1.12':x='(iw-iw/zoom)*(1-pow(1-on/${last},2))':y='ih/2-(ih/zoom)/2':d=${frames}:s=1920x1080:fps=${FPS},boxblur=24:1:cr=0:ar=0,format=yuv420p`,
      "-c:v", "libx264", "-preset", "medium", "-crf", "18", dest,
    ]);
  }
  return dest;
}

/* Re-encode a generated clip to the house format so stitching is uniform. */
export async function normalizeClip(src, dest) {
  await ff([
    "-i", src,
    "-vf", `scale=1920:1080:flags=lanczos:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=${FPS},format=yuv420p`,
    "-an",
    "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    dest,
  ]);
  return dest;
}

function writeTextFile(dir, name, text) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, text);
  return file;
}

/* 1.5s title card: black, logo, PROXIMITY wordmark, address. */
export async function titleCard(dest, { street, cityState }, workDir, seconds = 1.5) {
  const wordmarkFile = writeTextFile(workDir, "wordmark.txt", "PROXIMITY");
  const streetFile = writeTextFile(workDir, "street.txt", street);
  const cityFile = writeTextFile(workDir, "city.txt", cityState || "");
  const draw = [
    `drawtext=fontfile=${ASSETS.fontExtraBold}:textfile=${wordmarkFile}:fontsize=48:fontcolor=white:x=(w-text_w)/2:y=500`,
    `drawtext=fontfile=${ASSETS.fontBold}:textfile=${streetFile}:fontsize=56:fontcolor=white:x=(w-text_w)/2:y=620`,
    cityState
      ? `drawtext=fontfile=${ASSETS.fontMedium}:textfile=${cityFile}:fontsize=32:fontcolor=white@0.85:x=(w-text_w)/2:y=706`
      : null,
  ]
    .filter(Boolean)
    .join(",");
  await ff([
    "-f", "lavfi", "-i", `color=c=0x0A0A0A:s=1920x1080:d=${seconds}:r=${FPS}`,
    "-i", ASSETS.logo,
    "-filter_complex",
    `[1:v]scale=220:-1[logo];[0:v][logo]overlay=(W-w)/2:240[bg];[bg]${draw},format=yuv420p[v]`,
    "-map", "[v]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    dest,
  ]);
  return dest;
}

/* One frame — used as the "hard cut" boundary between segments that share an exact
 * frame (a generated clip and its neighboring still), so nothing visibly blends. */
export const CUT = { transition: "fade", duration: 1 / FPS };
/* Fast blur-through for room changes with no visible connection — reads as the camera
 * moving too fast to track, honest and modern, instead of a slideshow dissolve. */
export const BLUR = { transition: "hblur", duration: 0.5 };
export const FADE = { transition: "fade", duration: 0.5 };

/*
 * Stitch segments in order. boundaries[i] styles the joint between segment i and i+1
 * ({transition, duration}); defaults to FADE where unspecified.
 */
export async function stitch(segments, dest, boundaries = []) {
  if (segments.length === 1) {
    fs.copyFileSync(segments[0], dest);
    return dest;
  }
  const durations = [];
  for (const seg of segments) durations.push((await probe(seg)).duration);

  // All math in whole frames: xfade silently drops the right-hand stream when
  // offset+duration lands past the left stream's final frame PTS, so anchor each
  // transition to end exactly one frame before the accumulated stream runs out.
  const inputs = segments.flatMap((seg) => ["-i", seg]);
  let filter = "";
  let prevLabel = "0:v";
  let leftFrames = Math.round(durations[0] * FPS);
  for (let i = 1; i < segments.length; i++) {
    const { transition, duration } = boundaries[i - 1] || FADE;
    const durF = Math.max(1, Math.round(duration * FPS));
    const offsetF = Math.max(0, leftFrames - 1 - durF);
    const out = i === segments.length - 1 ? "vout" : `v${i}`;
    filter += `[${prevLabel}][${i}:v]xfade=transition=${transition}:duration=${(durF / FPS).toFixed(4)}:offset=${(offsetF / FPS).toFixed(4)}[${out}];`;
    prevLabel = out;
    // xfade output = offset + right-stream duration (the blend overlaps the right
    // stream's head; it does not extend the timeline).
    leftFrames = offsetF + Math.round(durations[i] * FPS);
  }
  await ff([
    ...inputs,
    "-filter_complex", filter.slice(0, -1),
    "-map", "[vout]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    dest,
  ]);
  return dest;
}

/*
 * Final pass: R1 disclosure label over the entire duration (both renders), optional
 * translucent logo+PROXIMITY lockup bottom-right (free render only), a short fade
 * in/out, and a silent stereo AAC track (§6 — some browsers and embeds mishandle
 * audio-less mp4s).
 */
export async function finalize(src, dest, { watermark }, workDir) {
  const labelFile = writeTextFile(workDir, "label.txt", "AI preview · not filmed footage");
  const label =
    `drawtext=fontfile=${ASSETS.fontMedium}:textfile=${labelFile}:fontsize=14:` +
    `fontcolor=white@0.7:shadowcolor=black@0.8:shadowx=1:shadowy=1:x=24:y=h-th-20`;
  // No fade-in: the judge flagged it as an exposure pop — open on the full frame.
  const total = (await probe(src)).duration;
  const fades = `fade=t=out:st=${Math.max(0, total - 0.4).toFixed(2)}:d=0.4`;
  const args = ["-i", src];
  let filter;
  if (watermark) {
    args.push("-i", ASSETS.watermark);
    filter =
      `[0:v]${label}[labeled];` +
      `[1:v]format=rgba,scale=300:-1,colorchannelmixer=aa=0.5[wm];` +
      `[labeled][wm]overlay=W-w-24:H-h-24,${fades},format=yuv420p[v]`;
  } else {
    filter = `[0:v]${label},${fades},format=yuv420p[v]`;
  }
  args.push(
    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-filter_complex", filter,
    "-map", "[v]",
    "-map", `${watermark ? 2 : 1}:a`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    "-c:a", "aac", "-b:a", "64k",
    "-shortest",
    "-movflags", "+faststart",
    dest
  );
  await ff(args);
  return dest;
}

export async function extractPoster(video, dest, at = 1.0) {
  await ff(["-ss", String(at), "-i", video, "-frames:v", "1", "-q:v", "2", dest]);
  return dest;
}
