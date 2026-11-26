#!/usr/bin/env node
/*
 * Listing walkthrough video pipeline (see LISTING_VIDEO_BRIEF.md).
 *
 * Usage:
 *   node scripts/listing-video/index.mjs --listing <uuid>[,<uuid>...] <mode> [options]
 *
 * Modes (exactly one):
 *   --dry-run        curate + order + score; print the transition plan, write plan
 *                    JSON. Zero video-generation calls, zero fal spend.
 *   --kenburns-only  render a complete real video using only ffmpeg (all transitions
 *                    safe). Zero fal spend.
 *   --generate       full hybrid pipeline. Requires FAL_KEY.
 *
 * Options:
 *   --db dev|prod           DB target (default dev; prod creds are not in .env.local)
 *   --max-spend-usd <n>     hard generation-spend ceiling for this run
 *   --no-vision             skip the classifier (deterministic fallback, forces kenburns)
 *   --model <endpoint>      override the generation model (default Kling O3 standard)
 *
 * Principle (§5): a listing never blocks on video. Failures downgrade or skip with a
 * recorded reason; the process only exits non-zero on programmer error.
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "./lib/env.mjs";
import { fetchListing } from "./lib/db.mjs";
import { listingDirs, download, urlExt, writeJson } from "./lib/cache.mjs";
import { probe, makeVisionCopy, prepFrames } from "./lib/ffmpeg.mjs";
import { classifyImages, getVisionSpendUsd } from "./lib/vision.mjs";
import { filterAndOrder, fallbackOrder, eligibility } from "./lib/order.mjs";
import { buildPlan, buildSolos, buildManifest, printPlan, estimateDuration, MODEL_ID } from "./lib/plan.mjs";
import { generateClip, makeSpendGuard } from "./lib/generate.mjs";
import { renderVideo } from "./lib/render.mjs";

function parseArgs(argv) {
  const args = { listings: [], mode: null, db: "dev", maxSpendUsd: null, noVision: false, model: MODEL_ID };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--listing") args.listings.push(...argv[++i].split(","));
    else if (a === "--dry-run") args.mode = "dry-run";
    else if (a === "--kenburns-only") args.mode = "kenburns-only";
    else if (a === "--generate") args.mode = "generate";
    else if (a === "--db") args.db = argv[++i];
    else if (a === "--max-spend-usd") args.maxSpendUsd = parseFloat(argv[++i]);
    else if (a === "--max-clips") args.maxClips = parseInt(argv[++i], 10);
    else if (a === "--no-vision") args.noVision = true;
    else if (a === "--model") args.model = argv[++i];
    else if (a === "--transition") args.transition = argv[++i]; // whip | punch | blur | cut
    else if (a === "--connected-tour") args.connectedTour = true;
    else if (!a.startsWith("--")) args.listings.push(a);
    else throw new Error(`unknown flag ${a}`);
  }
  if (!args.mode) throw new Error("pick one mode: --dry-run | --kenburns-only | --generate");
  if (args.listings.length === 0) throw new Error("--listing <uuid> is required");
  return args;
}

const MIN_DURATION = 12; // §5: shorter than this is too thin to be worth it

async function processListing(args, listingId, spendGuard) {
  console.log(`\n▶ listing ${listingId}`);
  const dirs = listingDirs(listingId);
  const { listing, images, streetViewOnly } = await fetchListing(args.db, listingId);

  if (listing.deletedAt) {
    console.log("  deleted listing — skipped");
    return { listingId, status: "skipped", skipReason: "deleted" };
  }

  // Download originals (cached); drop 404s and extreme aspect ratios (§5).
  const usable = [];
  const filteredPre = [];
  for (const img of images) {
    const dest = path.join(dirs.orig, `${img.id}.${urlExt(img.url)}`);
    if (!(await download(img.url, dest))) {
      filteredPre.push({ id: img.id, url: img.url, reason: "download_failed" });
      continue;
    }
    const meta = await probe(dest).catch(() => null);
    if (!meta || !meta.width) {
      filteredPre.push({ id: img.id, url: img.url, reason: "unreadable" });
      continue;
    }
    const aspect = meta.width / meta.height;
    if (aspect > 2.5 || aspect < 0.4 || Math.min(meta.width, meta.height) < 300) {
      filteredPre.push({ id: img.id, url: img.url, reason: "bad_aspect_or_size" });
      continue;
    }
    usable.push({ ...img, origPath: dest });
  }
  console.log(`  ${usable.length}/${images.length} images downloaded and readable`);

  // Vision copies + classification (cached across runs).
  let classification = null;
  let classifierFailed = false;
  if (!args.noVision && usable.length > 0) {
    for (const img of usable) {
      img.visionPath = path.join(dirs.vision, `${img.id}.jpg`);
      if (!fs.existsSync(img.visionPath)) await makeVisionCopy(img.origPath, img.visionPath);
    }
    classification = await classifyImages(usable, path.join(dirs.root, "classification.json"));
  }

  let ordered, filteredOut;
  if (classification) {
    ({ ordered, filteredOut } = await filterAndOrder(usable, classification));
  } else {
    classifierFailed = true;
    ordered = fallbackOrder(usable);
    filteredOut = [];
    console.log("  classifier unavailable — deterministic fallback (forces kenburns)");
  }
  filteredOut.push(...filteredPre);

  // §5 eligibility on the surviving set.
  let { mode, skipReason } = eligibility({
    ordered,
    imagesTotal: images.length,
    streetViewOnly,
    classifierFailed,
  });
  if (mode && args.mode === "kenburns-only") mode = "kenburns";

  if (!mode) {
    const manifest = buildManifest({ listing, mode, skipReason, ordered, filteredOut, transitions: [], classifierFailed });
    writeJson(path.join(dirs.out, "plan.json"), manifest);
    printPlan(manifest, ordered);
    return { listingId, status: "skipped", skipReason };
  }

  // Prep 16:9 masters + model frames for the surviving route.
  for (const img of ordered) {
    img.masterPath = path.join(dirs.frames, `${img.id}.master.jpg`);
    img.framePath = path.join(dirs.frames, `${img.id}.frame.jpg`);
    if (!fs.existsSync(img.masterPath) || !fs.existsSync(img.framePath)) {
      await prepFrames(img.origPath, img.masterPath, img.framePath);
    }
  }

  const transitions = await buildPlan({
    ordered,
    mode,
    adjacencyFile: path.join(dirs.root, "adjacency.json"),
  });
  const solos = mode === "hybrid" && !args.connectedTour ? buildSolos(ordered, transitions) : [];

  if (estimateDuration(transitions, solos) < MIN_DURATION) {
    const manifest = buildManifest({ listing, mode: null, skipReason: "too_short", ordered, filteredOut, transitions, solos, classifierFailed });
    writeJson(path.join(dirs.out, "plan.json"), manifest);
    printPlan(manifest, ordered);
    return { listingId, status: "skipped", skipReason: "too_short" };
  }

  const manifest = buildManifest({ listing, mode, skipReason: null, ordered, filteredOut, transitions, solos, classifierFailed });
  writeJson(path.join(dirs.out, "plan.json"), manifest);
  printPlan(manifest, ordered);

  if (args.mode === "dry-run") {
    console.log(`  plan → ${path.join(dirs.out, "plan.json")}`);
    return { listingId, status: "planned", manifest };
  }

  // Render. In kenburns mode every transition is safe; in generate mode, pair moves
  // and solo moves that fail downgrade one by one (and if all fail we still ship).
  const clipPaths = new Map();
  const soloPaths = new Map();
  let actualCostCents = 0;
  if (args.mode === "generate" && mode === "hybrid") {
    let clipsDone = 0;
    for (const t of transitions.filter((x) => x.kind === "generated")) {
      if (args.maxClips && clipsDone >= args.maxClips) break;
      const from = ordered[t.index];
      const to = ordered[t.index + 1];
      const clip = await generateClip({
        transition: t,
        fromFrame: from.framePath,
        toFrame: to.framePath,
        dirs,
        model: args.model,
        spendGuard,
      });
      if (clip) {
        clipPaths.set(t.index, clip.path);
        t.actual_cost_cents = clip.costCents;
        actualCostCents += clip.costCents;
        clipsDone++;
      } else {
        t.downgraded = true;
      }
    }
    for (const solo of solos) {
      const clip = await generateClip({
        transition: {
          from: solo.image_id,
          to: null,
          from_space: solo.space,
          to_space: "(solo)",
          prompt: solo.prompt,
          duration: solo.duration,
        },
        fromFrame: ordered[solo.index].framePath,
        toFrame: null,
        dirs,
        model: args.model,
        spendGuard,
      });
      if (clip) {
        soloPaths.set(solo.index, clip.path);
        solo.actual_cost_cents = clip.costCents;
        actualCostCents += clip.costCents;
      } else {
        solo.downgraded = true;
      }
    }
  }

  const result = await renderVideo({
    listing,
    ordered,
    transitions,
    clipPaths,
    soloPaths,
    dirs,
    bridgeStyle: args.transition || "whip",
    connectedTour: !!args.connectedTour,
  });
  manifest.actual_generation_cost_cents = actualCostCents;
  manifest.duration_seconds = result.durationSeconds;
  manifest.segments = result.segments;
  manifest.outputs = {
    watermarked: result.watermarkedPath,
    clean: result.cleanPath,
    poster: result.posterPath,
  };
  writeJson(path.join(dirs.out, "manifest.json"), manifest);

  console.log(`  ✔ ${result.durationSeconds}s video`);
  console.log(`    watermarked: ${result.watermarkedPath}`);
  console.log(`    clean:       ${result.cleanPath}`);
  return { listingId, status: "rendered", manifest };
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const spendGuard = makeSpendGuard(args.maxSpendUsd);
  const results = [];
  for (const listingId of args.listings) {
    try {
      results.push(await processListing(args, listingId, spendGuard));
    } catch (err) {
      console.error(`  ✖ ${listingId}: ${err.message}`);
      results.push({ listingId, status: "failed", error: err.message });
    }
  }
  console.log("\n──────── run summary ────────");
  for (const r of results) {
    console.log(`  ${r.listingId}  ${r.status}${r.skipReason ? ` (${r.skipReason})` : ""}`);
  }
  const vision = getVisionSpendUsd();
  if (vision > 0) console.log(`  vision spend this run: $${vision.toFixed(3)}`);
  if (spendGuard.spentCents() > 0) {
    console.log(`  generation spend this run: $${(spendGuard.spentCents() / 100).toFixed(2)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
