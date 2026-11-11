/*
 * Every call to Firecrawl goes through here, so a second account can take over
 * when the first runs out of credits (Wyatt, 2026-11-11).
 *
 * FIRECRAWL_API_KEY is the main account and FIRECRAWL_API_KEY_BACKUP the
 * backup (the name it was set under in Vercel). FIRECRAWL_API_KEY_2, named like
 * JINA_READER_KEY_2, is accepted too so either spelling works. A request goes to the main key first. When
 * Firecrawl answers 402 (out of credits) or 401 (key not accepted), the same
 * request is sent again on the next key, and the spent key rests for an hour
 * before it is tried again. That way the main account comes back by itself
 * after its monthly reset or a top-up, with no redeploy.
 *
 * The team hears about it by email: once when the backup takes over, and once
 * when every key is out. Each alert is sent at most once every 12 hours,
 * checked against sent_emails so many server instances do not each send one.
 *
 * firecrawlRequest returns the Response from the first key that did not refuse,
 * or null when no key is set or every key is resting. Callers already treat
 * null as "Firecrawl is not available" and fall back to Jina, Tavily or the
 * plain fetch.
 */

const BASE = "https://api.firecrawl.dev";
const REST_MS = 60 * 60 * 1000;
const ALERT_EVERY_MS = 12 * 60 * 60 * 1000;
const SPENT_STATUSES = new Set([401, 402]);

export const ALERT_SUBJECTS = {
  switched: "Firecrawl: main account is out, backup key in use",
  allOut: "Firecrawl: every account is out of credits",
};

// Written out by name (not process.env as a whole) so the knowledge scanner
// lists both keys as env vars.
function processEnv() {
  return {
    FIRECRAWL_API_KEY: process.env.FIRECRAWL_API_KEY,
    FIRECRAWL_API_KEY_BACKUP: process.env.FIRECRAWL_API_KEY_BACKUP,
    FIRECRAWL_API_KEY_2: process.env.FIRECRAWL_API_KEY_2,
  };
}

const restingUntil = new Map();
const alertedAt = new Map();

function keyList(env) {
  const keys = [
    { key: env.FIRECRAWL_API_KEY, label: "main (FIRECRAWL_API_KEY)" },
    { key: env.FIRECRAWL_API_KEY_BACKUP, label: "backup (FIRECRAWL_API_KEY_BACKUP)" },
    { key: env.FIRECRAWL_API_KEY_2, label: "backup (FIRECRAWL_API_KEY_2)" },
  ].filter((k) => k.key);
  // The same key set twice is one account, not a backup.
  return keys.filter((k, i) => keys.findIndex((o) => o.key === k.key) === i);
}

/** Whether any Firecrawl key is set at all (resting or not). */
export function firecrawlConfigured(env = processEnv()) {
  return keyList(env).length > 0;
}

/**
 * @param {string} path  e.g. "/v2/scrape"
 * @param {object} body  JSON body
 * @param {{ signal?: AbortSignal, deps?: object }} [opts]
 * @returns {Promise<Response|null>}
 */
export async function firecrawlRequest(path, body, { signal, deps = {} } = {}) {
  const {
    env = processEnv(),
    fetchImpl = fetch,
    now = Date.now,
    notify = sendAlert,
  } = deps;
  const keys = keyList(env);
  if (!keys.length) return null;

  const spent = [];
  for (const k of keys) {
    if ((restingUntil.get(k.key) ?? 0) > now()) {
      spent.push(k);
      continue;
    }
    const res = await fetchImpl(`${BASE}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${k.key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!SPENT_STATUSES.has(res.status)) {
      if (spent.length) await alertOnce("switched", { using: k, spent, status: null }, { now, notify });
      return res;
    }
    const detail = await res.text().catch(() => "");
    restingUntil.set(k.key, now() + REST_MS);
    console.warn(
      `[firecrawl] ${k.label} refused with HTTP ${res.status} ` +
        `(402 means that account is out of credits); resting it for an hour. ${detail.slice(0, 200)}`
    );
    spent.push({ ...k, status: res.status });
  }

  await alertOnce("allOut", { using: null, spent }, { now, notify });
  return null;
}

async function alertOnce(kind, info, { now, notify }) {
  if (alertedAt.has(kind) && alertedAt.get(kind) > now() - ALERT_EVERY_MS) return;
  alertedAt.set(kind, now());
  try {
    await notify(kind, info);
  } catch (err) {
    console.error("[firecrawl] alert failed:", err?.message ?? err);
  }
}

async function sendAlert(kind, { using, spent }) {
  const subject = ALERT_SUBJECTS[kind];
  const { default: supabase } = await import("./supabase.js");
  const since = new Date(Date.now() - ALERT_EVERY_MS).toISOString();
  const { data: recent } = await supabase
    .from("sent_emails")
    .select("id")
    .eq("subject", subject)
    .neq("status", "failed")
    .gte("created_at", since)
    .limit(1);
  if (recent?.length) return;

  const { sendTeamEmail } = await import("./email.js");
  const { esc, resolveCheckinRecipients, wrapHtml } = await import("./chat/checkin.js");
  const intro =
    kind === "switched"
      ? `Firecrawl refused the ${spent.map((s) => s.label).join(" and ")} key, so imports, website sync and source discovery are now running on the ${using.label} key.`
      : `Firecrawl refused every key we have (${spent.map((s) => s.label).join(", ")}). Website imports and sync fall back to Jina and Tavily, which cannot read some sites, and source discovery falls back to Tavily search.`;
  const action =
    kind === "switched"
      ? "Top up or turn on auto recharge for the main Firecrawl account. Calls move back to it on their own within an hour of it having credits again."
      : "Top up a Firecrawl account. Calls start working again on their own within an hour.";
  const html = wrapHtml(`
    <h2 style="color:#E82027;font-size:18px;margin:0 0 6px">${esc(subject)}</h2>
    <p style="color:#111;font-size:14px;margin:0 0 10px">${esc(intro)}</p>
    <p style="color:#111;font-size:14px;margin:14px 0 0"><strong>What to do:</strong> ${esc(action)}</p>
  `);
  await sendTeamEmail({ to: resolveCheckinRecipients(), subject, html });
}

/** Test hook: forget resting keys and sent alerts. */
export function resetFirecrawlState() {
  restingUntil.clear();
  alertedAt.clear();
}
