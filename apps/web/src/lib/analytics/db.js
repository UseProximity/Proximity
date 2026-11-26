import supabase from "@/lib/supabase";
import { appEnv, isProdData } from "@/lib/appEnv";

/*
 * Small read helpers for the admin Analytics page. Reads go through the deployment's own database
 * (prod on useproximity.org, the dev snapshot on staging and the sandbox), so the page
 * always describes the data that deployment actually serves.
 */

const PAGE = 1000; // PostgREST's default max rows per request

/** Every row of a query, paged past the 1000-row cap. `build` adds filters. */
export async function fetchAll(table, columns, build = (q) => q, orderBy = "id") {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(supabase.from(table).select(columns))
      .order(orderBy)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

export async function countRows(table, build = (q) => q) {
  const { count, error } = await build(
    supabase.from(table).select("*", { count: "exact", head: true })
  );
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

/** { name: id } for a small lookup table such as roles or interaction_types. */
export async function lookupIds(table) {
  const { data, error } = await supabase.from(table).select("id, name");
  if (error) throw new Error(`${table}: ${error.message}`);
  return Object.fromEntries(data.map((r) => [r.name, r.id]));
}

/** When the dev DB was last refreshed from prod (null on prod, or before the first run). */
export async function snapshotTakenAt() {
  const { data } = await supabase
    .from("app_metadata")
    .select("value")
    .eq("key", "snapshot_taken_at")
    .maybeSingle();
  return data?.value ?? null;
}

/*
 * The line under the Analytics title saying which database the numbers come from. On a copy
 * of production (staging, the sandbox, local) it says so, with the date of the last refresh.
 */
export function dataSourceLine(snapshotAt) {
  if (isProdData()) return "Database numbers are live from the production site.";
  const when = snapshotAt
    ? new Date(snapshotAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : "the last weekly refresh";
  return `Database numbers come from this ${appEnv()} copy of production, refreshed weekly (last on ${when}), plus any activity on this site since.`;
}
