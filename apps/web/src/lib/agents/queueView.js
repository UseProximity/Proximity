/*
 * What the admin review queue shows for each held knowledge change (Wyatt,
 * 2026-11-12): who it came from, the message they sent, and each change as
 * what Proximity says now next to what it would say.
 *
 * A held change is a listing_fact_events row in one of three shapes:
 *   a landlord's statement   new_value { text }: the message is the change
 *   a landlord's proposal    new_value { facts, coreChanges, retireKeys }: the
 *                            diff their agent drew up from the conversation
 *   one fact                 field_key plus detail.summary / detail.oldSummary
 *                            (a website sync, a document, a new owner's edit)
 */
import supabase from "@/lib/supabase";

const TEST_EMAIL = /@proximity\.test$/i;

// "misc.floor-plan-pricing" -> "Floor plan pricing"
export function factLabel(key) {
  const words = String(key ?? "").replace(/^[a-z]+\./i, "").replace(/[-_]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "Change";
}

const isProposal = (v) => v && typeof v === "object" && (Array.isArray(v.facts) || Array.isArray(v.coreChanges) || Array.isArray(v.retireKeys));

/* Map of event id -> { actor, message, changes, sourceRef, excerpt, confidence }. */
export async function describeFactEvents(events) {
  const out = new Map();
  if (!events?.length) return out;

  const actorIds = [...new Set(events.map((e) => e.actor_id).filter(Boolean))];
  const proposals = events.filter((e) => e.cause === "landlord_chat" && e.actor_id && isProposal(e.new_value));
  const proposalKeys = [...new Set(proposals.flatMap((e) => [...(e.new_value.facts ?? []).map((f) => f.key), ...(e.new_value.retireKeys ?? [])]).filter(Boolean))];

  const [{ data: actors }, { data: chat }, { data: facts }] = await Promise.all([
    actorIds.length
      ? supabase.from("users").select("id, name, email, roles!role_id(name)").in("id", actorIds)
      : { data: [] },
    // A proposal does not carry the landlord's own words; they are in the
    // conversation with their agent, just before it.
    proposals.length
      ? supabase.from("landlord_agent_messages").select("landlord_id, listing_id, body, created_at").eq("sender", "landlord")
          .in("landlord_id", [...new Set(proposals.map((e) => e.actor_id))]).in("listing_id", [...new Set(proposals.map((e) => e.listing_id))])
          .order("created_at", { ascending: false }).limit(1000)
      : { data: [] },
    proposalKeys.length
      ? supabase.from("listing_facts").select("listing_id, field_key, summary").eq("is_current", true)
          .in("listing_id", [...new Set(proposals.map((e) => e.listing_id))]).in("field_key", proposalKeys)
      : { data: [] },
  ]);

  const actorById = new Map((actors ?? []).map((u) => [u.id, u]));
  const currentFact = new Map((facts ?? []).map((f) => [`${f.listing_id}|${f.field_key}`, f.summary]));

  for (const e of events) {
    const u = e.actor_id ? actorById.get(e.actor_id) : null;
    const actor = u ? { id: u.id, name: u.name ?? null, email: u.email ?? null, role: u.roles?.name ?? null, test: TEST_EMAIL.test(u.email ?? "") } : null;
    const d = e.detail ?? {};
    let message = null;
    let changes = [];

    if (e.cause === "landlord_chat" && typeof e.new_value?.text === "string") {
      message = { text: e.new_value.text, at: e.created_at, exact: true };
    } else if (isProposal(e.new_value)) {
      const last = (chat ?? []).find((m) => m.landlord_id === e.actor_id && m.listing_id === e.listing_id && new Date(m.created_at) <= new Date(e.created_at));
      if (last) message = { text: last.body, at: last.created_at, exact: false };
      const before = (key) => currentFact.get(`${e.listing_id}|${key}`) ?? null;
      changes = [
        ...(e.new_value.coreChanges ?? []).map((c) => ({ label: [c.refLabel, c.fieldLabel ?? c.field].filter(Boolean).join(": "), before: null, beforeUnknown: true, after: c.value == null ? null : String(c.value) })),
        ...(e.new_value.facts ?? []).map((f) => ({ label: factLabel(f.key), before: before(f.key), after: f.summary ?? null })),
        ...(e.new_value.retireKeys ?? []).map((key) => ({ label: factLabel(key), before: before(key), after: null })),
      ];
    } else {
      changes = [{ label: factLabel(e.field_key), before: d.oldSummary ?? null, after: d.retire ? null : d.summary ?? null }];
    }

    out.set(e.id, { actor, message, changes, sourceRef: d.sourceRef ?? null, excerpt: d.excerpt ?? null, confidence: d.confidence ?? null });
  }
  return out;
}
