/*
 * Stage D generation via fal.ai's queue API (plain fetch — no SDK dependency).
 * Hard-guarded: without FAL_KEY nothing here can spend money. Clips are cached by
 * content hash (§5 idempotency) so identical pairs are never regenerated and Phase 2
 * re-runs are free. Frames are sent as base64 data URIs, so no R2 upload of
 * intermediate frames is needed.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { falKey } from "./env.mjs";
import { readJson, writeJson, download } from "./cache.mjs";
import { probe, normalizeClip } from "./ffmpeg.mjs";
import { MODEL_ID, GENERATED_SECONDS, PRICE_PER_SECOND_USD } from "./plan.mjs";

const QUEUE_BASE = "https://queue.fal.run";
const POLL_INTERVAL_MS = 5000;
const TIMEOUT_MS = 10 * 60 * 1000;

export function clipCacheKey({ fromId, toId, prompt, model, duration }) {
  return crypto
    .createHash("sha256")
    .update([fromId, toId, prompt, model, duration, "1080p"].join("|"))
    .digest("hex");
}

function dataUri(file) {
  return `data:image/jpeg;base64,${fs.readFileSync(file).toString("base64")}`;
}

async function falFetch(url, options = {}) {
  const key = falKey();
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Key ${key}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`fal ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

/*
 * Generates (or returns cached) clip for one transition or solo move (toFrame null →
 * single-image move, no end frame, nothing invented). Returns { path, costCents,
 * cached } or null on any failure — the caller downgrades gracefully (§5: a listing
 * never blocks on video).
 */
export async function generateClip({ transition, fromFrame, toFrame, dirs, model = MODEL_ID, spendGuard }) {
  const key = clipCacheKey({
    fromId: transition.from,
    toId: transition.to || "solo",
    prompt: transition.prompt,
    model,
    duration: transition.duration,
  });
  const indexFile = path.join(dirs.clips, "clips.json");
  const index = readJson(indexFile, {});
  const clipPath = path.join(dirs.clips, `${key}.mp4`);

  if (index[key] && fs.existsSync(clipPath)) {
    return { path: clipPath, costCents: 0, cached: true };
  }

  if (!falKey()) {
    throw new Error(
      "FAL_KEY is not set. Add it to apps/web/.env.local (fal.ai dashboard → API keys). " +
        "No generation is possible — and no money can be spent — until then."
    );
  }

  const estCents = Math.round(transition.duration * PRICE_PER_SECOND_USD * 100);
  if (spendGuard && !spendGuard.allow(estCents)) {
    console.warn(`  [fal] spend ceiling reached — skipping ${transition.from_space}→${transition.to_space}`);
    return null;
  }

  try {
    const payload = {
      image_url: dataUri(fromFrame),
      duration: String(transition.duration),
      prompt: transition.prompt,
    };
    if (toFrame) payload.end_image_url = dataUri(toFrame);
    const submit = await falFetch(`${QUEUE_BASE}/${model}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    const statusUrl = submit.status_url || `${QUEUE_BASE}/${model}/requests/${submit.request_id}/status`;
    const responseUrl = submit.response_url || `${QUEUE_BASE}/${model}/requests/${submit.request_id}`;
    const started = Date.now();
    for (;;) {
      if (Date.now() - started > TIMEOUT_MS) throw new Error("generation timed out");
      const status = await falFetch(statusUrl);
      if (status.status === "COMPLETED") break;
      if (status.status === "FAILED" || status.status === "ERROR") {
        throw new Error(`generation failed: ${JSON.stringify(status).slice(0, 200)}`);
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    const result = await falFetch(responseUrl);
    const videoUrl = result.video?.url || result.data?.video?.url;
    if (!videoUrl) throw new Error(`no video url in response: ${JSON.stringify(result).slice(0, 200)}`);

    const rawPath = path.join(dirs.clips, `${key}.raw.mp4`);
    if (!(await download(videoUrl, rawPath))) throw new Error("clip download failed");

    // QC: playable, sane duration; then normalize to house format.
    const meta = await probe(rawPath);
    if (!meta.duration || meta.duration < transition.duration - 1) {
      throw new Error(`clip QC failed (duration ${meta.duration}s)`);
    }
    await normalizeClip(rawPath, clipPath);
    fs.unlinkSync(rawPath);

    const costCents = Math.round(meta.duration * PRICE_PER_SECOND_USD * 100);
    spendGuard?.commit(costCents);
    index[key] = {
      from: transition.from,
      to: transition.to,
      model,
      duration: transition.duration,
      cost_cents: costCents,
      created_at: new Date().toISOString(),
    };
    writeJson(indexFile, index);
    return { path: clipPath, costCents, cached: false };
  } catch (err) {
    console.warn(`  [fal] ${transition.from_space}→${transition.to_space}: ${err.message}`);
    return null;
  }
}

/* Simple spend ceiling shared across a run (Phase 2's --max-spend-usd). */
export function makeSpendGuard(maxUsd) {
  let spentCents = 0;
  const maxCents = maxUsd ? Math.round(maxUsd * 100) : Infinity;
  return {
    allow: (cents) => spentCents + cents <= maxCents,
    commit: (cents) => {
      spentCents += cents;
    },
    spentCents: () => spentCents,
  };
}
