/*
 * Hourly cron: hide landlord-reported-leased listings, then email the review digest.
 * A landlord's "leased" click is therefore acted on within the hour, and the
 * digest goes out in the same run — but ONLY when something changed, so quiet
 * hours send nothing.
 *
 * Reads the check-in system's response columns (read-only — see lib/autoUnavailable.js
 * for the hard guarantees) and, for each listing the landlord reported leased that
 * students can still see:
 *   1. hides it via the audited rpc_pms_apply (whole listing for single-unit reports,
 *      per-bedroom listing_units for multi-unit reports),
 *   2. records the action with before/after state in auto_unavailable_actions,
 *   3. immediately re-reads the public listings API and records the verification
 *      outcome — a failed verification shows up loudly in the digest,
 *   4. sends one review email covering hides, verify failures, landlord corrections
 *      (leased -> available after we hid), and undo relists. Silent when empty.
 *
 * Each landlord report is actioned at most once (unique fingerprint on
 * listing_id + last_verified_at), so an undo by Ben is never re-hidden by the
 * same report, and Ben's own admin-dashboard changes are never fought.
 *
 * Modes:
 *   ?dry_run=1 (or AUTO_UNAVAILABLE_DRY_RUN=1): compute + email what WOULD happen;
 *     zero writes. Used for the pre-launch parallel run against the leasing dashboard.
 *   ?include_test=1: allow TEST- rows — ONLY for the supervised end-to-end rehearsal
 *     of the test protocol; normal runs always exclude them.
 *
 * Protected by the same CRON_SECRET bearer token as the other crons.
 */
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { getBaseUrl } from "@/lib/email";
import {
  SYSTEM_USER_ID,
  LEASED_CHOICES,
  CHOICE_LABELS,
  isTestRow,
  undoUrl,
  verifyHidden,
  sendReviewDigestEmail,
  resolveDigestRecipients,
} from "@/lib/autoUnavailable";
import {
  unitIsAvailable,
  liveLeasesOf,
  listingIsUnavailable,
} from "@/lib/listings/unitAvailability";

const fingerprint = (listingId, reportedAt) =>
  `${listingId}|${reportedAt ? new Date(reportedAt).getTime() : 0}`;

// Listings the landlord reported leased that students can still see.
// Mirrors build_actions() in the automation repo's export_leasing_snapshot.py
// so this list and the leasing dashboard's "Remove from site" panel agree.
function findCandidates(listings, { includeTest = false } = {}) {
  const candidates = [];
  for (const l of listings) {
    if (isTestRow(l) && !includeTest) continue;

    // Effective visibility mirrors buildListing() in /api/listings through the
    // one shared helper: a listing with no live offering anywhere is already
    // hidden from students even when the unavailable flag is false. Skipping
    // those keeps this list identical to the leasing dashboard's "Remove from
    // site" panel (which checks the site API), so the pre-launch dry-run
    // comparison can match exactly.
    const allUnits = l.listing_units ?? [];
    if (listingIsUnavailable(l)) continue;

    const saidLeased = LEASED_CHOICES.includes(l.checkin_response_choice);
    if (saidLeased) {
      candidates.push({
        listing: l,
        reportedChoice: l.checkin_response_choice,
        scope: { listing: true },
        units: [],
      });
      continue;
    }

    // Multi-unit: bedroom types the landlord reported gone that still show units.
    const status = l.unit_type_status ?? {};
    const goneBeds = Object.entries(status)
      .filter(([, e]) => e && typeof e === "object" && e.available === false)
      .map(([beds]) => Number(beds));
    if (!goneBeds.length) continue;
    const units = allUnits.filter(
      (u) => goneBeds.includes(Number(u.bedrooms)) && unitIsAvailable(u)
    );
    if (!units.length) continue;

    /*
     * Hiding a bedroom type now means withdrawing the offerings on it — units
     * carry no availability of their own. The lease ids are recorded in scope
     * so Undo restores exactly what this hid and nothing else.
     *
     * A targeted unit with no live offering has nothing to withdraw. It is
     * already invisible on price (no rent shows) but still countable as room
     * data, and silently passing over it is how a "hidden" listing stays up.
     * It is reported instead — verifyHidden would catch it anyway, loudly.
     */
    const withLeases = units
      .map((u) => ({ u, leaseIds: liveLeasesOf(u).map((l2) => l2.id) }))
      .filter((x) => x.leaseIds.length);
    const unhidable = units.length - withLeases.length;

    if (withLeases.length) {
      candidates.push({
        listing: l,
        reportedChoice: "unit_type_status",
        scope: {
          units: withLeases.map(({ u, leaseIds }) => ({
            id: u.id,
            bedrooms: u.bedrooms,
            leaseIds,
          })),
        },
        units: withLeases.map((x) => x.u),
        unhidable,
      });
    }
  }
  return candidates;
}

async function applyHide(candidate) {
  const { listing, scope } = candidate;
  const args = {
    p_user_id: SYSTEM_USER_ID,
    p_listing_id: listing.id,
  };
  if (scope.listing) args.p_listing_updates = { unavailable: true };
  // Unit-scoped hides withdraw the exact offerings recorded in scope. Still
  // expressed as p_unit_updates: the RPC keeps that shape and applies it to the
  // named leases, so the audited write path is unchanged.
  else args.p_unit_updates = (scope.units ?? []).map((u) => ({
    id: u.id,
    available: false,
    lease_ids: u.leaseIds ?? null,
  }));
  const { error } = await supabase.rpc("rpc_pms_apply", args);
  return error?.message ?? null;
}

async function snapshotState(listingId) {
  const { data } = await supabase
    .from("listings")
    .select(
      "id, unavailable, updated_at, listing_units(id, bedrooms, unit_leases(id, is_active, unavailable))"
    )
    .eq("id", listingId)
    .maybeSingle();
  return data ?? null;
}

export async function GET(req) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry_run") === "1" || process.env.AUTO_UNAVAILABLE_DRY_RUN === "1";
  const includeTest = url.searchParams.get("include_test") === "1";
  const baseUrl = getBaseUrl(req);

  // ---- Detect ------------------------------------------------------------
  const { data: listings, error } = await supabase
    .from("listings")
    .select(
      `id, title, address, contact_email, contact_name, unavailable,
       last_verified_at, checkin_response_choice, leased_elsewhere_detail,
       unit_type_status, listing_units(id, bedrooms, unit_leases(id, is_active, unavailable))`
    )
    .is("deleted_at", null)
    .is("pms_connection_id", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let candidates = findCandidates(listings ?? [], { includeTest });

  // Never action the same landlord report twice (covers Ben's undos and his
  // manual admin relists: only a NEW report can hide again).
  if (candidates.length) {
    const ids = candidates.map((c) => c.listing.id);
    const { data: existing } = await supabase
      .from("auto_unavailable_actions")
      .select("listing_id, reported_at")
      .in("listing_id", ids);
    const seen = new Set((existing ?? []).map((r) => fingerprint(r.listing_id, r.reported_at)));
    candidates = candidates.filter(
      (c) => !seen.has(fingerprint(c.listing.id, c.listing.last_verified_at))
    );
  }

  // ---- Apply + verify (skipped entirely in dry-run) ----------------------
  const applied = [];
  /*
   * Bedroom types the landlord reported gone that carried no live offering to
   * withdraw. Nothing is hidden for them, so they are reported rather than
   * quietly dropped — an unactioned report is exactly what this cron exists to
   * make impossible. Computed from the candidates themselves so the dry run,
   * which writes nothing, still surfaces them: that run is the pre-launch
   * comparison against the leasing dashboard, and a gap it cannot show is a gap
   * nobody finds.
   */
  const unhidableNotes = candidates
    .filter((c) => c.unhidable)
    .map((c) => ({
      title: c.listing.title || c.listing.address || c.listing.id,
      note: `${c.unhidable} reported bedroom type(s) had no live offering to withdraw, so nothing was hidden for them. Check the listing — those rooms still show as available with no price.`,
    }));
  if (!dryRun) {
    for (const c of candidates) {
      const before = await snapshotState(c.listing.id);
      const rpcError = await applyHide(c);
      const after = rpcError ? before : await snapshotState(c.listing.id);
      const verify = rpcError ? null : await verifyHidden(c.listing.id, c.scope, baseUrl);

      const { data: row, error: insertErr } = await supabase
        .from("auto_unavailable_actions")
        .insert({
          listing_id: c.listing.id,
          reported_choice: c.reportedChoice,
          reported_detail: c.listing.leased_elsewhere_detail,
          reported_at: c.listing.last_verified_at,
          scope: c.scope,
          status: rpcError ? "failed" : "applied",
          before_state: before,
          after_state: after,
          verify_result: rpcError ? `apply failed: ${rpcError}` : verify,
          verified_at: rpcError ? null : new Date().toISOString(),
        })
        .select("id")
        .single();
      if (insertErr) console.error("[auto-unavailable] action insert failed:", insertErr.message);
      applied.push({ ...c, actionId: row?.id ?? null, rpcError, verify });
    }
  }

  // ---- Build the digest from DB state (not memory) so failed runs recover ----
  const digest = { hidden: [], anomalies: [], corrections: [], undone: [] };
  const stamps = { digest: [], undo: [], correction: [] };

  const { data: actionRows } = await supabase
    .from("auto_unavailable_actions")
    .select(
      `id, listing_id, reported_choice, reported_detail, reported_at, scope, status,
       verify_result, applied_at, digest_sent_at, correction_noted_at,
       undone_at, undo_digest_sent_at,
       listings(id, title, address, contact_email, checkin_response_choice, last_verified_at, unavailable)`
    )
    .or("digest_sent_at.is.null,undo_digest_sent_at.is.null,correction_noted_at.is.null")
    .order("applied_at", { ascending: true });

  for (const a of actionRows ?? []) {
    const l = a.listings ?? {};
    if (isTestRow(l) && !includeTest) continue;
    const label = l.title || l.address || a.listing_id;

    // New hides (and failed applies) not yet reported.
    if (!a.digest_sent_at && (a.status === "applied" || a.status === "failed")) {
      // Re-verify previously failed verifications so late successes self-heal.
      let verify = a.verify_result;
      if (a.status === "applied" && verify && !verify.startsWith("verified")) {
        verify = await verifyHidden(a.listing_id, a.scope, baseUrl);
        await supabase
          .from("auto_unavailable_actions")
          .update({ verify_result: verify, verified_at: new Date().toISOString() })
          .eq("id", a.id);
      }
      if (a.status === "failed") {
        digest.anomalies.push({
          title: label,
          note: `Hide FAILED to apply: ${a.verify_result ?? "unknown error"} — the listing is still visible. Will not retry automatically; hide it from the admin dashboard.`,
        });
      } else {
        digest.hidden.push({
          title: label,
          address: l.address,
          saidLabel: CHOICE_LABELS[a.reported_choice] ?? a.reported_choice,
          detail: a.reported_detail,
          reportedAt: a.reported_at,
          contact: l.contact_email,
          scope: a.scope,
          verify,
          undoLink: undoUrl(a.id, baseUrl),
        });
      }
      stamps.digest.push(a.id);
    }

    // Landlord corrected leased -> available AFTER we hid: never auto-relist,
    // surface it with the undo link and let Ben decide.
    if (
      a.status === "applied" &&
      !a.correction_noted_at &&
      l.checkin_response_choice === "available" &&
      l.last_verified_at &&
      a.reported_at &&
      new Date(l.last_verified_at) > new Date(a.reported_at)
    ) {
      digest.corrections.push({
        title: label,
        note: `Landlord now says AVAILABLE (${new Date(l.last_verified_at).toLocaleDateString("en-US")}) — this listing was hidden from an earlier leased report. Click Undo to relist it.`,
        undoLink: undoUrl(a.id, baseUrl),
      });
      stamps.correction.push(a.id);
    }

    // Undo relists not yet reported.
    if (a.status === "undone" && a.undone_at && !a.undo_digest_sent_at) {
      digest.undone.push({
        title: label,
        note: `Relisted via undo link on ${new Date(a.undone_at).toLocaleDateString("en-US")}.`,
      });
      stamps.undo.push(a.id);
    }
  }

  // Dry run reports the would-be candidates instead of DB state.
  if (dryRun) {
    digest.hidden = candidates.map((c) => ({
      title: c.listing.title || c.listing.address || c.listing.id,
      address: c.listing.address,
      saidLabel: CHOICE_LABELS[c.reportedChoice] ?? c.reportedChoice,
      detail: c.listing.leased_elsewhere_detail,
      reportedAt: c.listing.last_verified_at,
      contact: c.listing.contact_email,
      scope: c.scope,
      verify: null,
      undoLink: null,
    }));
    digest.anomalies = [];
    digest.corrections = [];
    digest.undone = [];
  }

  if (unhidableNotes.length) digest.anomalies.push(...unhidableNotes);

  // ---- Send (skip only when truly nothing happened) ----------------------
  const total =
    digest.hidden.length + digest.anomalies.length + digest.corrections.length + digest.undone.length;
  let emailed = false;
  if (total > 0) {
    const recipients = await resolveDigestRecipients(supabase);
    if (recipients.length) {
      const result = await sendReviewDigestEmail({
        to: recipients.join(", "),
        items: digest,
        dryRun,
      });
      emailed = !result?.suppressed;
    }
  }

  // Stamp only what actually reached an inbox, so nothing is silently dropped.
  if (emailed && !dryRun) {
    const now = new Date().toISOString();
    if (stamps.digest.length)
      await supabase.from("auto_unavailable_actions").update({ digest_sent_at: now }).in("id", stamps.digest);
    if (stamps.correction.length)
      await supabase.from("auto_unavailable_actions").update({ correction_noted_at: now }).in("id", stamps.correction);
    if (stamps.undo.length)
      await supabase.from("auto_unavailable_actions").update({ undo_digest_sent_at: now }).in("id", stamps.undo);
  }

  return NextResponse.json({
    dryRun,
    candidates: candidates.map((c) => ({
      listingId: c.listing.id,
      title: c.listing.title,
      choice: c.reportedChoice,
      scope: c.scope,
    })),
    applied: dryRun
      ? []
      : applied.map((a) => ({ listingId: a.listing.id, actionId: a.actionId, error: a.rpcError, verify: a.verify })),
    digest: {
      hidden: digest.hidden.length,
      anomalies: digest.anomalies.length,
      corrections: digest.corrections.length,
      undone: digest.undone.length,
      emailed,
    },
  });
}
