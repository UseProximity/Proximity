/*
 * The rollout digest (PRD v3, "Metrics and rollout digest"): one email a day
 * to the team covering the previous day. Scraping, extraction accuracy (a
 * sample to spot-check), answer accuracy (a sample to grade), answer
 * coverage, questions and tours, learning, cost, and anything gone from a
 * website. The same run tells each landlord about units or listings that
 * vanished from their website (an availability-gone event never hides a
 * listing on its own).
 */
import supabase from "@/lib/supabase";
import { getBaseUrl, sendAgentDigestEmail, sendTourEmail } from "@/lib/email";
import { ALERT_TO } from "@/lib/sourceImport/sync";

const DAY = 24 * 3600 * 1000;

function window(now = new Date()) {
  const end = new Date(now);
  const start = new Date(now.getTime() - DAY);
  return { start: start.toISOString(), end: end.toISOString(), label: start.toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "long", month: "long", day: "numeric" }) };
}

const countOf = async (table, mod) => {
  let q = supabase.from(table).select("id", { count: "exact", head: true });
  q = mod(q);
  const { count } = await q;
  return count ?? 0;
};

const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const hours = (ms) => (ms == null ? "n/a" : ms < 3600000 ? `${Math.round(ms / 60000)} min` : `${(ms / 3600000).toFixed(1)} h`);

export async function buildDigest({ now = new Date() } = {}) {
  const w = window(now);
  const since = (q) => q.gte("created_at", w.start).lt("created_at", w.end);
  const baseUrl = getBaseUrl();
  const sections = [];
  const label = (l) => l?.title || l?.address || "a listing";

  // Scraping
  const { data: syncJobs } = await supabase.from("listing_import_jobs").select("status, target, result, listings!listing_id(title, address)").gte("finished_at", w.start).lt("finished_at", w.end).limit(2000);
  const syncs = (syncJobs ?? []).filter((j) => j.target?.sync);
  const imports = (syncJobs ?? []).filter((j) => !j.target?.sync && j.status === "done" && j.result?.mode === "import");
  const failed = syncs.filter((j) => j.status === "failed");
  const { data: monitors } = await supabase.from("listing_source_monitors").select("last_status, listings!listing_id(title, address)").in("last_status", ["fetch_failed", "parse_failed"]).gte("last_checked_at", w.start).limit(500);
  const factsBySync = await countOf("listing_fact_events", (q) => since(q).eq("cause", "sync").eq("status", "applied"));
  const heldBySync = await countOf("listing_fact_events", (q) => since(q).eq("cause", "sync").eq("status", "held"));
  const siteApplied = await countOf("listing_source_events", (q) => since(q).eq("status", "applied"));
  const siteOpen = await countOf("listing_source_events", (q) => since(q).eq("status", "open"));
  const holds = await countOf("listing_source_events", (q) => since(q).in("kind", ["churn_hold", "low_confidence"]));
  sections.push({
    title: "Scraping",
    rows: [["Syncs run", syncs.length], ["Succeeded", syncs.length - failed.length], ["Failed", failed.length], ["Pages unreachable", (monitors ?? []).length], ["Knowledge facts changed by syncs", factsBySync], ["Held (landlord-set)", heldBySync], ["Website changes auto-applied", siteApplied], ["Website changes held for landlords", siteOpen], ["Low-confidence and churn holds", holds], ["New listings created from URLs", imports.length]],
    list: failed.slice(0, 10).map((j) => `${label(j.listings)}: ${j.error ?? "failed"}`),
  });

  // Extraction accuracy: a sample to check against the source.
  const { data: pageFacts } = await supabase.from("listing_facts").select("summary, source_ref, listings!listing_id(title, address), listing_sources!source_id(kind, url)").gte("created_at", w.start).lt("created_at", w.end).eq("is_current", true).limit(400);
  const extracted = (pageFacts ?? []).filter((f) => ["page", "document"].includes(f.listing_sources?.kind));
  const sample = (arr, n) => [...arr].sort(() => Math.random() - 0.5).slice(0, n);
  const rejections = await countOf("listing_source_events", (q) => q.eq("status", "rejected").gte("verdict_at", w.start).lt("verdict_at", w.end));
  sections.push({
    title: "Extraction accuracy",
    rows: [["Facts read from pages and documents", extracted.length], ["Website changes rejected by landlords", rejections]],
    list: sample(extracted, 5).map((f) => `${label(f.listings)}: "${f.summary}" (${f.listing_sources?.url ?? f.source_ref ?? "document"})`),
    note: "Spot-check these five against the source.",
  });

  // Answer accuracy and coverage
  const { data: logs } = await supabase.from("listing_agent_questions").select("question, answer, outcome, user_id, visitor_id, reported_at, inquiry, listings!listing_id(title, address)").gte("created_at", w.start).lt("created_at", w.end).eq("inquiry", true).limit(5000);
  const L = logs ?? [];
  const by = (k) => L.filter((x) => x.outcome === k).length;
  const corrections = await countOf("chat_messages", (q) => since(q).eq("message_type", "proxy_note").contains("metadata", { correction: "" }).limit(1)).catch(() => 0);
  const { count: correctionNotes } = await supabase.from("chat_messages").select("id", { count: "exact", head: true }).gte("created_at", w.start).lt("created_at", w.end).eq("message_type", "proxy_note").like("body", "Update:%");
  const { data: openQs } = await supabase.from("listing_questions").select("question, asked_count, listings!listing_id(title, address)").eq("status", "open").order("asked_count", { ascending: false }).limit(5);
  sections.push({
    title: "Answer accuracy",
    rows: [["Answers reported by students", L.filter((x) => x.reported_at).length], ["Answers later corrected (update notes)", correctionNotes ?? corrections ?? 0]],
    list: sample(L.filter((x) => x.outcome === "answered"), 5).map((x) => `${label(x.listings)}: Q "${x.question.slice(0, 120)}" / A "${(x.answer ?? "").slice(0, 200)}"`),
    note: "Grade these five answers against the listing.",
  });
  sections.push({
    title: "Answer coverage",
    rows: [["Inquiries", L.length], ["Answered by Proxy", by("answered")], ["Partly answered", by("partly_answered")], ["Sent to the landlord", by("asked_landlord")], ["Small talk", by("chit_chat")], ["Wanted a tour", by("tour")], ["Listing unavailable", by("unavailable")], ["Failed", by("failed")], ["Signed in", L.filter((x) => x.user_id).length], ["Signed out", L.filter((x) => !x.user_id).length]],
    list: (openQs ?? []).map((q) => `${label(q.listings)}: "${q.question}"${q.asked_count > 1 ? ` (asked ${q.asked_count} times)` : ""}`),
    note: "Top unanswered questions right now.",
  });

  // Questions and tours
  const { data: qs } = await supabase.from("listing_questions").select("status, created_at, answered_at, asked_count, student_told_at").or(`created_at.gte.${w.start},answered_at.gte.${w.start}`).limit(2000);
  const Q = qs ?? [];
  const sent = Q.filter((q) => q.created_at >= w.start && q.created_at < w.end).length;
  const answered = Q.filter((q) => q.answered_at && q.answered_at >= w.start && q.answered_at < w.end);
  const med = median(answered.map((q) => new Date(q.answered_at) - new Date(q.created_at)));
  const told = Q.filter((q) => q.student_told_at && q.student_told_at >= w.start && q.student_told_at < w.end).length;
  const screened = await countOf("listing_question_messages", (q) => since(q).eq("screened", true));
  const { data: tours } = await supabase.from("tour_requests").select("status, created_at, confirmed_at, last_activity_at").gte("last_activity_at", w.start).limit(2000);
  const T = tours ?? [];
  sections.push({
    title: "Questions and tours",
    rows: [["Questions sent to landlords", sent], ["Answered by landlords", answered.length], ["Median time to answer", hours(med)], ["Still unanswered at day 5", told], ["Answers with contact details removed", screened], ["Repeat questions that still reached a landlord", Q.filter((q) => q.asked_count > 1 && q.created_at >= w.start).length], ["Tours requested", T.filter((t) => t.created_at >= w.start).length], ["Tours confirmed", T.filter((t) => t.confirmed_at && t.confirmed_at >= w.start).length], ["Tours cancelled", T.filter((t) => t.status === "cancelled" && t.last_activity_at >= w.start).length]],
  });

  // Learning
  const answersWithFacts = await countOf("listing_sources", (q) => since(q).eq("kind", "landlord_answer"));
  const factsFromAnswers = await countOf("listing_fact_events", (q) => since(q).eq("cause", "landlord_answer").eq("status", "applied"));
  const landlordEdits = await countOf("listing_fact_events", (q) => since(q).in("cause", ["landlord_chat", "dashboard", "document"]).eq("status", "applied"));
  const forAdmin = await countOf("listing_fact_events", (q) => q.eq("status", "proposed").contains("detail", { adminReview: true }));
  sections.push({ title: "Learning", rows: [["Landlord answers", answersWithFacts], ["Facts saved from answers", factsFromAnswers], ["Facts set by landlords (chat, dashboard, documents)", landlordEdits], ["Waiting for the team (fair housing, new owners)", forAdmin]] });

  // Cost
  const { data: usage } = await supabase.from("listing_agent_usage").select("listing_id, kind, cost_cents").gte("created_at", w.start).lt("created_at", w.end).limit(20000);
  const U = usage ?? [];
  const byKind = {};
  const byListing = {};
  for (const u of U) { byKind[u.kind] = (byKind[u.kind] ?? 0) + Number(u.cost_cents); if (u.listing_id) byListing[u.listing_id] = (byListing[u.listing_id] ?? 0) + Number(u.cost_cents); }
  const topIds = Object.entries(byListing).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const { data: topListings } = topIds.length ? await supabase.from("listings").select("id, title, address").in("id", topIds.map(([id]) => id)) : { data: [] };
  const name = new Map((topListings ?? []).map((l) => [l.id, label(l)]));
  const total = U.reduce((n, u) => n + Number(u.cost_cents), 0);
  sections.push({
    title: "Cost",
    rows: [["Model spend", `$${(total / 100).toFixed(2)}`], ...Object.entries(byKind).sort((a, b) => b[1] - a[1]).map(([k, c]) => [`  ${k.replace(/_/g, " ")}`, `$${(c / 100).toFixed(2)}`])],
    list: topIds.map(([id, c]) => `${name.get(id) ?? id}: $${(c / 100).toFixed(2)}`),
    note: topIds.length ? "Top agents by spend." : "",
  });

  // Gone from a website
  const { data: gone } = await supabase.from("listing_source_events").select("id, kind, detail, listing_id, listings!listing_id(title, address)").in("kind", ["missing_unit", "listing_gone"]).eq("status", "open").gte("created_at", w.start).lt("created_at", w.end).limit(200);
  sections.push({ title: "Gone from a website", rows: [["Units or listings no longer on their website", (gone ?? []).length]], list: (gone ?? []).map((e) => `${label(e.listings)}${e.detail?.label ? `: ${e.detail.label}` : ""}`), note: (gone ?? []).length ? "Nothing is hidden on its own; the landlord was told." : "" });

  return { day: w.label, sections, gone: gone ?? [], baseUrl, inquiries: L.length, syncs: syncs.length };
}

/* Tell each landlord about units or listings gone from their website (once per event). */
export async function notifyGone(gone) {
  let sent = 0;
  for (const e of gone) {
    if (e.detail?.landlordTold) continue;
    const { data: owner } = await supabase.rpc("fn_chat_primary_landlord_id", { p_listing_id: e.listing_id });
    if (!owner) continue;
    const { data: u } = await supabase.from("users").select("email, name, email_notifications, deleted_at").eq("id", owner).maybeSingle();
    if (!u?.email || u.deleted_at || u.email_notifications === false) continue;
    const listingLabel = e.listings?.title || e.listings?.address || "your listing";
    await sendTourEmail({
      kind: "availability_gone", to: u.email, name: u.name, subject: `Is ${e.detail?.label ? `${e.detail.label} at ` : ""}${listingLabel} still available?`,
      intro: `Your website no longer shows ${e.detail?.label ? `${e.detail.label} at ${listingLabel}` : listingLabel}. Proximity still lists it; nothing is hidden automatically.`,
      lines: [], note: "If it has been leased, withdraw it from your dashboard so students stop asking about it. If it is still available, no action is needed.",
      ctaLabel: "Open your dashboard", ctaUrl: `${getBaseUrl()}/dashboard/landlord?property=${e.listing_id}`, userId: owner,
    });
    await supabase.from("listing_source_events").update({ detail: { ...(e.detail ?? {}), landlordTold: new Date().toISOString() } }).eq("id", e.id);
    sent++;
  }
  return sent;
}

export async function runDigest({ now = new Date(), email = true } = {}) {
  const digest = await buildDigest({ now });
  let landlordsTold = 0;
  try { landlordsTold = await notifyGone(digest.gone); } catch (err) { console.error("[agent-digest] gone notices failed:", err?.message ?? err); }
  if (email) await sendAgentDigestEmail({ to: ALERT_TO, day: digest.day, sections: digest.sections, baseUrl: digest.baseUrl });
  return { day: digest.day, sections: digest.sections.map((s) => ({ title: s.title, rows: s.rows, list: s.list })), landlordsTold };
}
