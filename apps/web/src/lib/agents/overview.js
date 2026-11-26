/*
 * The team's counts for the per-listing agents: agents by status, current
 * facts by section, sources by kind, and open held or proposed changes.
 * Read by the admin and dev seed routes.
 */
import supabase from "@/lib/supabase";
import { agentsEnabled } from "./flags";

async function countBy(table, column, extra = (q) => q) {
  const { data, error } = await extra(supabase.from(table).select(column).limit(100000));
  if (error) throw new Error(`${table}: ${error.message}`);
  const out = {};
  for (const r of data ?? []) out[r[column] ?? "null"] = (out[r[column] ?? "null"] ?? 0) + 1;
  return out;
}

export async function overview() {
  const [agents, facts, sources, open] = await Promise.all([
    countBy("listing_agents", "status"),
    countBy("listing_facts", "section", (q) => q.eq("is_current", true)),
    countBy("listing_sources", "kind"),
    countBy("listing_fact_events", "status", (q) => q.in("status", ["held", "proposed"])),
  ]);
  const { count: live } = await supabase.from("listings").select("id", { count: "exact", head: true }).is("deleted_at", null);
  return { enabled: agentsEnabled(), liveListings: live ?? 0, agents, facts, sources, open };
}
