/*
 * Jev (TypeSafe AI's decision model) through Vercel AI Gateway: yes/no and
 * pick-one questions about a block of text, answered with probabilities. The
 * ledger's read quality (sync confidence ledger, stage 2). Jev never extracts:
 * code reads the fact, Jev says how sure the text is of it.
 *
 * The model version is pinned and stored with every answer, so a newer Jev
 * never shifts scores without us choosing it.
 */

export const JEV_MODEL = "typesafe-ai/jev-1.14.0";
const URL = "https://ai-gateway.vercel.sh/v1/decisions";
// $0.042 per million input tokens (AI Gateway, 2026-11-24).
const USD_PER_INPUT_TOKEN = 0.042 / 1e6;
const TIMEOUT_MS = 20000;

export const jevOn = () => !!process.env.AI_GATEWAY_API_KEY && String(process.env.SYNC_JEV ?? "").toLowerCase() !== "false";

/*
 * One request: several questions about one text. Returns
 * { answers: { [name]: answer }, usage, costUsd, model }, or throws.
 */
export async function askJev(input, questions, { fetchImpl = fetch } = {}) {
  const key = process.env.AI_GATEWAY_API_KEY;
  if (!key) throw new Error("AI_GATEWAY_API_KEY is not set");
  const res = await fetchImpl(URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: JEV_MODEL, input: String(input ?? "").slice(0, 30000), questions }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Jev HTTP ${res.status}: ${body?.error?.message ?? "no detail"}`.slice(0, 300));
  const answers = {};
  for (const a of body.answers ?? []) if (a?.name) answers[a.name] = a;
  const tokens = Number(body.usage?.input_tokens ?? 0);
  const cost = Number(body.provider_metadata?.gateway?.cost);
  return { answers, usage: body.usage ?? null, costUsd: Number.isFinite(cost) ? cost : tokens * USD_PER_INPUT_TOKEN, model: body.model ?? JEV_MODEL };
}

const money = (n) => `$${Math.round(Number(n)).toLocaleString("en-US")}`;
const terms = (t) => (t ?? []).map((m) => `${m} month`).join(", ");

/*
 * The questions for one scored change (a listing_sync_scores row), each with
 * the answer code expects: { question, expect } where expect is
 * { kind: "predicate" } (probability of yes) or { kind: "choice", value }.
 * Names are unique per change: `<row index>.<part>`.
 */
export function questionsFor(row, idx, { unitLabel, building, address } = {}) {
  const u = unitLabel || "this unit";
  const n = row.new_value && typeof row.new_value === "object" ? row.new_value : {};
  const out = [];
  const q = (part, question, expect) => out.push({ question: { ...question, name: `${idx}.${part}` }, part, expect });
  const field = row.field;
  if (row.kind === "lease_withdrawn") {
    // Whether the page is the whole list is the reader's to say (unitListComplete);
    // Jev's answer to that tracked nothing (0.16 to 0.58 on every page, 2026-11-24).
    q("listed", { type: "predicate", instructions: `Does this text show ${u} as currently available to rent?` }, { kind: "predicate", invert: true });
    return out;
  }
  if (n.rent != null && (field === "rent" || row.action === "add")) {
    q("rent", { type: "predicate", instructions: `Does this text state that ${u} rents for ${money(n.rent)}?` }, { kind: "predicate" });
    q("rentType", { type: "choice", instructions: `Is ${money(n.rent)} the price itself, a starting-at price, or a range?`, choices: [{ value: "exact" }, { value: "starting_at" }, { value: "range" }] }, { kind: "choice", value: "exact", rough: true });
    if (n.rentIsPerPerson != null || field === "rentIsPerPerson") {
      q("basis", { type: "choice", instructions: `Is ${money(n.rent)} per person, for the whole unit, or not stated?`, choices: [{ value: "per_person" }, { value: "whole_unit" }, { value: "not_stated" }] }, { kind: "choice", value: n.rentIsPerPerson ? "per_person" : "whole_unit", rough: true });
    }
  }
  if (n.availableFrom && (field === "availableFrom" || row.action === "add")) {
    q("date", { type: "predicate", instructions: `Does this text state ${u} is available from ${n.availableFrom}?` }, { kind: "predicate", soft: row.action === "add" });
  }
  if ((n.leaseTermMonths ?? []).length && (field === "leaseTermMonths" || row.action === "add")) {
    q("terms", { type: "predicate", instructions: `Does this text state these lease lengths for ${u}: ${terms(n.leaseTermMonths)}?` }, { kind: "predicate", soft: row.action === "add" });
  }
  if (["bedrooms", "bathrooms", "area"].includes(field) || row.kind === "unit_new") {
    const parts = [n.bedrooms != null ? `${n.bedrooms} bed` : null, n.bathrooms != null ? `${n.bathrooms} bath` : null, n.area ? `${n.area} sq ft` : null].filter(Boolean);
    if (parts.length) q("specs", { type: "predicate", instructions: `Does this text describe ${u} as ${parts.join(", ")}?` }, { kind: "predicate" });
  }
  if (building && address) {
    q("building", { type: "predicate", instructions: `Is this text about ${building} at ${address}?` }, { kind: "predicate", rightThing: true });
  }
  return out;
}

/* The probability Jev gives the answer code expects. */
export function expectedProbability(answer, expect) {
  if (!answer || answer.type === "refusal") return null;
  if (expect.kind === "predicate") return Number(answer.probability);
  const p = (answer.probabilities ?? []).find((x) => x.value === expect.value)?.probability;
  return p == null ? null : Number(p);
}
