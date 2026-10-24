/*
 * Spending caps for the URL importer.
 *
 * Every picker read and every building read costs real money (Firecrawl
 * renders, Haiku, occasionally Sonnet), and anyone can make a landlord
 * account, Google sign-in included. So before a paid read starts, the
 * account's recent spend in listing_import_usage is checked against:
 *
 *   per account   picker reads per hour and per day; buildings per day,
 *                 fewer for an account made in the last three days
 *   site-wide     picker reads and buildings per day across everyone: a
 *                 circuit breaker for a crop of new accounts, which alerts
 *                 the team the first time it trips
 *
 * The ledger is in the database, not in memory, so it holds across server
 * instances. Supers are exempt. If the ledger cannot be read the read is
 * refused: a paid scrape never runs uncounted. Every number can be changed
 * with an IMPORT_* setting.
 */
import supabase from "@/lib/supabase";
import { outreachEnabled } from "@/lib/appEnv";
import { sendImportCapAlertEmail } from "@/lib/email";
import { ALERT_TO } from "./sync.js";

const n = (name, fallback) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};
export const LIMITS = {
  pickerPerHour: n("IMPORT_PICKER_PER_HOUR", 20),
  pickerPerDay: n("IMPORT_PICKER_PER_DAY", 60),
  buildingsPerDay: n("IMPORT_BUILDINGS_PER_DAY", 80),
  buildingsPerDayNewAccount: n("IMPORT_BUILDINGS_PER_DAY_NEW", 20),
  newAccountHours: n("IMPORT_NEW_ACCOUNT_HOURS", 72),
  globalPickerPerDay: n("IMPORT_GLOBAL_PICKER_PER_DAY", 1500),
  globalBuildingsPerDay: n("IMPORT_GLOBAL_BUILDINGS_PER_DAY", 800),
};

const HOUR = 60 * 60 * 1000;
const since = (ms) => new Date(Date.now() - ms).toISOString();

async function used({ userId = null, kind, ms }) {
  let q = supabase.from("listing_import_usage").select("units").eq("kind", kind).gt("created_at", since(ms)).limit(20000);
  if (userId) q = q.eq("user_id", userId);
  const { data, error } = await q;
  if (error) throw new Error(`usage ledger: ${error.message}`);
  return (data ?? []).reduce((sum, r) => sum + (r.units ?? 1), 0);
}

// One alert per cap per server instance per day; enough to wake someone up.
const alerted = new Map();
async function alertOnce(kind, usedNow, limit) {
  const key = `${kind}:${new Date().toISOString().slice(0, 10)}`;
  if (alerted.has(key)) return;
  alerted.set(key, true);
  console.error(`[import-limits] site-wide ${kind} cap reached: ${usedNow} of ${limit} in 24h; imports paused`);
  if (outreachEnabled()) await sendImportCapAlertEmail({ to: ALERT_TO, kind, used: usedNow, limit, hours: 24 }).catch(() => {});
}

const refuse = (error) => ({ ok: false, status: 429, error });

/*
 * Check a spend and, when it fits, record it. kind "picker" (units 1) or
 * "building" (units = how many buildings will be read). Returns { ok } or
 * { ok: false, status, error } with a message a landlord can read.
 */
export async function spendImport({ userId, kind, units = 1, isSuper = false }) {
  if (isSuper) {
    await supabase.from("listing_import_usage").insert({ user_id: userId, kind, units }).then(() => {}, () => {});
    return { ok: true };
  }
  try {
    if (kind === "picker") {
      const [hour, day, all] = await Promise.all([
        used({ userId, kind, ms: HOUR }),
        used({ userId, kind, ms: 24 * HOUR }),
        used({ kind, ms: 24 * HOUR }),
      ]);
      if (all + units > LIMITS.globalPickerPerDay) {
        await alertOnce("picker", all, LIMITS.globalPickerPerDay);
        return refuse("Website imports are busy right now. Please try again in a few hours, or add your listing by hand.");
      }
      if (hour + units > LIMITS.pickerPerHour) return refuse("You've read a lot of websites in the last hour. Try again in an hour.");
      if (day + units > LIMITS.pickerPerDay) return refuse("You've used today's website reads. Try again tomorrow, or add your listing by hand.");
    } else {
      const { data: user } = await supabase.from("users").select("created_at").eq("id", userId).maybeSingle();
      const isNew = !user?.created_at || Date.now() - new Date(user.created_at).getTime() < LIMITS.newAccountHours * HOUR;
      const cap = isNew ? LIMITS.buildingsPerDayNewAccount : LIMITS.buildingsPerDay;
      const [day, all] = await Promise.all([used({ userId, kind, ms: 24 * HOUR }), used({ kind, ms: 24 * HOUR })]);
      if (all + units > LIMITS.globalBuildingsPerDay) {
        await alertOnce("building", all, LIMITS.globalBuildingsPerDay);
        return refuse("Website imports are busy right now. Please try again in a few hours, or add your listing by hand.");
      }
      if (day + units > cap) {
        const left = Math.max(0, cap - day);
        return refuse(
          left
            ? `You can import ${left} more ${left === 1 ? "property" : "properties"} today. Untick some and continue, or come back tomorrow.`
            : "You've imported today's limit of properties. Come back tomorrow, or contact us if you need more."
        );
      }
    }
    const { error } = await supabase.from("listing_import_usage").insert({ user_id: userId, kind, units });
    if (error) throw new Error(`usage ledger: ${error.message}`);
    return { ok: true };
  } catch (err) {
    console.error("[import-limits]", err?.message);
    return { ok: false, status: 503, error: "We couldn't start that right now. Please try again in a minute." };
  }
}
