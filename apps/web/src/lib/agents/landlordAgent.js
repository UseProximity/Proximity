/*
 * The landlord's side of their listing's agent (PRD v3, milestone 7).
 *
 *   knowledgeView     everything the Agent tab shows: facts by section with
 *                     where each came from, the sources, the changes waiting
 *                     for the landlord, the change history, sync status.
 *   tellAgent         "the gym is open 24 hours": the statement goes through
 *                     Proxy's synthesis as a landlord statement (landlord-set).
 *   agentChat         a conversation with the agent that ends in a proposal:
 *                     a structured diff of displayed-field changes and facts
 *                     to save. Nothing is written until confirmProposal.
 *   confirmProposal   applies a proposal through the dashboard's write paths
 *                     (lib/agents/coreWrites.js) and the knowledge store.
 *   decideChange      approve or reject a held change (a sync's change to a
 *                     landlord-set value, or a proposed displayed-field change
 *                     from a URL added to a live listing).
 *   revertEvent       put a fact or a displayed field back to what it was.
 *
 * Every write is checked against ownership: the primary owner changes
 * property-level things, every owner their own leases, and a request in
 * plain language cannot widen that. An owner who claimed the listing in the
 * last 14 days, or a change that trips the fair-housing screen, goes to
 * admin instead of being applied. (The 14-day new-owner hold was dropped
 * on 2026-10-27; only the fair-housing screen holds a change now.)
 */
import supabase from "@/lib/supabase";
import { isPropertyOwner, canManageLease } from "@/lib/listings/ownership";
import { applyEvents, rejectEvents } from "@/lib/sourceImport/apply";
import { runTools, SONNET } from "./model";
import { buildProxyContext } from "./context";
import { currentFacts, listSources, factHistory, setFact, recordEvent, findOrCreateSource } from "./store";
import { synthesizeKnowledge } from "./synthesize";
import { applyCoreChange, LEASE_FIELDS, UNIT_FIELDS, PROPERTY_FIELDS } from "./coreWrites";
import { fairHousingFlags } from "./compliance";
import { agentSyncStatus } from "./sync";
import { shortDate, UNCLAIMED_OWNER_ID } from "./sections";

/* ---- what the landlord sees ------------------------------------------- */

function sourceLabel(s) {
  if (!s) return "Listing data on Proximity";
  switch (s.kind) {
    case "site_data": return "Listing data on Proximity";
    case "page": return s.url ? `Website: ${s.url.replace(/^https?:\/\//, "").slice(0, 80)}` : "A web page";
    case "document": return `Document: ${s.label ?? "upload"}`;
    case "landlord_statement": return "You told the agent";
    case "landlord_answer": return `Your answer: ${(s.label ?? "").replace(/^Answer to: /, "")}`;
    case "pms": return "Property management system";
    case "admin": return `Proximity team: ${s.label ?? "curation"}`;
    case "chat_backfill": return "An earlier conversation";
    case "description": return "Your listing description";
    case "landlord_edit": return s.label ?? "Updated by you";
    default: return s.label ?? s.kind;
  }
}

export async function knowledgeView({ listingId, userId, isAdmin = false }) {
  const [ctx, facts, sources, history, sync] = await Promise.all([
    buildProxyContext(listingId), currentFacts(listingId), listSources(listingId), factHistory(listingId, { limit: 60 }), agentSyncStatus(listingId),
  ]);
  const owner = isAdmin || (await isPropertyOwner(userId, listingId));
  const srcById = new Map(sources.map((s) => [s.id, s]));
  const leaseById = new Map((ctx?.leases ?? []).map((l) => [l.id, l]));
  const myLeases = new Set((ctx?.leases ?? []).filter((l) => l.ownerId === userId).map((l) => l.id));
  const owners = new Map((ctx?.leases ?? []).map((l) => [l.ownerKey, l.ownerLabel]));
  owners.set(UNCLAIMED_OWNER_ID, "Unclaimed leases");

  const scopeLabel = (f) => {
    if (f.scope_level === "property") return null;
    if (f.scope_level === "lease") return leaseById.get(f.scope_id)?.label ?? "a lease";
    if (f.scope_level === "unit") return (ctx?.leases ?? []).find((l) => l.unitId === f.scope_id)?.unitName ?? "a unit";
    if (f.scope_level === "owner") return owners.get(f.scope_id) ?? "another owner";
    return null;
  };
  // Other owners' lease details are never shown (PRD: permissions).
  const visible = (f) => owner || isAdmin || f.scope_level !== "lease" || myLeases.has(f.scope_id);
  const sections = { fees: [], policies: [], specials: [], misc: [], core: [] };
  for (const f of facts) {
    if (!visible(f)) continue;
    const s = srcById.get(f.source_id);
    sections[f.section]?.push({
      id: f.id, key: f.field_key, summary: f.summary, value: f.value, scope: { level: f.scope_level, label: scopeLabel(f) },
      source: sourceLabel(s), sourceKind: s?.kind ?? "site_data", sourceUrl: s?.url ?? null, stale: s?.last_status === "stale",
      landlordSet: f.landlord_set, confidence: f.confidence, updatedAt: f.observed_at, validUntil: f.valid_until,
      // Who may edit or delete it: the property owner, or the owner of the lease it is about.
      canEdit: owner || isAdmin || (f.scope_level === "lease" && myLeases.has(f.scope_id)) || (f.scope_level === "owner" && f.scope_id === userId),
    });
  }

  // Changes waiting on the landlord: held fact changes and open source events.
  const { data: heldFacts } = await supabase.from("listing_fact_events").select("*").eq("listing_id", listingId).in("status", ["held", "proposed"]).order("created_at", { ascending: false }).limit(100);
  const { data: openEvents } = await supabase.from("listing_source_events").select("id, kind, unit_key, field, old_value, new_value, confidence, detail, created_at").eq("listing_id", listingId).eq("status", "open").order("created_at", { ascending: false }).limit(100);
  const held = [
    ...(heldFacts ?? []).filter((e) => !e.detail?.adminReview || isAdmin).map((e) => ({
      kind: "fact", id: e.id, status: e.status, title: e.detail?.summary ?? e.field_key ?? "A fact", current: e.detail?.oldSummary ?? null, cause: e.cause, createdAt: e.created_at,
      section: e.section, key: e.field_key, forAdmin: !!e.detail?.adminReview,
    })),
    ...(openEvents ?? []).filter((e) => e.detail?.op !== "none" && !["churn_hold", "low_confidence"].includes(e.kind)).map((e) => ({
      kind: "source", id: e.id, status: "proposed", title: describeSourceEvent(e), current: e.old_value != null && e.kind !== "unit_new" ? plain(e.old_value) : null, proposed: e.new_value != null ? plain(e.new_value) : null,
      cause: "sync", createdAt: e.created_at, unit: e.detail?.label ?? null,
    })),
  ];

  const { count: openQuestions } = await supabase.from("listing_questions").select("id", { count: "exact", head: true }).eq("listing_id", listingId).eq("status", "open");

  return {
    listingId, title: ctx?.title ?? null, owner, sections, sources: sources.map((s) => ({ id: s.id, kind: s.kind, label: sourceLabel(s), url: s.url, status: s.last_status, lastCheckedAt: s.last_checked_at })),
    held, history: history.filter((e) => e.status === "applied" || e.status === "reverted").map((e) => ({
      id: e.id, cause: e.cause, status: e.status, section: e.section, key: e.field_key, summary: e.detail?.summary ?? null, oldSummary: e.detail?.oldSummary ?? null, core: !!e.detail?.core, createdAt: e.created_at, canRevert: e.status === "applied" && (!!e.previous_fact_id || !!e.detail?.core),
    })),
    sync, openQuestions: openQuestions ?? 0, leases: (ctx?.leases ?? []).map((l) => ({ id: l.id, index: l.index, label: l.label, owner: l.ownerLabel, mine: l.ownerId === userId })),
  };
}

const FIELD_WORDS = { rent: "rent", rentIsPerPerson: "rent per person", leaseTermMonths: "lease lengths", availableFrom: "available from", apartments: "apartments", name: "name", bedrooms: "bedrooms", bathrooms: "bathrooms", area: "square feet", floorPlanImageUrl: "floor plan", unavailable: "withdrawn", offers: "leases" };
const plain = (v, key = null) => {
  if (v == null || v === "") return "not set";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "none";
  if (typeof v === "object") return Object.entries(v).map(([k, x]) => `${FIELD_WORDS[k] ?? k.replace(/_/g, " ")}: ${plain(x, k)}`).join("; ");
  if (typeof v === "number" && key === "rent") return `$${v.toLocaleString("en-US")}`;
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
};
export function describeValue(v) { return plain(v); }

function describeSourceEvent(e) {
  const where = e.detail?.label ? `${e.detail.label}: ` : "";
  switch (e.kind) {
    case "rent_change": return `${where}the website now shows rent of $${Number(e.new_value?.rent ?? 0).toLocaleString("en-US")}${e.old_value?.rent != null ? ` (you have $${Number(e.old_value.rent).toLocaleString("en-US")})` : ""}`;
    case "lease_new": return `${where}the website offers a lease at $${Number(e.new_value?.rent ?? 0).toLocaleString("en-US")} that is not on Proximity`;
    case "lease_withdrawn": return `${where}the website no longer offers the $${Number(e.detail?.rent ?? 0).toLocaleString("en-US")} lease`;
    case "lease_updated": return `${where}the website shows different ${(e.field ?? "lease").split(",").map((f) => FIELD_WORDS[f] ?? f).join(", ")}`;
    case "unit_relisted": return `${where}back on the website`;
    case "unit_new": return `${where}a floor plan on the website that is not on Proximity`;
    case "unit_updated": return `${where}details the website fills in (${plain(e.new_value)})`;
    case "spec_mismatch": return `${where}the website says ${plain(e.new_value)}`;
    case "missing_unit": return `${where}no longer on the website`;
    case "property_updated": return "property details from the website";
    case "photos_added": return `${where}${e.new_value} photo${e.new_value === 1 ? "" : "s"} from the website`;
    default: return `${where}${e.kind.replace(/_/g, " ")}`;
  }
}

/* ---- tell the agent ------------------------------------------------- */

export async function tellAgent({ listingId, userId, isAdmin = false, text }) {
  const body = String(text ?? "").trim().slice(0, 4000);
  if (!body) return { error: "Say something first." };
  const flags = fairHousingFlags(body);
  // No new-owner hold on agent edits (Wyatt, 2026-10-27); the fair-housing screen stays.
  const recent = false;
  if (flags.length || recent) {
    await recordEvent({ listingId, cause: "landlord_chat", status: "proposed", newValue: { text: body }, actorId: userId, detail: { adminReview: true, summary: body.slice(0, 200), flags, recentClaim: recent } });
    return { held: true, reason: flags.length ? `This mentions ${flags.join(", ")}, which fair-housing law restricts. The Proximity team will review it.` : "Your account is new, so changes are reviewed by the Proximity team for the first two weeks." };
  }
  const owner = isAdmin || (await isPropertyOwner(userId, listingId));
  const source = await findOrCreateSource({ listingId, kind: "landlord_statement", userId, label: body.slice(0, 120) });
  const synthesis = await synthesizeKnowledge({
    listingId, text: body, sourceKind: "landlord_statement", sourceId: source.id, sourceRef: `statement:${source.id}`,
    cause: "landlord_chat", landlordSet: true, setBy: userId, actorId: userId, ownerDefault: owner ? null : userId,
  });
  return { synthesis: { written: synthesis.written, unchanged: synthesis.unchanged, retired: synthesis.retired, notes: synthesis.notes, ops: synthesis.ops }, coreChanges: synthesis.coreChanges ?? [] };
}

/* ---- the conversation ------------------------------------------------- */

const CHAT_SYSTEM = `You are the agent for one rental listing on Proximity, talking to the landlord who owns it (or one of its owners). You keep the listing's knowledge base, which Proxy uses to answer students, and you can change the listing's displayed fields for them: a lease's rent, availability date, lease lengths, furnished, or taking it off the market; a unit's beds, baths, square feet or name; the property's description, furnished, subletting allowed.

You never guess. When a request is ambiguous (which floor plan, which lease), ask. When you understand it, call propose with exactly what you would change: every displayed-field change as a core_change naming the lease by number or the unit by name, and every piece of knowledge as a fact. The landlord sees the diff and confirms before anything is saved. Changes apply now; you cannot schedule one for a later date, so if asked to change something "from August", say that it will change now and offer to be reminded instead.

You answer questions about the listing from the data below, and you are candid about what the knowledge base lacks. Keep replies short. Never use an em dash.

You talk only with the landlord; students never see this conversation. Students' questions reach the landlord in the same chat, and the landlord's answers to them, or questions back to a student, are passed to that student separately, not to you. If a message looks meant for a student (it asks about a student's own situation, belongings or plans, like "what kind of charger is it?", or it answers a student's question), do not treat it as a change to the listing: say it looks like it was meant for the student, and that tapping Reply under their question sends it to them.`;

const CHAT_TOOLS = [
  {
    name: "propose",
    description: "What you would change, for the landlord to confirm. Call it once with everything, or with nothing when there is nothing to change.",
    input_schema: {
      type: "object",
      properties: {
        reply: { type: "string", description: "What you say to the landlord: a short summary of the changes, or a question if you need one answered." },
        core_changes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              target: { type: "string", enum: ["lease", "unit", "property"] },
              ref: { type: "string", description: "Lease number ('3'), unit name, or 'property'." },
              field: { type: "string", description: "rent, available_from (YYYY-MM-DD), lease_term_months (comma list), furnished, unavailable, rent_is_per_person; bedrooms, bathrooms, area, name; description, sublease_friendly." },
              value: { type: "string" },
            },
            required: ["target", "ref", "field", "value"],
          },
        },
        facts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              section: { type: "string", enum: ["fees", "policies", "specials", "misc"] },
              key: { type: "string", description: "Short dotted key, reusing an existing one for the same thing." },
              scope: { type: "string", description: "'property', 'lease:<n>', 'unit:<name>' or 'owner:<label>'." },
              summary: { type: "string", description: "One sentence a student may be shown." },
              value_json: { type: "string" },
              valid_until: { type: "string", description: "YYYY-MM-DD or empty." },
            },
            required: ["section", "key", "scope", "summary", "value_json", "valid_until"],
          },
        },
        retire_keys: { type: "array", items: { type: "string" }, description: "Knowledge keys that are no longer true." },
      },
      required: ["reply", "core_changes", "facts", "retire_keys"],
    },
  },
];

function resolveRef({ target, ref }, ctx) {
  const r = String(ref ?? "").trim();
  if (target === "lease") {
    const lease = ctx.leases.find((l) => String(l.index) === r || l.id === r || l.label.toLowerCase() === r.toLowerCase());
    return lease ? { id: lease.id, label: lease.label } : null;
  }
  if (target === "unit") {
    const lease = ctx.leases.find((l) => l.unitName.toLowerCase() === r.toLowerCase() || l.unitId === r);
    return lease ? { id: lease.unitId, label: lease.unitName } : null;
  }
  return { id: null, label: "the property" };
}

export async function agentChat({ listingId, userId, isAdmin = false, message, history = [] }) {
  if (!String(message ?? "").trim()) return { error: "Say something first." };
  const ctx = await buildProxyContext(listingId);
  if (!ctx) return { error: "Listing not found" };
  const facts = await currentFacts(listingId);
  const owner = isAdmin || (await isPropertyOwner(userId, listingId));
  const mine = ctx.leases.filter((l) => isAdmin || l.ownerId === userId).map((l) => l.index);
  const index = facts.filter((f) => f.section !== "core").map((f) => `- [${f.section}] ${f.field_key}${f.scope_level !== "property" ? ` (${f.scope_level})` : ""}: ${f.summary}`).join("\n") || "(empty)";
  const system = `${CHAT_SYSTEM}\n\n=== THE LANDLORD ===\n${owner ? "The property owner: may change property-level things and their own leases." : "Owns leases here but not the property: may change only their own leases, and property-level knowledge is read-only for them."}\nTheir leases: ${mine.length ? mine.map((i) => `lease ${i}`).join(", ") : "none"}.\nToday is ${shortDate(new Date())}.\n\n=== LISTING ===\n${ctx.text}\n\n=== KNOWLEDGE KEYS ===\n${index}`;
  const convo = [...history.slice(-12).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content ?? "").slice(0, 4000) })), { role: "user", content: String(message ?? "").slice(0, 4000) }];
  while (convo.length && convo[0].role !== "user") convo.shift();

  const result = await runTools({ model: SONNET, system, tools: CHAT_TOOLS, handlers: {}, messages: convo, maxRounds: 2, maxTokens: 1200, tag: "landlord-chat", listingId, kind: "landlord_chat", finalTool: "propose" });
  const p = result.final ?? { reply: result.text || "Sorry, I didn't catch that.", core_changes: [], facts: [], retire_keys: [] };

  // Resolve and check every proposed change now, so the diff the landlord
  // confirms is exactly what will be written.
  const coreChanges = [];
  for (const c of p.core_changes ?? []) {
    const spec = (c.target === "lease" ? LEASE_FIELDS : c.target === "unit" ? UNIT_FIELDS : PROPERTY_FIELDS)[c.field];
    const ref = resolveRef(c, ctx);
    if (!spec || !ref) { coreChanges.push({ ...c, error: `I could not match ${c.ref} or the field ${c.field}.` }); continue; }
    let allowed = true;
    if (c.target === "lease" && !isAdmin) allowed = (await canManageLease(userId, ref.id))?.ok === true;
    if (c.target !== "lease" && !owner) allowed = false;
    coreChanges.push({ target: c.target, id: ref.id, refLabel: ref.label, field: c.field, fieldLabel: spec.label, value: c.value, allowed, error: allowed ? null : "You cannot change this; only the property owner can." });
  }
  const factsOut = (p.facts ?? []).map((f) => ({ ...f, allowed: owner || /^(lease:|owner:)/i.test(f.scope ?? "") }));
  return { reply: p.reply, proposal: { coreChanges, facts: factsOut, retireKeys: p.retire_keys ?? [] }, hasChanges: coreChanges.length + factsOut.length + (p.retire_keys ?? []).length > 0 };
}

export async function confirmProposal({ listingId, userId, isAdmin = false, proposal }) {
  const ctx = await buildProxyContext(listingId);
  // No new-owner hold on agent edits (Wyatt, 2026-10-27); the fair-housing screen stays.
  const recent = false;
  const text = [...(proposal?.facts ?? []).map((f) => f.summary), ...(proposal?.coreChanges ?? []).map((c) => String(c.value))].join("\n");
  const flags = fairHousingFlags(text);
  const results = { applied: [], held: [], errors: [] };
  if (flags.length || recent) {
    await recordEvent({ listingId, cause: "landlord_chat", status: "proposed", newValue: proposal, actorId: userId, detail: { adminReview: true, summary: `${(proposal?.coreChanges ?? []).length + (proposal?.facts ?? []).length} proposed change(s)`, flags, recentClaim: recent } });
    results.held.push(flags.length ? `Mentions ${flags.join(", ")}: sent to the Proximity team to review.` : "Your account is new, so this goes to the Proximity team for the first two weeks.");
    return results;
  }
  for (const c of proposal?.coreChanges ?? []) {
    if (c.allowed === false || c.error) { results.errors.push(c.error ?? "not allowed"); continue; }
    const r = await applyCoreChange({ listingId, userId, isAdmin, change: { target: c.target, id: c.id, field: c.field, value: c.value } });
    if (r.error) results.errors.push(r.error); else results.applied.push(r.label);
  }
  const owner = isAdmin || (await isPropertyOwner(userId, listingId));
  const source = (proposal?.facts ?? []).length || (proposal?.retireKeys ?? []).length
    ? await findOrCreateSource({ listingId, kind: "landlord_statement", userId, label: `Agent chat ${shortDate(new Date())}` })
    : null;
  for (const f of proposal?.facts ?? []) {
    if (f.allowed === false) { results.errors.push(`Only the property owner can set ${f.key}.`); continue; }
    try {
      const scope = resolveScope(f.scope, ctx, owner ? null : userId);
      const r = await setFact({
        listingId, section: f.section, fieldKey: String(f.key).toLowerCase().replace(/[^a-z0-9_.-]+/g, "-"), value: safeJson(f.value_json), summary: f.summary,
        scopeLevel: scope.scopeLevel, scopeId: scope.scopeId, sourceId: source.id, sourceRef: `statement:${source.id}`, landlordSet: true, setBy: userId, actorId: userId,
        cause: "landlord_chat", validUntil: f.valid_until || null,
      });
      results.applied.push(`${r.changed ? "Saved" : "Already known"}: ${f.summary}`);
    } catch (err) {
      results.errors.push(String(err?.message ?? err));
    }
  }
  const facts = await currentFacts(listingId);
  for (const key of proposal?.retireKeys ?? []) {
    const target = facts.find((f) => f.field_key === key && f.section !== "core");
    if (!target) continue;
    const { retireFact } = await import("./store");
    await retireFact({ factId: target.id, cause: "landlord_chat", actorId: userId });
    results.applied.push(`Removed: ${target.summary}`);
  }
  return results;
}

function safeJson(s) {
  try { const v = JSON.parse(s || "{}"); return v && typeof v === "object" ? v : { value: v }; } catch { return { text: String(s ?? "").slice(0, 500) }; }
}

function resolveScope(scope, ctx, ownerDefault) {
  const s = String(scope ?? "property").trim();
  const m = s.match(/^(lease|unit|owner):(.+)$/i);
  if (!m) return ownerDefault ? { scopeLevel: "owner", scopeId: ownerDefault } : { scopeLevel: "property", scopeId: null };
  const kind = m[1].toLowerCase(); const ref = m[2].trim();
  if (kind === "lease") { const l = ctx.leases.find((x) => String(x.index) === ref || x.id === ref); return l ? { scopeLevel: "lease", scopeId: l.id } : { scopeLevel: "property", scopeId: null }; }
  if (kind === "unit") { const l = ctx.leases.find((x) => x.unitName.toLowerCase() === ref.toLowerCase()); return l ? { scopeLevel: "unit", scopeId: l.unitId } : { scopeLevel: "property", scopeId: null }; }
  const l = ctx.leases.find((x) => x.ownerLabel.toLowerCase() === ref.toLowerCase());
  return l ? { scopeLevel: "owner", scopeId: l.ownerKey } : { scopeLevel: "property", scopeId: null };
}

/* ---- held changes ----------------------------------------------------- */

export async function decideChange({ listingId, userId, isAdmin = false, kind, eventId, decision }) {
  const approve = decision === "approve";
  if (kind === "source") {
    const { data: e } = await supabase.from("listing_source_events").select("id, listing_id, detail, status").eq("id", eventId).maybeSingle();
    if (!e || e.listing_id !== listingId) return { error: "Change not found" };
    if (e.status !== "open") return { error: "Already decided" };
    const leaseId = e.detail?.leaseId ?? null;
    if (!isAdmin) {
      const ok = leaseId ? (await canManageLease(userId, leaseId))?.ok : await isPropertyOwner(userId, listingId);
      if (!ok) return { error: "You cannot decide this change." };
    }
    if (approve) {
      const r = await applyEvents({ listingId, eventIds: [eventId], userId, verdictBy: userId });
      return { ok: true, result: r[0] ?? null };
    }
    await rejectEvents({ listingId, eventIds: [eventId], verdictBy: userId });
    return { ok: true };
  }
  const { data: e } = await supabase.from("listing_fact_events").select("*").eq("id", eventId).maybeSingle();
  if (!e || e.listing_id !== listingId) return { error: "Change not found" };
  if (!["held", "proposed"].includes(e.status)) return { error: "Already decided" };
  if (e.detail?.adminReview && !isAdmin) return { error: "This one is for the Proximity team." };
  if (!isAdmin) {
    const ok = e.scope_level === "lease" ? (await canManageLease(userId, e.scope_id))?.ok : await isPropertyOwner(userId, listingId);
    if (!ok) return { error: "You cannot decide this change." };
  }
  const now = new Date().toISOString();
  if (!approve) {
    await supabase.from("listing_fact_events").update({ status: "rejected", decided_by: userId, decided_at: now }).eq("id", eventId);
    return { ok: true };
  }
  if (e.detail?.adminReview && e.new_value?.coreChanges) {
    // A whole proposal held for admin: apply it as the landlord who made it.
    const r = await confirmProposal({ listingId, userId: e.actor_id ?? userId, isAdmin: true, proposal: e.new_value });
    await supabase.from("listing_fact_events").update({ status: "approved", decided_by: userId, decided_at: now }).eq("id", eventId);
    return { ok: true, result: r };
  }
  if (e.detail?.adminReview && e.new_value?.text) {
    const r = await tellAgent({ listingId, userId: e.actor_id ?? userId, isAdmin: true, text: e.new_value.text });
    await supabase.from("listing_fact_events").update({ status: "approved", decided_by: userId, decided_at: now }).eq("id", eventId);
    return { ok: true, result: r };
  }
  if (e.section && e.field_key) {
    const r = await setFact({
      listingId, section: e.section, fieldKey: e.field_key, value: e.new_value ?? {}, summary: e.detail?.summary ?? e.field_key, scopeLevel: e.scope_level ?? "property", scopeId: e.scope_id,
      sourceId: e.source_id, sourceRef: e.detail?.sourceRef ?? null, excerpt: e.detail?.excerpt ?? null, confidence: e.detail?.confidence ?? "high",
      landlordSet: true, setBy: userId, actorId: userId, cause: e.cause, detail: { approvedEvent: e.id },
    });
    await supabase.from("listing_fact_events").update({ status: "approved", decided_by: userId, decided_at: now }).eq("id", eventId);
    return { ok: true, changed: r.changed };
  }
  return { error: "Nothing to apply" };
}

/* ---- history ---------------------------------------------------------- */

export async function revertEvent({ listingId, userId, isAdmin = false, eventId }) {
  const { data: e } = await supabase.from("listing_fact_events").select("*").eq("id", eventId).maybeSingle();
  if (!e || e.listing_id !== listingId) return { error: "Change not found" };
  if (e.status !== "applied") return { error: "Only an applied change can be reverted" };
  if (e.detail?.core) {
    const { target, id, field, old } = e.detail;
    const r = await applyCoreChange({ listingId, userId, isAdmin, change: { target, id, field, value: old }, cause: "revert" });
    if (r.error) return r;
    await supabase.from("listing_fact_events").update({ status: "reverted", decided_by: userId, decided_at: new Date().toISOString() }).eq("id", eventId);
    return { ok: true, label: r.label };
  }
  if (!isAdmin) {
    const ok = e.scope_level === "lease" ? (await canManageLease(userId, e.scope_id))?.ok : await isPropertyOwner(userId, listingId);
    if (!ok) return { error: "You cannot revert this change." };
  }
  if (e.previous_fact_id) {
    const { data: prev } = await supabase.from("listing_facts").select("*").eq("id", e.previous_fact_id).maybeSingle();
    if (!prev) return { error: "The earlier value is gone" };
    await setFact({
      listingId, section: prev.section, fieldKey: prev.field_key, value: prev.value, summary: prev.summary, scopeLevel: prev.scope_level, scopeId: prev.scope_id,
      sourceId: prev.source_id, sourceRef: prev.source_ref, excerpt: prev.excerpt, confidence: prev.confidence, landlordSet: true, setBy: userId, actorId: userId,
      cause: "revert", validFrom: prev.valid_from, validUntil: prev.valid_until, detail: { revertedEvent: e.id },
    });
  } else if (e.fact_id) {
    const { retireFact } = await import("./store");
    await retireFact({ factId: e.fact_id, cause: "revert", actorId: userId, detail: { revertedEvent: e.id } });
  }
  await supabase.from("listing_fact_events").update({ status: "reverted", decided_by: userId, decided_at: new Date().toISOString() }).eq("id", eventId);
  return { ok: true };
}

/*
 * Edit or delete one fact from the Agent tab's knowledge list (Wyatt,
 * 2026-10-27). An edit rewrites the fact as the landlord's, with the source
 * "Updated by you on Oct 28"; a delete retires it. Both are in the history
 * and can be reverted.
 */
export async function editFact({ listingId, userId, isAdmin = false, factId, summary }) {
  const text = String(summary ?? "").trim().slice(0, 600);
  if (!text) return { error: "Write what it should say.", status: 400 };
  const fact = await ownFact({ listingId, userId, isAdmin, factId });
  if (fact.error) return fact;
  const flags = fairHousingFlags(text);
  if (flags.length && !isAdmin) {
    await recordEvent({ listingId, cause: "landlord_edit", status: "proposed", newValue: { factId, summary: text }, actorId: userId, detail: { adminReview: true, summary: text.slice(0, 200), flags } });
    return { held: true, reason: `Mentions ${flags.join(", ")}: sent to the Proximity team to review.` };
  }
  const label = `Updated by you on ${shortDate(new Date())}`;
  const source = await findOrCreateSource({ listingId, kind: "landlord_edit", userId, label });
  const r = await setFact({
    listingId, section: fact.section, fieldKey: fact.field_key, value: { ...(fact.value ?? {}), text }, summary: text,
    scopeLevel: fact.scope_level, scopeId: fact.scope_id, sourceId: source.id, sourceRef: `edit:${source.id}`,
    landlordSet: true, setBy: userId, actorId: userId, cause: "landlord_edit", validFrom: fact.valid_from, validUntil: fact.valid_until,
  });
  return { ok: true, changed: r.changed };
}

export async function deleteFact({ listingId, userId, isAdmin = false, factId }) {
  const fact = await ownFact({ listingId, userId, isAdmin, factId });
  if (fact.error) return fact;
  const { retireFact } = await import("./store");
  await retireFact({ factId: fact.id, cause: "landlord_edit", actorId: userId, detail: { summary: `Deleted: ${fact.summary}`, oldSummary: fact.summary } });
  return { ok: true };
}

async function ownFact({ listingId, userId, isAdmin, factId }) {
  const { data: fact } = await supabase.from("listing_facts").select("*").eq("id", factId).eq("listing_id", listingId).eq("is_current", true).maybeSingle();
  if (!fact) return { error: "That fact is gone or was changed already.", status: 404 };
  if (fact.section === "core") return { error: "Change displayed details in the Listing tab or by telling the agent.", status: 400 };
  if (isAdmin) return fact;
  if (await isPropertyOwner(userId, listingId)) return fact;
  if (fact.scope_level === "lease" && (await canManageLease(userId, fact.scope_id))?.ok) return fact;
  if (fact.scope_level === "owner" && fact.scope_id === userId) return fact;
  return { error: "Only the property owner can change this.", status: 403 };
}
