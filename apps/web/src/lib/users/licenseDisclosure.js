/*
 * Real estate license disclosure (MREC compliance, 2026-11-04).
 *
 * Before a landlord signs the commission agreement (or an Exhibit A amendment)
 * they either confirm they are not a licensed real estate agent or broker, or
 * they give the licensee's name, company, company phone and Missouri license
 * number and confirm they hold a listing agreement with each owner. Missouri
 * requires the licensee's name, company and company phone on all marketing, so
 * those three appear on every listing the landlord offers ("Listed by").
 *
 * The license number is for our records only: it never leaves the server except
 * to the landlord themselves and to admins.
 *
 * Tables (server-side only): landlord_license_disclosures holds the current
 * answer, landlord_license_disclosure_history every save and every confirmation
 * given right before signing.
 */
import { BillingError } from "../billing/errors.js";

const TABLE = "landlord_license_disclosures";
const HISTORY = "landlord_license_disclosure_history";
const FIELDS = "is_licensee, agent_name, company_name, company_phone, license_number, owner_agreement_confirmed, confirmed_at, updated_at";

const LIMITS = { agentName: 120, companyName: 160, licenseNumber: 40 };

function fail(message) {
  throw new BillingError("license_disclosure_invalid", message);
}

function text(value, max, label) {
  const v = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!v) fail(`Enter the ${label}.`);
  if (v.length > max) fail(`The ${label} is too long.`);
  return v;
}

/**
 * A US phone number as (314) 555-0123, or null when it is not 10 digits (an
 * optional leading 1 is dropped).
 */
export function formatUsPhone(value) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * Checks what the landlord sent and returns the row to store. Throws a
 * BillingError with a message fit to show them.
 *
 * Input (camelCase, from the browser):
 *   { isLicensee: false, notLicensedConfirmed: true }
 *   { isLicensee: true, agentName, companyName, companyPhone, licenseNumber, ownerAgreementConfirmed: true }
 */
export function cleanDisclosure(input) {
  if (!input || typeof input !== "object") {
    throw new BillingError(
      "license_disclosure_required",
      "Tell us whether you are a licensed real estate agent or broker before signing."
    );
  }
  if (input.isLicensee === false) {
    if (input.notLicensedConfirmed !== true) fail("Confirm that you are not a licensed real estate agent or broker.");
    return {
      is_licensee: false,
      agent_name: null,
      company_name: null,
      company_phone: null,
      license_number: null,
      owner_agreement_confirmed: false,
    };
  }
  if (input.isLicensee !== true) {
    throw new BillingError(
      "license_disclosure_required",
      "Tell us whether you are a licensed real estate agent or broker before signing."
    );
  }
  const agent_name = text(input.agentName, LIMITS.agentName, "licensed agent's name");
  const company_name = text(input.companyName, LIMITS.companyName, "company name");
  const company_phone = formatUsPhone(input.companyPhone);
  if (!company_phone) fail("Enter the company phone as a 10 digit US number.");
  const license_number = text(input.licenseNumber, LIMITS.licenseNumber, "Missouri license number");
  if (input.ownerAgreementConfirmed !== true) {
    fail("Confirm that you have a written listing agreement with the owner of each property you list.");
  }
  return { is_licensee: true, agent_name, company_name, company_phone, license_number, owner_agreement_confirmed: true };
}

/** The landlord-facing (and admin) shape, or null when they have not answered yet. */
export function toDisclosure(row) {
  if (!row) return null;
  return {
    isLicensee: row.is_licensee,
    agentName: row.agent_name ?? null,
    companyName: row.company_name ?? null,
    companyPhone: row.company_phone ?? null,
    licenseNumber: row.license_number ?? null,
    ownerAgreementConfirmed: !!row.owner_agreement_confirmed,
    confirmedAt: row.confirmed_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

/** The only shape allowed onto a public listing payload. Never the license number. */
export function toListedBy(row) {
  if (!row?.is_licensee) return null;
  return { agentName: row.agent_name, companyName: row.company_name, companyPhone: row.company_phone };
}

export async function getDisclosure(db, userId) {
  const { data, error } = await db.from(TABLE).select(FIELDS).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return toDisclosure(data);
}

/**
 * Stores a cleaned answer as the current one and adds it to the history.
 * `source` is 'signing' (the step right before the agreement opens) or 'profile'.
 */
export async function saveDisclosure(db, userId, clean, { source, now = new Date() }) {
  const at = now.toISOString();
  const { data, error } = await db
    .from(TABLE)
    .upsert({ user_id: userId, ...clean, confirmed_at: at }, { onConflict: "user_id" })
    .select(FIELDS)
    .single();
  if (error) throw error;
  const { error: histErr } = await db.from(HISTORY).insert({ user_id: userId, ...clean, source, created_at: at });
  if (histErr) throw histErr;
  return toDisclosure(data);
}

/** Every saved answer for one landlord, newest first (admin). */
export async function disclosureHistory(db, userId, limit = 20) {
  const { data, error } = await db
    .from(HISTORY)
    .select("is_licensee, agent_name, company_name, company_phone, license_number, source, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...toDisclosure(r), source: r.source, createdAt: r.created_at }));
}

/** Current answers for many landlords: Map userId -> disclosure (admin). */
export async function disclosuresFor(db, userIds) {
  const ids = [...new Set((userIds ?? []).filter(Boolean))];
  const out = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from(TABLE).select(`user_id, ${FIELDS}`).in("user_id", ids.slice(i, i + 200));
    if (error) throw error;
    for (const r of data ?? []) out.set(r.user_id, toDisclosure(r));
  }
  return out;
}

/**
 * "Listed by" details for the licensees among `userIds`: Map userId -> listedBy.
 * Landlords who are not licensees, or have not answered, are absent.
 */
export async function listedByFor(db, userIds) {
  const ids = [...new Set((userIds ?? []).filter(Boolean))];
  const out = new Map();
  if (!ids.length) return out;
  const { data, error } = await db
    .from(TABLE)
    .select("user_id, is_licensee, agent_name, company_name, company_phone")
    .in("user_id", ids)
    .eq("is_licensee", true);
  if (error) throw error;
  for (const r of data ?? []) out.set(r.user_id, toListedBy(r));
  return out;
}

/*
 * Whose "Listed by" a landlord's offering on a listing shows (Wyatt, 2026-11-10):
 * whoever signed the agreement covering it. When the landlord's authorized signer
 * (Project B) signed for this listing, the signer's details show, falling back to
 * the landlord's own when the signer is not a licensee. A listing the signer has
 * not covered yet (still waiting, or the signer was revoked) shows the landlord's.
 *
 * `signerOf`: Map landlordId -> the signer's id, only for landlords whose
 * listing is covered by that signer's agreement. `listed`: Map userId -> listedBy
 * for the licensees among the landlords and signers.
 */
export function pickListedBy(landlordIds, signerOf, listed) {
  const out = new Map();
  for (const id of new Set((landlordIds ?? []).filter(Boolean))) {
    const signer = signerOf.get(id);
    const pick = (signer && listed.get(signer)) || listed.get(id) || null;
    if (pick) out.set(id, pick);
  }
  return out;
}

const missingSchema = (error) => ["PGRST205", "42P01", "42703", "PGRST200", "PGRST204"].includes(error?.code);

/*
 * For one listing: the landlords among `landlordIds` whose offering there is
 * covered by their authorized signer's signed agreement. Map landlordId -> signerId.
 */
async function coveringSigners(db, listingId, landlordIds) {
  const out = new Map();
  if (!listingId || !landlordIds.length) return out;
  const { data: links, error } = await db
    .from("billing_payers")
    .select("landlord_id, payer_id")
    .in("landlord_id", landlordIds)
    .is("listing_id", null)
    .eq("status", "active");
  if (missingSchema(error)) return out;
  if (error) throw error;
  if (!links?.length) return out;
  const payerOf = new Map(links.map((l) => [l.landlord_id, l.payer_id]));
  const { data: rows, error: covErr } = await db
    .from("agreement_coverage")
    .select("user_id, agreement_id")
    .eq("listing_id", listingId)
    .in("user_id", [...payerOf.keys()])
    .eq("status", "covered");
  if (missingSchema(covErr)) return out;
  if (covErr) throw covErr;
  if (!rows?.length) return out;
  // Only coverage under the signer's own signed master counts as theirs.
  const { data: masters, error: mErr } = await db
    .from("landlord_agreements")
    .select("id, user_id")
    .in("id", [...new Set(rows.map((r) => r.agreement_id).filter(Boolean))])
    .eq("status", "signed");
  if (mErr) throw mErr;
  const holderOf = new Map((masters ?? []).map((m) => [m.id, m.user_id]));
  for (const r of rows) {
    const signer = payerOf.get(r.user_id);
    if (signer && holderOf.get(r.agreement_id) === signer) out.set(r.user_id, signer);
  }
  return out;
}

/**
 * "Listed by" for each landlord offering on one listing: Map landlordId -> listedBy,
 * following pickListedBy. Landlords with nothing to show are absent.
 */
export async function listedByForListing(db, listingId, landlordIds) {
  const ids = [...new Set((landlordIds ?? []).filter(Boolean))];
  if (!ids.length) return new Map();
  const signerOf = await coveringSigners(db, listingId, ids);
  const listed = await listedByFor(db, [...ids, ...signerOf.values()]);
  return pickListedBy(ids, signerOf, listed);
}
