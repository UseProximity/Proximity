/*
 * The knowledge store's one write path (PRD v3, milestone 1).
 *
 * Every fact, whoever sets it (the seed, a sync, a landlord talking to their
 * agent, a landlord's answer to a student, a dashboard edit, an admin, a
 * document, the chat backfill), goes through setFact, which:
 *
 *   - keeps one current row per field key and scope, retiring the old row
 *     and linking it to the new one, so history is never lost;
 *   - does nothing when the value is unchanged, beyond refreshing the
 *     observed date (and the source, if a newer one confirms it);
 *   - never overwrites a landlord-set fact from a weaker source. The change is
 *     recorded as a held event for the landlord to approve, and the current
 *     value stays (PRD: "When sources disagree");
 *   - writes a listing_fact_events row for every change, which is the
 *     landlord's change history and the admin review queue.
 *
 * Core values (rent, beds, availability) are not stored here. They live in the
 * listing, unit and lease tables and are written through the normal paths; a
 * core fact only records provenance, so setFact on section 'core' never
 * touches a lease.
 *
 * Server-only: uses the service-role client.
 */
import supabase from "@/lib/supabase";
import { SECTIONS, SCOPES, CONFIDENCES, CAUSES, cleanText } from "./sections";

const NIL = "00000000-0000-0000-0000-000000000000";

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.keys(v).sort().reduce((o, k) => {
      if (v[k] !== undefined && v[k] !== null) o[k] = sortKeys(v[k]);
      return o;
    }, {});
  }
  return v;
}
const stable = (v) => JSON.stringify(sortKeys(v ?? {}));

const fail = (where, error) => new Error(`${where}: ${error.message}`);

/* ---- agents ------------------------------------------------------------ */

export async function ensureAgent(listingId) {
  const { data: existing, error: e1 } = await supabase
    .from("listing_agents").select("*").eq("listing_id", listingId).maybeSingle();
  if (e1) throw fail("agent lookup", e1);
  if (existing) return existing;
  const { data, error } = await supabase
    .from("listing_agents")
    .upsert({ listing_id: listingId }, { onConflict: "listing_id", ignoreDuplicates: true })
    .select("*")
    .maybeSingle();
  if (error) throw fail("agent create", error);
  if (data) return data;
  const { data: again } = await supabase.from("listing_agents").select("*").eq("listing_id", listingId).maybeSingle();
  return again;
}

export async function getAgent(listingId) {
  const { data, error } = await supabase.from("listing_agents").select("*").eq("listing_id", listingId).maybeSingle();
  if (error) throw fail("agent lookup", error);
  return data ?? null;
}

/* ---- sources ----------------------------------------------------------- */

/* The listing's own data on Proximity: the default source of everything. */
export async function ensureSiteDataSource(listingId) {
  return findOrCreateSource({ listingId, kind: "site_data", label: "Listing data on Proximity" });
}

/*
 * One row per distinct source. What makes a source distinct depends on its
 * kind: a page is its URL, a document its id, an answer its message or
 * question, a statement or admin note its label plus the user behind it.
 */
export async function findOrCreateSource({
  listingId, kind, url = null, label = null, userId = null, ownerId = null,
  documentId = null, messageId = null, questionId = null, checkIntervalDays = null,
}) {
  let q = supabase.from("listing_sources").select("*").eq("listing_id", listingId).eq("kind", kind);
  if (kind === "site_data") {
    // one per listing
  } else if (kind === "page") {
    if (!url) throw new Error("page source needs a url");
    q = q.eq("url", url);
  } else if (kind === "document") {
    if (!documentId) throw new Error("document source needs a document id");
    q = q.eq("document_id", documentId);
  } else if (messageId) {
    q = q.eq("message_id", messageId);
  } else if (questionId) {
    q = q.eq("question_id", questionId);
  } else {
    q = q.eq("label", label ?? "");
    q = userId ? q.eq("user_id", userId) : q.is("user_id", null);
    q = ownerId ? q.eq("owner_id", ownerId) : q.is("owner_id", null);
  }
  const { data: found, error: e1 } = await q.order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (e1) throw fail("source lookup", e1);
  if (found) return found;

  const row = {
    listing_id: listingId, kind, url, label: label ? cleanText(label).slice(0, 240) : null,
    user_id: userId, owner_id: ownerId, document_id: documentId, message_id: messageId,
    question_id: questionId, check_interval_days: checkIntervalDays,
  };
  const { data, error } = await supabase.from("listing_sources").insert(row).select("*").single();
  if (error) {
    // Lost a race on one of the unique indexes: read the winner.
    if (error.code === "23505") {
      const { data: again } = await q.limit(1).maybeSingle();
      if (again) return again;
    }
    throw fail("source create", error);
  }
  return data;
}

export async function listSources(listingId) {
  const { data, error } = await supabase
    .from("listing_sources").select("*").eq("listing_id", listingId).order("created_at", { ascending: true });
  if (error) throw fail("sources", error);
  return data ?? [];
}

/* ---- facts ------------------------------------------------------------- */

function scoped(q, scopeId) {
  return scopeId ? q.eq("scope_id", scopeId) : q.is("scope_id", null);
}

export async function currentFacts(listingId, { sections = null } = {}) {
  let q = supabase.from("listing_facts").select("*").eq("listing_id", listingId).eq("is_current", true);
  if (sections?.length) q = q.in("section", sections);
  const { data, error } = await q.order("section").order("field_key").order("scope_level");
  if (error) throw fail("facts", error);
  return data ?? [];
}

export async function factHistory(listingId, { limit = 200 } = {}) {
  const { data, error } = await supabase
    .from("listing_fact_events").select("*").eq("listing_id", listingId)
    .order("created_at", { ascending: false }).limit(limit);
  if (error) throw fail("fact history", error);
  return data ?? [];
}

export async function recordEvent(ev) {
  const row = {
    listing_id: ev.listingId, fact_id: ev.factId ?? null, previous_fact_id: ev.previousFactId ?? null,
    section: ev.section ?? null, field_key: ev.fieldKey ?? null, scope_level: ev.scopeLevel ?? null,
    scope_id: ev.scopeId ?? null, cause: ev.cause, status: ev.status ?? "applied",
    old_value: ev.oldValue ?? null, new_value: ev.newValue ?? null, actor_id: ev.actorId ?? null,
    source_id: ev.sourceId ?? null, detail: ev.detail ?? {},
  };
  const { data, error } = await supabase.from("listing_fact_events").insert(row).select("*").single();
  if (error) throw fail("fact event", error);
  return data;
}

/*
 * Set the current value of one fact. Returns one of:
 *   { fact, changed: false }           same value already current
 *   { fact, changed: true, event }     written (and the old row retired)
 *   { held: true, event, fact }        landlord-set value kept; change held
 */
export async function setFact(input) {
  const {
    listingId, section, fieldKey, value = {}, scopeLevel = "property", scopeId = null,
    sourceId = null, sourceRef = null, excerpt = null, confidence = "high",
    landlordSet = false, setBy = null, observedAt = null, validFrom = null, validUntil = null,
    cause, actorId = null, detail = {},
  } = input;
  const summary = cleanText(input.summary);

  if (!listingId) throw new Error("setFact: listingId required");
  if (!SECTIONS.includes(section)) throw new Error(`setFact: bad section ${section}`);
  if (!fieldKey || !/^[a-z][a-z0-9_.-]{0,118}$/.test(fieldKey)) throw new Error(`setFact: bad field key ${fieldKey}`);
  if (!SCOPES.includes(scopeLevel)) throw new Error(`setFact: bad scope ${scopeLevel}`);
  if (scopeLevel !== "property" && !scopeId) throw new Error("setFact: scoped fact needs a scope id");
  if (!CONFIDENCES.includes(confidence)) throw new Error(`setFact: bad confidence ${confidence}`);
  if (!CAUSES.includes(cause)) throw new Error(`setFact: bad cause ${cause}`);
  if (!summary) throw new Error("setFact: summary required");

  const effectiveScopeId = scopeLevel === "property" ? null : scopeId;
  const { data: existing, error: e1 } = await scoped(
    supabase.from("listing_facts").select("*").eq("listing_id", listingId).eq("section", section)
      .eq("field_key", fieldKey).eq("scope_level", scopeLevel).eq("is_current", true),
    effectiveScopeId
  ).maybeSingle();
  if (e1) throw fail("fact lookup", e1);

  const observed = observedAt ? new Date(observedAt).toISOString() : new Date().toISOString();

  if (existing) {
    const same = stable(existing.value) === stable(value) && existing.summary === summary
      && (existing.valid_until ?? null) === (validUntil ?? null);
    if (same && (existing.landlord_set || !landlordSet)) {
      // Nothing new. A later look at the same value refreshes the date and,
      // when a source is named, the source.
      const patch = {};
      if (new Date(observed) > new Date(existing.observed_at)) patch.observed_at = observed;
      if (sourceId && sourceId !== existing.source_id) {
        patch.source_id = sourceId; patch.source_ref = sourceRef; if (excerpt) patch.excerpt = excerpt;
      }
      if (Object.keys(patch).length) {
        const { data } = await supabase.from("listing_facts").update(patch).eq("id", existing.id).select("*").single();
        return { fact: data ?? existing, changed: false };
      }
      return { fact: existing, changed: false };
    }
    if (existing.landlord_set && !landlordSet) {
      // The landlord's word stands. Hold the change for them, once.
      const { data: open } = await scoped(
        supabase.from("listing_fact_events").select("id").eq("listing_id", listingId).eq("section", section)
          .eq("field_key", fieldKey).eq("scope_level", scopeLevel).eq("status", "held"),
        effectiveScopeId
      ).limit(20);
      const dup = (open ?? []).length && (await (async () => {
        const { data: rows } = await supabase.from("listing_fact_events").select("id, new_value").in("id", open.map((r) => r.id));
        return (rows ?? []).find((r) => stable(r.new_value) === stable(value));
      })());
      if (dup) return { held: true, fact: existing, event: dup, duplicate: true };
      const event = await recordEvent({
        listingId, factId: existing.id, section, fieldKey, scopeLevel, scopeId: effectiveScopeId,
        cause, status: "held", oldValue: existing.value, newValue: value, actorId, sourceId,
        detail: { ...detail, summary, excerpt, sourceRef, confidence, oldSummary: existing.summary },
      });
      return { held: true, fact: existing, event };
    }
  }

  // Retire the old row first: the unique index allows one current row.
  if (existing) {
    const { error } = await supabase.from("listing_facts").update({ is_current: false }).eq("id", existing.id);
    if (error) throw fail("fact retire", error);
  }
  const row = {
    listing_id: listingId, section, field_key: fieldKey, value, summary, scope_level: scopeLevel,
    scope_id: effectiveScopeId, source_id: sourceId, source_ref: sourceRef, excerpt: excerpt ? cleanText(excerpt).slice(0, 2000) : null,
    confidence, landlord_set: landlordSet, set_by: setBy, observed_at: observed,
    valid_from: validFrom, valid_until: validUntil, is_current: true,
  };
  const { data: fact, error: e2 } = await supabase.from("listing_facts").insert(row).select("*").single();
  if (e2) {
    if (existing) await supabase.from("listing_facts").update({ is_current: true }).eq("id", existing.id);
    throw fail("fact write", e2);
  }
  if (existing) await supabase.from("listing_facts").update({ superseded_by: fact.id }).eq("id", existing.id);

  const event = await recordEvent({
    listingId, factId: fact.id, previousFactId: existing?.id ?? null, section, fieldKey, scopeLevel,
    scopeId: effectiveScopeId, cause, status: "applied", oldValue: existing?.value ?? null, newValue: value,
    actorId, sourceId, detail: { ...detail, summary, oldSummary: existing?.summary ?? null },
  });
  return { fact, changed: true, event };
}

/* Take a fact out of the current set (a special that ended, a policy removed). */
export async function retireFact({ factId, cause, actorId = null, detail = {} }) {
  const { data: fact, error } = await supabase.from("listing_facts").select("*").eq("id", factId).maybeSingle();
  if (error) throw fail("fact lookup", error);
  if (!fact || !fact.is_current) return { fact, changed: false };
  const { error: e2 } = await supabase.from("listing_facts").update({ is_current: false }).eq("id", factId);
  if (e2) throw fail("fact retire", e2);
  const event = await recordEvent({
    listingId: fact.listing_id, previousFactId: fact.id, section: fact.section, fieldKey: fact.field_key,
    scopeLevel: fact.scope_level, scopeId: fact.scope_id, cause, status: "applied",
    oldValue: fact.value, newValue: null, actorId, detail: { ...detail, oldSummary: fact.summary },
  });
  return { fact: { ...fact, is_current: false }, changed: true, event };
}

/* ---- spend ------------------------------------------------------------- */

export async function recordUsage({ listingId = null, kind, model = null, usage = null, costCents = 0 }) {
  const row = {
    listing_id: listingId, kind, model,
    input_tokens: usage?.input_tokens ?? 0, output_tokens: usage?.output_tokens ?? 0,
    cost_cents: Number(costCents) || 0,
  };
  const { error } = await supabase.from("listing_agent_usage").insert(row);
  if (error) console.error("[agents] usage ledger:", error.message);
}
