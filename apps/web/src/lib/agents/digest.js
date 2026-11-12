/*
 * The rollout digest (PRD v3, "Metrics and rollout digest"): one email a day
 * to the team covering the previous day. Scraping, extraction accuracy (a
 * sample to spot-check), answer accuracy (a sample to grade), answer
 * coverage, questions and tours, learning, cost, and anything gone from a
 * website. The same run tells each landlord about units or listings that
 * vanished from their website (an availability-gone event never hides a
 * listing on its own).
 *
 * PAUSED 2026-11-04 (Wyatt): the landlord notices are off. They started going
 * out once the agents switch was on in production, and found pages (Zillow,
 * Apartments.com) may not show every unit, so a sync can flag units that are
 * still available. Events are still recorded and still listed in the team
 * digest and the admin queue. To turn the notices back on, set
 * LANDLORD_GONE_NOTICES to true.
 */
import supabase from "@/lib/supabase";
import { getBaseUrl, sendAgentDigestEmail, sendTourEmail } from "@/lib/email";
import { ALERT_TO } from "@/lib/sourceImport/sync";
import { syncTeamReview } from "./flags";

const DAY = 24 * 3600 * 1000;
const LANDLORD_GONE_NOTICES = false;

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
  const { data: syncJobs } = await supabase.from("listing_import_jobs").select("listing_id, status, error, target, result, listings!listing_id(title, address)").gte("finished_at", w.start).lt("finished_at", w.end).limit(2000);
  const syncs = (syncJobs ?? []).filter((j) => j.target?.sync);
  const imports = (syncJobs ?? []).filter((j) => !j.target?.sync && j.status === "done" && j.result?.mode === "import");
  const failed = syncs.filter((j) => j.status === "failed");
  const { data: monitors } = await supabase.from("listing_source_monitors").select("last_status, listings!listing_id(title, address)").in("last_status", ["fetch_failed", "parse_failed"]).gte("last_checked_at", w.start).limit(500);
  const factsBySync = await countOf("listing_fact_events", (q) => since(q).eq("cause", "sync").eq("status", "applied"));
  const heldBySync = await countOf("listing_fact_events", (q) => since(q).eq("cause", "sync").eq("status", "held"));
  const siteApplied = await countOf("listing_source_events", (q) => since(q).eq("status", "applied"));
  // Declined by the sync itself (lib/sourceImport/syncPolicy.js), each recorded once.
  const siteDenied = await countOf("listing_source_events", (q) => since(q).eq("status", "rejected").is("verdict_by", null));
  const skipped = syncs.filter((j) => j.result?.holdReason === "churn_hold").length;
  const teamReview = syncTeamReview();
  const factsForTeam = await countOf("listing_fact_events", (q) => since(q).eq("cause", "sync").eq("status", "proposed").contains("detail", { teamReview: true }));
  sections.push({
    title: "Scraping",
    rows: [["Syncs run", syncs.length], ["Deep reads", syncs.filter((j) => j.result?.deep).length], ["Succeeded", syncs.length - failed.length], ["Failed", failed.length], ["Pages unreachable", (monitors ?? []).length], ["Knowledge facts changed by syncs", factsBySync], ["Held (landlord-set)", heldBySync], ...(teamReview ? [["Knowledge changes waiting for the team", factsForTeam]] : []), ["Website changes applied", siteApplied], ["Website changes declined (new today)", siteDenied], ["Runs skipped (too much at once)", skipped], ["New listings created from URLs", imports.length]],
    list: failed.slice(0, 10).map((j) => `${label(j.listings)}: ${j.error ?? "failed"}`),
    note: "The sync applies or declines every website change itself; nothing waits for review." + (teamReview ? " What Proxy learns from pages still waits for the team in the admin Agents tab." : ""),
  });

  /*
   * What the agents learned (Wyatt, 2026-11-12): the Monday knowledge read,
   * listing by listing. Shown on the digest that covers it, and on any day a
   * sync added, changed or took out facts (specials, a landlord's sync).
   */
  const { data: learnedRows } = await supabase.from("listing_fact_events")
    .select("listing_id, previous_fact_id, new_value, status, listings!listing_id(title, address)")
    .eq("cause", "sync").eq("status", "applied").gte("created_at", w.start).lt("created_at", w.end).limit(5000);
  const learned = new Map();
  for (const e of learnedRows ?? []) {
    const k = learned.get(e.listing_id) ?? { name: label(e.listings), added: 0, changed: 0, removed: 0 };
    if (e.new_value == null) k.removed++;
    else if (e.previous_fact_id) k.changed++;
    else k.added++;
    learned.set(e.listing_id, k);
  }
  const knowledgeJobs = syncs.filter((j) => j.target?.knowledge);
  if (learned.size || knowledgeJobs.length) {
    const rows = [...learned.values()].sort((a, b) => (b.added + b.changed + b.removed) - (a.added + a.changed + a.removed));
    const sum = (f) => rows.reduce((n, r) => n + r[f], 0);
    sections.push({
      title: "What the agents learned",
      rows: [["Whole-site reads", knowledgeJobs.length], ["Facts added", sum("added")], ["Facts updated", sum("changed")], ["Facts taken out", sum("removed")]],
      list: rows.slice(0, 40).map((r) => `${r.name}: ${[r.added && `${r.added} new`, r.changed && `${r.changed} updated`, r.removed && `${r.removed} taken out`].filter(Boolean).join(", ")}`),
      note: "Whole-site reads run every Monday; specials are checked daily. A fact is taken out when its page has not said it for two weekly reads in a row. What a landlord set is never changed by a read.",
    });
  }

  /*
   * Website sync, listing by listing (Wyatt, 2026-11-07; no queue since
   * 2026-11-11): what each run read, what it applied, what it declined and
   * why, what failed, pages it was not allowed to open, own pages attached.
   */
  const { data: siteEvents } = await supabase.from("listing_source_events").select("listing_id, kind, status, verdict_by, detail").gte("created_at", w.start).lt("created_at", w.end).limit(5000);
  const siteByListing = new Map();
  for (const e of siteEvents ?? []) {
    const k = siteByListing.get(e.listing_id) ?? { applied: {}, denied: {} };
    if (e.status === "applied" && e.kind !== "source_attached") k.applied[e.kind] = (k.applied[e.kind] ?? 0) + 1;
    if (e.status === "rejected" && !e.verdict_by && e.detail?.autoDenied && e.detail?.op !== "none") k.denied[e.detail.autoDenied] = (k.denied[e.detail.autoDenied] ?? 0) + 1;
    siteByListing.set(e.listing_id, k);
  }
  const counted = (o, word = (k) => k.replace(/_/g, " ")) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${word(k)}`).join(", ");
  const RUN_WORD = { suppressed: "skipped, too much at once", ok: "read", changed: "changed", unchanged: "unchanged since last read" };
  const runLines = syncs.filter((j) => !j.target?.knowledge).map((j) => {
    const r = j.result ?? {};
    const ev = siteByListing.get(j.listing_id) ?? { applied: {}, denied: {} };
    if (j.status === "failed") return `${label(j.listings)}: FAILED, ${j.error ?? "unknown error"}`;
    const pagesRead = Array.isArray(r.pages) ? r.pages.filter((p) => !p.error && !p.skipped).length : 0;
    const unitPages = (r.unitPages ?? []).filter((u) => u.status !== "ok").map((u) => `${u.unit} page ${u.status}`);
    return [
      `${label(j.listings)}: ${RUN_WORD[r.status] ?? r.status ?? j.status}${r.deep ? " (deep read)" : ""}`,
      `${pagesRead} page${pagesRead === 1 ? "" : "s"} read`,
      Object.keys(ev.applied).length ? `applied ${counted(ev.applied)}` : "nothing applied",
      Object.keys(ev.denied).length ? `declined ${counted(ev.denied, (k) => `(${k})`)}` : null,
      (r.refused ?? []).length ? `${r.refused.length} off-site page${r.refused.length === 1 ? "" : "s"} not opened` : null,
      ...unitPages,
    ].filter(Boolean).join(" · ");
  });
  const { data: attachedRows } = await supabase.from("listing_source_events").select("old_value, new_value, listings!listing_id(title, address)").eq("kind", "source_attached").gte("created_at", w.start).lt("created_at", w.end).limit(200);
  const refusedAll = [...new Set(syncs.flatMap((j) => j.result?.refused ?? []))];
  sections.push({
    title: "Website sync, by listing",
    rows: [["Listings synced", runLines.length], ["Own pages attached on given sites", (attachedRows ?? []).length], ["Off-site pages the sync was not allowed to open", refusedAll.length]],
    list: [
      ...runLines,
      ...(attachedRows ?? []).map((a) => `Attached: ${label(a.listings)} now reads ${a.new_value} (was ${a.old_value})`),
      ...refusedAll.slice(0, 10).map((u) => `Not opened: ${u}`),
    ],
    note: "Only pages a landlord uploaded or gave us, and pages on those same sites, are read.",
  });

  /*
   * Sources that keep the sync from doing its job: a page with no units on
   * it (a home page, or one that blocks reading), a read that saw only part
   * of the unit list (so nothing it missed can be withdrawn), or a website
   * that failed. Fixing the URL or adding the floor plans page fixes these.
   */
  const toFix = [];
  for (const j of syncs.filter((x) => !x.target?.knowledge)) {
    const r = j.result ?? {};
    const where = `${label(j.listings)} (${j.target?.url ?? "no URL"})`;
    if (j.status === "failed") toFix.push(`${where}: could not be read`);
    else if (r.summary && r.summary.units === 0) toFix.push(`${where}: no units found on the page; it may be a home page or block reading, so point it at the floor plans or availability page`);
    else if (r.unitListComplete === false) toFix.push(`${where}: only part of the unit list was readable, so units it missed are not withdrawn`);
    else if (r.summary && r.summary.units > 0 && r.summary.priced === 0) toFix.push(`${where}: no prices on the page`);
    // A unit page that could not be read leaves its unit as it is, never withdrawn.
    for (const u of (r.unitPages ?? []).filter((x) => x.status === "failed")) {
      toFix.push(`${label(j.listings)}, ${u.unit} (${u.url}): its own page could not be read, so the unit was left as it is`);
    }
  }
  sections.push({ title: "Sources to fix", rows: [["Listings whose website keeps the sync from working fully", toFix.length]], list: toFix.slice(0, 30) });

  // Extraction accuracy: a sample to check against the source.
  const { data: pageFacts } = await supabase.from("listing_facts").select("summary, source_ref, listings!listing_id(title, address), listing_sources!source_id(kind, url)").gte("created_at", w.start).lt("created_at", w.end).eq("is_current", true).limit(400);
  const extracted = (pageFacts ?? []).filter((f) => ["page", "document"].includes(f.listing_sources?.kind));
  const sample = (arr, n) => [...arr].sort(() => Math.random() - 0.5).slice(0, n);
  const rejections = await countOf("listing_source_events", (q) => q.eq("status", "rejected").not("verdict_by", "is", null).gte("verdict_at", w.start).lt("verdict_at", w.end));
  sections.push({
    title: "Extraction accuracy",
    rows: [["Facts read from pages and documents", extracted.length], ["Website changes rejected by people", rejections]],
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
  // Units whose website stopped showing them: the sync withdrew their leases
  // (Wyatt, 2026-11-11), one line per unit.
  const { data: goneRows } = await supabase.from("listing_source_events").select("id, kind, detail, listing_id, listings!listing_id(title, address)").eq("kind", "lease_withdrawn").eq("status", "applied").contains("detail", { unitGone: true }).gte("created_at", w.start).lt("created_at", w.end).limit(500);
  const gone = [...new Map((goneRows ?? []).map((e) => [`${e.listing_id}|${e.detail?.unitId ?? e.detail?.label}`, e])).values()];
  // Units the website never showed (added by hand, another link, loaded by the team): left as they are.
  const { data: leftRows } = await supabase.from("listing_source_events").select("detail, listing_id, listings!listing_id(title, address)").eq("kind", "missing_unit").eq("status", "rejected").contains("detail", { notFromSite: true }).gte("created_at", w.start).lt("created_at", w.end).limit(500);
  sections.push({ title: "Gone from a website", rows: [["Units withdrawn because their website stopped showing them", gone.length], ["Not on the website, left as is (first noticed today)", (leftRows ?? []).length]], list: [...gone.map((e) => `${label(e.listings)}${e.detail?.label ? `: ${e.detail.label}` : ""}`), ...(leftRows ?? []).map((e) => `Not on the website, left as is: ${label(e.listings)}${e.detail?.label ? `: ${e.detail.label}` : ""}`)], note: gone.length ? `Their leases are marked unavailable, never deleted, and come back on their own if the website shows them again; ${LANDLORD_GONE_NOTICES ? "the landlord was told" : "landlord notices are paused, so the landlord was not told"}.` : "" });

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
      intro: `Your website no longer shows ${e.detail?.label ? `${e.detail.label} at ${listingLabel}` : listingLabel}, so Proximity marked it unavailable. Nothing was deleted.`,
      lines: [], note: "If it has been leased, no action is needed. If it is still available, mark it available again from your dashboard; it also comes back on its own when your website shows it again.",
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
  if (LANDLORD_GONE_NOTICES) try { landlordsTold = await notifyGone(digest.gone); } catch (err) { console.error("[agent-digest] gone notices failed:", err?.message ?? err); }
  if (email) await sendAgentDigestEmail({ to: ALERT_TO, day: digest.day, sections: digest.sections, baseUrl: digest.baseUrl });
  return { day: digest.day, sections: digest.sections.map((s) => ({ title: s.title, rows: s.rows, list: s.list })), landlordsTold };
}
