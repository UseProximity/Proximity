/*
 * Who a custom agreement version applies to, seen from the admin dashboard
 * (Wyatt, 2026-11-22): what to flag about each landlord before they are added
 * or taken off, and the open copies to cancel once their version changes.
 * The assignments themselves are in agreementVersions.js.
 *
 * `db` is a service-role Supabase client and `documenso` a client from
 * documenso.js, passed in so this stays testable.
 */
import { PAPER, applyEnvelope, endDocument } from "./agreements.js";
import { getLiveVersion, isCustom } from "./agreementVersions.js";

const PENDING = ["not_sent", "sent"];
// What Documenso says about a copy that is already finished: applied, never voided.
const SETTLED = ["COMPLETED", "REJECTED", "CANCELLED"];
const missingSchema = (error) => ["PGRST205", "42P01", "42703", "PGRST200", "PGRST204"].includes(error?.code);

const nameOf = (u) => u?.name || u?.company_name || u?.email || "Landlord";

async function read(build) {
  const { data, error } = await build;
  if (missingSchema(error)) return [];
  if (error) throw error;
  return data ?? [];
}

/*
 * What to flag about each landlord, by id:
 *   name, email
 *   liveCustom    { master, amendment }: the live custom version each kind is on
 *                 ({ versionId, label }), or null
 *   signed        their signed master ({ versionId, label, custom, signedAt }), or null
 *   inProgress    an unsigned copy open in Documenso
 *   openCopies    { master, amendment }: the version ids of those copies, by kind
 *                 (cancelOpenCopies cancels one when their version of that kind changes)
 *   paperOut      a paper copy out to sign (it keeps the wording it was printed with)
 *   signer        their authorized signer ({ id, name }): they sign for this account,
 *                 so a custom version only reaches it through the signer
 *   signsFor      the accounts this landlord signs for ([{ id, name }])
 */
export async function landlordFlags(db, landlordIds) {
  const ids = [...new Set((landlordIds ?? []).filter(Boolean))];
  const out = new Map();
  if (!ids.length) return out;

  const [users, onVersions, masters, amendments, asLandlord, asPayer] = await Promise.all([
    read(db.from("users").select("id, name, email, company_name").in("id", ids)),
    read(db.from("agreement_version_landlords").select("version_id, landlord_id, kind").eq("live", true).in("landlord_id", ids)),
    read(db.from("landlord_agreements").select("id, user_id, status, provider, provider_envelope_id, version_id, signed_at").in("user_id", ids).in("status", ["signed", ...PENDING])),
    read(db.from("agreement_amendments").select("id, user_id, signer_id, status, version_id, provider_envelope_id").eq("status", "sent")),
    read(db.from("billing_payers").select("landlord_id, payer_id, signer_name").eq("status", "active").is("listing_id", null).in("landlord_id", ids)),
    read(db.from("billing_payers").select("landlord_id, payer_id").eq("status", "active").in("payer_id", ids)),
  ]);

  const versionIds = [...new Set([...onVersions.map((r) => r.version_id), ...masters.map((m) => m.version_id)].filter(Boolean))];
  const versions = versionIds.length ? await read(db.from("agreement_versions").select("id, label, audience, status").in("id", versionIds)) : [];
  const versionById = new Map(versions.map((v) => [v.id, v]));
  const payeeIds = [...new Set(asPayer.map((r) => r.landlord_id))];
  const payees = payeeIds.length ? await read(db.from("users").select("id, name, email, company_name").in("id", payeeIds)) : [];
  const userById = new Map([...users, ...payees].map((u) => [u.id, u]));

  for (const id of ids) {
    const u = userById.get(id);
    const live = (kind) => {
      // A live row on a version no longer live (after a snapshot retires everything) is not theirs.
      const r = onVersions.find((x) => x.landlord_id === id && x.kind === kind && versionById.get(x.version_id)?.status === "live");
      return r ? { versionId: r.version_id, label: versionById.get(r.version_id)?.label ?? null } : null;
    };
    const signedRow = masters.find((m) => m.user_id === id && m.status === "signed");
    const signedVersion = signedRow?.version_id ? versionById.get(signedRow.version_id) : null;
    const pending = masters.filter((m) => m.user_id === id && PENDING.includes(m.status));
    const openMasters = pending.filter((m) => m.provider !== PAPER && m.provider !== "manual");
    const openAmendments = amendments.filter((a) => (a.signer_id ?? a.user_id) === id);
    const link = asLandlord.find((r) => r.landlord_id === id);
    out.set(id, {
      id,
      name: nameOf(u),
      email: u?.email ?? null,
      liveCustom: { master: live("master"), amendment: live("amendment") },
      signed: signedRow
        ? { versionId: signedRow.version_id ?? null, label: signedVersion?.label ?? null, custom: isCustom(signedVersion), signedAt: signedRow.signed_at ?? null }
        : null,
      inProgress: openMasters.length > 0 || openAmendments.length > 0,
      openCopies: { master: openMasters.map((m) => m.version_id ?? null), amendment: openAmendments.map((a) => a.version_id ?? null) },
      paperOut: pending.some((m) => m.provider === PAPER && m.status === "sent"),
      signer: link ? { id: link.payer_id, name: link.signer_name || nameOf(userById.get(link.payer_id)) } : null,
      signsFor: asPayer.filter((r) => r.payer_id === id).map((r) => ({ id: r.landlord_id, name: nameOf(userById.get(r.landlord_id)) })),
    });
  }
  return out;
}

/*
 * Withdraw one open copy, and void its row only once Documenso has let it go.
 * The envelope is read first: a copy the landlord has just signed or declined
 * (its webhook may not have landed yet) is applied as the webhook would apply
 * it, so a signature is never thrown away. A copy out for signing is cancelled
 * and a draft deleted; when that call fails, the row stays open and the error
 * is passed on. Returns "cancelled", or what applyEnvelope did.
 */
async function withdrawCopy(db, documenso, kind, row, { now, envelopeOptions }) {
  if (row.provider_envelope_id) {
    const envelope = await documenso.getEnvelope(row.provider_envelope_id);
    if (SETTLED.includes(envelope?.status)) return applyEnvelope(db, documenso, envelope, { ...envelopeOptions, now });
    const reason = "Replaced by an updated agreement";
    // Only a draft is deleted: cancel fails on a copy signed a moment ago, where
    // discard would fall back to deleting it.
    if (envelope?.status === "DRAFT" && documenso.discard) await documenso.discard(row.provider_envelope_id, reason);
    else await documenso.cancel(row.provider_envelope_id, reason);
  }
  return (await endDocument(db, kind, row, "replaced by an updated agreement", now)) ? "cancelled" : "unchanged";
}

/*
 * These landlords' version of `kind` just changed (added to or taken off a live
 * custom version, or one went live for them): an unsigned copy they have open in
 * Documenso on another version is cancelled now, so they get the right one when
 * they next sign (Wyatt, 2026-11-22). Only copies they sign themselves: an
 * account with an authorized signer signs through the signer, whose version did
 * not change. Paper copies keep the wording they were printed with, and a copy
 * the team marked as sent by hand has nothing to cancel.
 *
 * `envelopeOptions` are applyEnvelope's options (agreementServices().options),
 * for a copy found already signed or declined. Every copy is tried; when any
 * could not be withdrawn, it stays open and this throws after the rest. Returns
 * how many were cancelled.
 */
export async function cancelOpenCopies(db, documenso, { landlordIds, kind, now = new Date(), envelopeOptions = {} }) {
  const ids = [...new Set((landlordIds ?? []).filter(Boolean))];
  let cancelled = 0;
  let failed = null;
  for (const id of ids) {
    const version = await getLiveVersion(db, { kind, landlordId: id });
    const open =
      kind === "amendment"
        ? (await read(db.from("agreement_amendments").select("id, user_id, signer_id, status, version_id, provider_envelope_id").eq("status", "sent"))).filter(
            (a) => (a.signer_id ?? a.user_id) === id
          )
        : (await read(db.from("landlord_agreements").select("id, user_id, status, provider, version_id, provider_envelope_id").eq("user_id", id).in("status", PENDING))).filter(
            (m) => m.provider !== PAPER && m.provider !== "manual"
          );
    for (const row of open) {
      if (version && row.version_id === version.id) continue;
      try {
        if ((await withdrawCopy(db, documenso, kind, row, { now, envelopeOptions })) === "cancelled") cancelled += 1;
      } catch (err) {
        failed ??= err;
      }
    }
  }
  if (failed) throw failed;
  return cancelled;
}
