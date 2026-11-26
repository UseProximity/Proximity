/*
 * Env + path resolution for the listing-video pipeline. Loads apps/web/.env.local
 * (scripts run outside Next, so nothing loads it for us). No dotenv dependency —
 * the file is simple KEY=VALUE lines.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SCRIPT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const WEB_ROOT = path.resolve(SCRIPT_ROOT, "..", "..");
export const CACHE_ROOT = path.join(SCRIPT_ROOT, ".cache");
export const ASSETS = {
  logo: path.join(SCRIPT_ROOT, "assets", "logo.png"),
  watermark: path.join(SCRIPT_ROOT, "assets", "watermark.png"),
  fontRegular: path.join(SCRIPT_ROOT, "assets", "fonts", "Inter-Regular.ttf"),
  fontMedium: path.join(SCRIPT_ROOT, "assets", "fonts", "Inter-Medium.ttf"),
  fontBold: path.join(SCRIPT_ROOT, "assets", "fonts", "Inter-Bold.ttf"),
  fontExtraBold: path.join(SCRIPT_ROOT, "assets", "fonts", "Inter-ExtraBold.ttf"),
};

let loaded = false;
export function loadEnv() {
  if (loaded) return;
  loaded = true;
  const file = path.join(WEB_ROOT, ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let [, key, value] = m;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

/* Returns { url, serviceKey } for the requested DB target, mirroring src/lib/supabase.js. */
export function dbConfig(target) {
  loadEnv();
  const prefix = target === "prod" ? "PROD" : "DEV";
  const url = process.env[`${prefix}_SUPABASE_URL`];
  const serviceKey = process.env[`${prefix}_SUPABASE_SERVICE_KEY`];
  if (!url || !serviceKey) {
    throw new Error(
      `${prefix}_SUPABASE_URL / ${prefix}_SUPABASE_SERVICE_KEY not set in apps/web/.env.local` +
        (target === "prod" ? " — prod credentials are not available locally; use --db dev" : "")
    );
  }
  return { url, serviceKey };
}

export function anthropicKey() {
  loadEnv();
  return process.env.LISTING_VIDEO_KEY || process.env.LEASE_SCANNER_KEY || null;
}

export function falKey() {
  loadEnv();
  return process.env.FAL_KEY || null;
}
