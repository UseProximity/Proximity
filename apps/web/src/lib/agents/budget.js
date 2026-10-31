/*
 * The agents' AI spend caps (PRD v3; enforced since the PR #365 review,
 * Wyatt 2026-10-31): $5 per listing a month and $300 a month in all, with the
 * team alerted at 80% of either.
 *
 * Only Proxy's answers to students are capped, since they grow with traffic.
 * Everything that keeps a conversation working (classifying and relaying a
 * landlord's reply, saving what they said) and the team's own jobs (seeding,
 * syncs, source searches) are never blocked. Over a cap, Proxy's answer call
 * is refused and Proxy falls back to sending the question to the landlord.
 *
 * Spend is read from listing_agent_usage, cached for a minute per scope so a
 * busy listing does not query it on every message.
 */
import supabase from "@/lib/supabase";
import { outreachEnabled } from "@/lib/appEnv";
import { sendTeamEmail } from "@/lib/email";

// The same team inbox the source-sync digest goes to (lib/sourceImport/sync.js),
// read here rather than imported: that module imports the agents' model calls.
const ALERT_TO = process.env.SOURCE_SYNC_ALERT_EMAIL || "info@useproximity.org,o.wyatt@wustl.edu";

export const LISTING_CAP_CENTS = Math.round((Number(process.env.AGENT_LISTING_CAP_USD) || 5) * 100);
export const TOTAL_CAP_CENTS = Math.round((Number(process.env.AGENT_TOTAL_CAP_USD) || 300) * 100);
const ALERT_AT = 0.8;
export const CAPPED_KINDS = new Set(["answer", "test_answer"]);

export class BudgetExceeded extends Error {}

const monthStart = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
};

async function sumSince(listingId, since) {
  let total = 0;
  for (let from = 0; ; from += 1000) {
    let q = supabase.from("listing_agent_usage").select("cost_cents").gte("created_at", since).range(from, from + 999);
    if (listingId) q = q.eq("listing_id", listingId);
    const { data, error } = await q;
    if (error) throw new Error(`agent spend: ${error.message}`);
    for (const r of data ?? []) total += Number(r.cost_cents) || 0;
    if (!data || data.length < 1000) return total;
  }
}

const cache = new Map(); // scope -> { at, cents }
async function spent(listingId) {
  const key = `${listingId ?? "all"}:${monthStart()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.cents;
  const cents = await sumSince(listingId, monthStart());
  cache.set(key, { at: Date.now(), cents });
  return cents;
}

const alerted = new Set();
async function alertOnce(scope, cents, cap, label) {
  const key = `${scope}:${monthStart()}:${cents >= cap ? "cap" : "80"}`;
  if (alerted.has(key)) return;
  alerted.add(key);
  const over = cents >= cap;
  console.error(`[agents] spend ${over ? "cap reached" : "at 80%"} for ${label}: $${(cents / 100).toFixed(2)} of $${(cap / 100).toFixed(2)} this month`);
  if (!outreachEnabled()) return;
  await sendTeamEmail({
    to: ALERT_TO,
    subject: `Proxy spend ${over ? "cap reached" : "at 80%"}: ${label}`,
    html: `<p>Proxy has spent $${(cents / 100).toFixed(2)} of its $${(cap / 100).toFixed(2)} monthly cap for ${label}.</p><p>${over ? "Proxy has stopped answering there for the rest of the month; questions still go to the landlord." : "At the cap Proxy stops answering there; questions still go to the landlord."} The caps are AGENT_LISTING_CAP_USD and AGENT_TOTAL_CAP_USD.</p>`,
  }).catch((err) => console.error("[agents] spend alert failed:", err?.message ?? err));
}

/* Throws BudgetExceeded when a capped call would go over; alerts at 80%. */
export async function checkBudget({ listingId, kind }) {
  if (!CAPPED_KINDS.has(kind)) return;
  const [total, mine] = await Promise.all([spent(null), listingId ? spent(listingId) : 0]);
  if (total >= TOTAL_CAP_CENTS * ALERT_AT) await alertOnce("all", total, TOTAL_CAP_CENTS, "all listings");
  if (listingId && mine >= LISTING_CAP_CENTS * ALERT_AT) await alertOnce(listingId, mine, LISTING_CAP_CENTS, `listing ${listingId}`);
  if (total >= TOTAL_CAP_CENTS) throw new BudgetExceeded("monthly spend cap reached for all listings");
  if (listingId && mine >= LISTING_CAP_CENTS) throw new BudgetExceeded("monthly spend cap reached for this listing");
}
