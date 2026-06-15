/*
 * Thin top bar shown ONLY on the staging environment (APP_ENV=staging). Signals that the
 * site is staging and shows when the data snapshot was taken (read from app_metadata in the
 * dev DB, which the snapshot script stamps on each run). Renders nothing on prod/local, so
 * it's safe to mount unconditionally in the root layout.
 */
import { isStaging } from "@/lib/appEnv";
import supabase from "@/lib/supabase";

export default async function StagingBanner() {
  if (!isStaging()) return null;

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

  return (
    <div className="w-full bg-amber-400 text-amber-950 text-center text-xs font-medium py-1 px-3">
      ⚠️ STAGING — data snapshot from {dateStr}. Changes here don’t affect production.
    </div>
  );
}
