/*
 * Thin top bar shown on every NON-production environment. Guardrails (dev DB/bucket, outreach
 * off) are the default everywhere except the real production site, and this banner makes that
 * visible — amber on staging (APP_ENV=staging), slate on localhost (development). It shows when
 * the data snapshot was taken (read from app_metadata in the dev DB, which the snapshot script
 * stamps on each run). Renders nothing on production, so it's safe to mount unconditionally in
 * the root layout. A Hide button on the right hides it in that browser for
 * 30 days (StagingBannerBar sets the cookie read here).
 */
import { cookies } from "next/headers";
import { appEnv } from "@/lib/appEnv";
import supabase from "@/lib/supabase";
import StagingBannerBar from "./StagingBannerBar";

// Set by the Hide button in StagingBannerBar.
const HIDE_COOKIE = "hide_env_banner";

export default async function StagingBanner() {
  const env = appEnv();
  if (env === "production") return null;
  if ((await cookies()).get(HIDE_COOKIE)?.value === "1") return null;

  let dateStr = "unknown date";
  try {
    const { data } = await supabase
      .from("app_metadata")
      .select("value")
      .eq("key", "snapshot_taken_at")
      .single();
    if (data?.value) {
      dateStr = new Date(data.value).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    }
  } catch {
    // app_metadata may not exist yet (before the first snapshot) — fall back to the default.
  }

  const isLocal = env === "development";
  const className = isLocal
    ? "staging-banner w-full bg-slate-700 text-slate-100 text-center text-xs font-medium py-1 px-3"
    : "staging-banner w-full bg-amber-400 text-amber-950 text-center text-xs font-medium py-1 px-3";
  const label = isLocal ? "🛠️ LOCALHOST" : "⚠️ STAGING";

  return (
    <StagingBannerBar className={className}>
      {label} — data snapshot from {dateStr}. Changes here don’t affect production.
    </StagingBannerBar>
  );
}
