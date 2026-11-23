/*
 * Site error alerts (Wyatt, 2026-11-03): when a page or API call fails on
 * production, the team gets a short email, and every failure is kept,
 * grouped, in app_errors for the admin Errors view.
 *
 * Grouping: one row per problem. The fingerprint is where it happened plus
 * the message with ids, numbers and quoted values stripped, so the same bug
 * hitting a hundred listings is one row with a count of 100.
 *
 * Emails: only from production, and only
 *   - the first time a problem is seen,
 *   - when a problem marked resolved comes back,
 *   - when its count reaches 10, 100, 1000 (so a growing problem is noticed),
 * never more than once an hour for the same problem, and at most
 * MAX_ALERTS_PER_HOUR in total per server instance, so a storm cannot flood
 * the inbox.
 *
 * Never throws and never logs through console.error (which is itself
 * captured), so reporting a failure cannot cause another.
 */
import { createHash } from "node:crypto";
import supabase from "@/lib/supabase";
import { appEnv } from "@/lib/appEnv";
import { sendTeamEmail, getBaseUrl } from "@/lib/email";
import { esc, resolveCheckinRecipients, wrapHtml } from "@/lib/chat/checkin";

const HOUR = 3600000;
const MAX_ALERTS_PER_HOUR = 15;
const alertTimes = [];
let busy = 0;
// One Error object is counted once, whether Next.js reports it, our route logs
// it, or both.
const counted = new WeakSet();

/* True while a report is being written, so a log line it causes is not reported too. */
export const isReporting = () => busy > 0;

// Failures that are not ours to fix: the visitor's connection, browser
// extensions, a tab left open across a deploy, and noise browsers emit.
const IGNORE = [
  /ResizeObserver loop/i,
  /^Script error\.?$/i,
  /Failed to fetch|Load failed|NetworkError|network error|The network connection was lost/i,
  /ChunkLoadError|Loading (CSS )?chunk \d+ failed/i,
  /chrome-extension:|moz-extension:|safari-extension:/i,
  /AbortError|The operation was aborted|signal is aborted/i,
  /NEXT_REDIRECT|NEXT_NOT_FOUND/,
  // The database saying no to an ordinary request: someone opening a chat
  // they are not in, messaging about their own listing, an empty or too long
  // message. The app answers these properly; they are not breakages.
  /not a participant in this conversation|cannot start a chat about your own listing|message body (is required|exceeds)/i,
  // Microsoft's email link scanner (Outlook Safe Links) opening links from our
  // emails in a headless browser. Seen on /unsubscribe, /privacy and
  // /review/finish; no real visitor is involved.
  /Object Not Found Matching Id:\d+, MethodName:\w+, ParamCount:\d+/,
];

/*
 * A browser error whose every stack frame is the page's own address (not a
 * script file, a blob: worker or another site) came from code a browser,
 * extension or in-app browser ran inside the page: Brave's crypto wallet,
 * share and reader tools. Only real frame lines count ("at ..." in Chrome,
 * "name@url" in Safari and Firefox), never the message line. An error with
 * no frames is kept, since we cannot tell where it came from.
 * Limit: an inline <script> of our own would look the same, so its errors
 * would not alert. Our code ships as /_next/ script files today.
 */
function injectedScript(stack, path) {
  if (!path) return false;
  const page = String(path).split(/[?#]/)[0];
  const urls = String(stack ?? "")
    .split("\n")
    .map((l) => l.trim())
    .map((l) => (/^at /.test(l) ? l.match(/\(?(\S+?):\d+:\d+\)?$/) : /@/.test(l) ? l.match(/@(\S+?):\d+:\d+$/) : null))
    .filter(Boolean)
    .map((m) => m[1]);
  return urls.length > 0 && urls.every((u) => {
    try {
      const url = new URL(u);
      return /^https?:$/.test(url.protocol) && url.pathname === page;
    } catch {
      return false;
    }
  });
}

export function ignorable(message = "", stack = "", source = null, path = null) {
  if (source === "browser" && injectedScript(stack, path)) return true;
  return IGNORE.some((re) => re.test(message) || re.test(stack));
}

/* The message with what varies between occurrences taken out. */
function normalize(message) {
  return String(message)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/"[^"]{0,200}"|'[^']{0,200}'/g, "<value>")
    .replace(/\b\d+(\.\d+)?\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/* The first stack line from our own code, which says where it broke. */
function topFrame(stack) {
  const line = String(stack ?? "").split("\n").map((l) => l.trim()).find((l) => /^at /.test(l) && !/node_modules|node:internal/.test(l));
  return line ? line.replace(/:\d+:\d+\)?$/, "").replace(/\?[^)\s]*/g, "").slice(0, 200) : "";
}

/* Why to email about this row now, or null to stay quiet. */
function alertReason(row) {
  if (appEnv() !== "production") return null;
  const now = Date.now();
  const last = row.last_alerted_at ? Date.parse(row.last_alerted_at) : 0;
  if (now - last < HOUR) return null;
  let reason = null;
  if (!row.last_alerted_at) reason = "New error";
  else if (row.reopened_at && Date.parse(row.reopened_at) > last) reason = "Error is back after being marked resolved";
  else if ([10, 100, 1000, 10000].some((step) => row.count >= step && (row.alerted_count ?? 0) < step)) reason = `Error has now happened ${row.count} times`;
  if (!reason) return null;
  while (alertTimes.length && now - alertTimes[0] > HOUR) alertTimes.shift();
  if (alertTimes.length >= MAX_ALERTS_PER_HOUR) return null;
  alertTimes.push(now);
  return reason;
}

async function sendAlert(row, headline) {
  const facts = [
    ["Where", row.where_label],
    ["Side", row.source === "browser" ? "In a visitor's browser" : "On the server"],
    ["Message", row.message],
    ["Times seen", row.count],
    ["First seen", new Date(row.first_seen_at).toUTCString()],
    ["Page", row.sample?.url],
    ["Signed in as", row.sample?.role],
    ["Browser", row.sample?.userAgent],
  ].filter(([, v]) => v != null && v !== "");
  const rows = facts
    .map(([k, v]) => `<tr><td style="padding:4px 10px 4px 0;color:#6b7280;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:4px 0;color:#111">${esc(v)}</td></tr>`)
    .join("");
  const link = `${getBaseUrl()}/dashboard/admin/system/errors?error=${row.id}`;
  const html = wrapHtml(`
    <h2 style="color:#E82027;font-size:18px;margin:0 0 6px">${esc(headline)}</h2>
    <p style="color:#111;font-size:14px;margin:0 0 10px">Something failed on useproximity.org. Same problem again won't email for at least an hour.</p>
    <table style="font-size:13px;border-collapse:collapse">${rows}</table>
    ${row.stack ? `<pre style="font-size:11px;color:#374151;background:#f3f4f6;padding:8px;border-radius:6px;white-space:pre-wrap;margin:12px 0 0">${esc(String(row.stack).split("\n").slice(0, 8).join("\n"))}</pre>` : ""}
    <p style="font-size:14px;margin:14px 0 0"><a href="${esc(link)}" style="color:#E82027">Open it in admin</a></p>
  `);
  await sendTeamEmail({
    to: resolveCheckinRecipients(),
    subject: `Site error: ${String(row.where_label || row.message).slice(0, 80)}`,
    html,
  });
  await supabase.from("app_errors").update({ last_alerted_at: new Date().toISOString(), alerted_count: row.count }).eq("id", row.id);
}

/**
 * Count one failure, and email the team when it calls for it.
 * @param {{ source: "server"|"browser", where?: string, error?: unknown, message?: string, stack?: string, sample?: object }} input
 */
export async function recordError({ source, where = null, error = null, message = null, stack = null, sample = {} }) {
  if (busy > 3) return null; // a failure while reporting a failure: stop
  busy++;
  try {
    if (error && typeof error === "object") {
      if (counted.has(error)) return null;
      counted.add(error);
    }
    const msg = String(message ?? error?.message ?? error ?? "Unknown error").slice(0, 2000);
    const stk = stack ?? (error && typeof error === "object" ? error.stack : null) ?? null;
    if (!msg || ignorable(msg, stk ?? "", source, sample?.url)) return null;
    const fingerprint = createHash("sha256")
      .update([source, where ?? "", normalize(msg), topFrame(stk)].join("|"))
      .digest("hex")
      .slice(0, 40);
    const { data: row, error: dbError } = await supabase.rpc("record_app_error", {
      p_fingerprint: fingerprint, p_source: source, p_where: where, p_message: msg,
      p_stack: stk ? String(stk).slice(0, 8000) : null, p_sample: sample ?? {}, p_env: appEnv(),
    });
    if (dbError || !row) return null;
    const reason = alertReason(row);
    if (reason) await sendAlert(row, reason).catch(() => {});
    return row;
  } catch {
    return null;
  } finally {
    busy--;
  }
}
