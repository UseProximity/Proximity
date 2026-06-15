/*
 * Thin top bar shown on every NON-production environment. Guardrails (dev DB/bucket, outreach
 * off) are the default everywhere except the real production site, and this banner makes that
 * visible — amber on staging (APP_ENV=staging), slate on localhost (development). It shows when
 * the data snapshot was taken (read from app_metadata in the dev DB, which the snapshot script
 * stamps on each run). Renders nothing on production, so it's safe to mount unconditionally in
 * the root layout.
 */
import { appEnv } from "@/lib/appEnv";
import supabase from "@/lib/supabase";

export default async function StagingBanner() {
  const env = appEnv();
  if (env === "production") return null;

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
    ? "w-full bg-slate-700 text-slate-100 text-center text-xs font-medium py-1 px-3"
    : "w-full bg-amber-400 text-amber-950 text-center text-xs font-medium py-1 px-3";
  const label = isLocal ? "🛠️ LOCALHOST" : "⚠️ STAGING";

  return (
    <div className={className}>
      {label} — data snapshot from {dateStr}. Changes here don’t affect production.
    </div>
  );
}
