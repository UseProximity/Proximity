#!/usr/bin/env node
/*
 * The video judge: sends a rendered walkthrough to Gemini (the only major API that
 * ingests actual video) for a motion-level director's critique with timestamps.
 * This is the taste layer the pipeline lacked — stills can't judge rhythm or jank.
 *
 * Usage: node scripts/listing-video/judge.mjs <video.mp4> [--model gemini-2.5-flash]
 * Needs GEMINI_API_KEY in apps/web/.env.local. Cost: a few cents per critique.
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadEnv } from "./lib/env.mjs";
import { writeJson } from "./lib/cache.mjs";

const execFileAsync = promisify(execFile);

const CRITIQUE_PROMPT = `You are a demanding professional real-estate video editor reviewing an AI-generated apartment walkthrough (silent, ~20-40s). The bar is: would this pass as a polished, modern social-media property tour that feels like ONE continuous, intentional video?

Watch closely for:
- segments that read as a STATIC PHOTO with a slow zoom/pan (no parallax) vs. real footage
- transitions that feel cheap, jarring, or amateur (bad whips, visible crossfade ghosting, exposure jumps between shots)
- AI artifacts: warping walls or lines, melting/morphing furniture, texture shimmer
- camera moves with no purpose (drifting toward nothing, ending awkwardly mid-move)
- pacing: dead/slow stretches, or cuts that come too fast to register the room
- overall cohesion: does it feel like one filmed tour, or stitched fragments?

Be harsh and specific. Cite timestamps. Return ONLY JSON matching:
{
  "overall_score": 1-10,
  "feels_like_one_video": boolean,
  "verdict_one_sentence": string,
  "issues": [{"start_s": number, "end_s": number, "severity": "high"|"medium"|"low", "what": string, "fix": string}],
  "best_moments": [{"start_s": number, "end_s": number, "why": string}],
  "top_three_changes": [string, string, string]
}`;

async function main() {
  loadEnv();
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set in apps/web/.env.local");

  const args = process.argv.slice(2);
  const video = args.find((a) => !a.startsWith("--"));
  if (!video || !fs.existsSync(video)) throw new Error("usage: judge.mjs <video.mp4>");
  const modelIdx = args.indexOf("--model");
  const model = modelIdx >= 0 ? args[modelIdx + 1] : "gemini-2.5-flash";

  // Inline requests cap ~20MB total; send a 720p judge copy (motion survives 720p).
  const judgeCopy = video.replace(/\.mp4$/, ".judge720.mp4");
  await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", video,
    "-vf", "scale=1280:720", "-c:v", "libx264", "-preset", "fast", "-crf", "28", "-an",
    judgeCopy,
  ]);
  const bytes = fs.readFileSync(judgeCopy);
  console.log(`judging ${path.basename(video)} (${(bytes.length / 1e6).toFixed(1)}MB judge copy, ${model})`);

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                inlineData: { mimeType: "video/mp4", data: bytes.toString("base64") },
                videoMetadata: { fps: 5 },
              },
              { text: CRITIQUE_PROMPT },
            ],
          },
        ],
        generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
  let critique;
  try {
    critique = JSON.parse(text);
  } catch {
    throw new Error(`unparseable critique: ${text.slice(0, 500)}`);
  }

  const outFile = video.replace(/\.mp4$/, ".critique.json");
  writeJson(outFile, critique);

  console.log(`\nSCORE: ${critique.overall_score}/10 — one video: ${critique.feels_like_one_video}`);
  console.log(`"${critique.verdict_one_sentence}"\n`);
  for (const i of critique.issues || []) {
    console.log(`  [${i.severity}] ${i.start_s}s–${i.end_s}s  ${i.what}`);
    console.log(`        fix: ${i.fix}`);
  }
  console.log(`\nTop three changes:`);
  (critique.top_three_changes || []).forEach((c, k) => console.log(`  ${k + 1}. ${c}`));
  console.log(`\ncritique → ${outFile}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
