/*
 * Auto-unavailable: when a landlord reports a listing as leased through the
 * email check-in system (the proximity-automation repo writes those responses
 * into the shared listings table), hide the listing from students automatically
 * and cover every change in a daily review email to the team, each hide with a
 * one-click Undo link.
 *
 * HARD GUARANTEES — do not weaken any of these:
 *   * NEVER deletes a listing. The only writes are reversible availability
 *     flips (listings.unavailable / listing_units.available) through the
 *     audited rpc_pms_apply function.
 *   * NEVER writes the check-in system's columns (checkin_response_choice,
 *     last_verified_at/by/source, unit_type_status, leased_elsewhere_detail,
 *     pending_owner_review, checkin_count, last_checkin_sent_at,
 *     last_notified_at, multi_unit_override, checkin_response_events).
 *     They are read-only detection signal.
 *   * NEVER emails a landlord. The review email goes to the internal alert
 *     address / super accounts only.
 *   * Never touches rows with deleted_at set, PMS-connected listings (their
 *     availability syncs from the landlord's PMS), or TEST-titled rows
 *     (synthetic rows used by the test protocol) outside an explicit
 *     include_test rehearsal run.
 *
 * Undo links follow the availability-link trust model: an HMAC-signed token
 * (AVAILABILITY_LINK_SECRET, falling back to AUTH_SECRET) referencing one
 * action row. The row must still be in status 'applied' when redeemed, which
 * makes links effectively single-use; expiry bounds how long a forwarded link
 * stays live. Redemption is POST-gated behind a human click (two-step page) so
 * email scanners can never trigger it.
 */
import crypto from "crypto";
import nodemailer from "nodemailer";
import { sendMailSafe } from "./outreach.js";

const TOKEN_TTL_DAYS = 14;

// Matches the system actor already used by audited writes (action_log shows it
// as changed_by_source 'system').
export const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001";

export const LEASED_CHOICES = ["leased_via_proximity", "leased_elsewhere"];

export const CHOICE_LABELS = {
  leased_via_proximity: "Leased through Proximity",
  leased_elsewhere: "Leased elsewhere",
  unit_type_status: "Bedroom types reported no longer available",
};

// Synthetic rows used by the test protocol are invisible to the feature.
export function isTestRow(listing) {
  return /^TEST-/i.test(listing?.title ?? "");
}

// ---------------------------------------------------------------------------
// Signed undo tokens
// ---------------------------------------------------------------------------

function secret() {
  const s = process.env.AVAILABILITY_LINK_SECRET || process.env.AUTH_SECRET;
  if (!s) throw new Error("AVAILABILITY_LINK_SECRET or AUTH_SECRET must be set");
  return s;
}

const b64url = (s) => Buffer.from(s).toString("base64url");
const hmac = (payload) => crypto.createHmac("sha256", secret()).update(payload).digest("base64url");

export function signUndoToken(actionId, now = Date.now()) {
  const payload = b64url(
    JSON.stringify({ a: actionId, exp: Math.floor(now / 1000) + TOKEN_TTL_DAYS * 86400 })
  );
  return `${payload}.${hmac(payload)}`;
}

// Returns { actionId } or null (bad signature / malformed / expired).
export function verifyUndoToken(token, now = Date.now()) {
  if (typeof token !== "string" || token.length > 500) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = hmac(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!data?.a || typeof data.exp !== "number" || data.exp * 1000 < now) return null;
    return { actionId: data.a };
  } catch {
    return null;
  }
}

export function undoUrl(actionId, baseUrl) {
  return `${baseUrl}/api/auto-unavailable/undo?token=${encodeURIComponent(signUndoToken(actionId))}`;
}

// ---------------------------------------------------------------------------
// Verification against the public listings API
// ---------------------------------------------------------------------------

/*
 * Re-reads the public listings API after a write and reports whether students
 * can still see the hidden thing. A hide that doesn't verify is the silent
 * failure mode that killed the 2026-07-10 attempt — callers must surface it
 * loudly, never swallow it.
 *
 * scope: {"listing": true} → the listing must show unavailable (or be absent).
 * scope: {"units": [{bedrooms}]} → every unitType with those bedroom counts
 * must show available: false (a fully-unavailable listing also passes).
 */
export async function verifyHidden(listingId, scope, baseUrl) {
  const res = await fetch(`${baseUrl}/api/listings`, { cache: "no-store" });
  if (!res.ok) return `verify_error: listings API returned ${res.status}`;
  const all = await res.json();
  const listing = all.find((l) => l._id === listingId);
  if (!listing) return "verified_hidden (absent from API)";
  if (listing.unavailable === true) return "verified_hidden";
  if (scope?.units?.length) {
    const beds = new Set(scope.units.map((u) => Number(u.bedrooms)));
    const stillVisible = (listing.unitTypes ?? []).filter(
      (u) => beds.has(Number(u.bedrooms)) && u.available !== false
    );
    return stillVisible.length === 0
      ? "verified_hidden (unit level)"
      : `WARNING: still visible (${stillVisible.length} unit type(s) still available)`;
  }
  return "WARNING: still visible";
}

// The mirror check for undo: the listing must be visible again.
export async function verifyVisible(listingId, scope, baseUrl) {
  const res = await fetch(`${baseUrl}/api/listings`, { cache: "no-store" });
  if (!res.ok) return `verify_error: listings API returned ${res.status}`;
  const all = await res.json();
  const listing = all.find((l) => l._id === listingId);
  if (!listing) return "WARNING: not in API";
  if (scope?.units?.length) {
    const beds = new Set(scope.units.map((u) => Number(u.bedrooms)));
    const restored = (listing.unitTypes ?? []).filter(
      (u) => beds.has(Number(u.bedrooms)) && u.available !== false
    );
    return restored.length > 0 ? "verified_visible" : "WARNING: still hidden";
  }
  return listing.unavailable === false ? "verified_visible" : "WARNING: still hidden";
}

// ---------------------------------------------------------------------------
// Review email
// ---------------------------------------------------------------------------

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT) || 587,
  secure: false,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const fmtWhen = (iso) => {
  if (!iso) return "unknown time";
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: "America/Chicago",
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
  } catch {
    return String(iso);
  }
};

function scopeLabel(scope) {
  if (scope?.units?.length) {
    const beds = scope.units.map((u) => u.bedrooms);
    return `bedroom type(s): ${[...new Set(beds)].sort().join(", ")} BR`;
  }
  return "entire listing";
}

function card({ title, lines, verify, undoLink }) {
  const verifyHtml = verify
    ? verify.startsWith("verified")
      ? `<div style="color:#16a34a;font-size:13px;margin-top:6px">&#10003; ${esc(verify)}</div>`
      : `<div style="color:#E82027;font-weight:700;font-size:13px;margin-top:6px">&#9888; ${esc(verify)}</div>`
    : "";
  const undoHtml = undoLink
    ? `<a href="${undoLink}" style="display:inline-block;margin-top:10px;padding:8px 16px;background:#0A0A0A;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:13px">Undo — relist this</a>`
    : "";
  return `
  <div style="border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;margin:10px 0">
    <div style="font-weight:700;color:#0A0A0A">${esc(title)}</div>
    ${lines.map((l) => `<div style="color:#4b5563;font-size:13px;margin-top:3px">${l}</div>`).join("")}
    ${verifyHtml}
    ${undoHtml}
  </div>`;
}

function section(heading, inner, color = "#0A0A0A") {
  if (!inner) return "";
  return `<h3 style="color:${color};font-size:15px;margin:22px 0 4px">${esc(heading)}</h3>${inner}`;
}

/*
 * items: {
 *   hidden:      [{ title, address, saidLabel, detail, reportedAt, contact, scope, verify, undoLink }],
 *   anomalies:   [{ title, note }],
 *   corrections: [{ title, note, undoLink }],
 *   undone:      [{ title, note }],
 * }
 * Callers must skip sending when every bucket is empty.
 */
export async function sendReviewDigestEmail({ to, items, dryRun = false }) {
  const hiddenHtml = (items.hidden ?? [])
    .map((h) =>
      card({
        title: h.title,
        lines: [
          esc(h.address ?? ""),
          `Landlord said: <strong>${esc(h.saidLabel)}</strong>${h.detail ? ` (${esc(h.detail)})` : ""} — ${esc(fmtWhen(h.reportedAt))}`,
          `Hidden: ${esc(scopeLabel(h.scope))}${h.contact ? ` &middot; contact: ${esc(h.contact)}` : ""}`,
        ],
        verify: h.verify,
        undoLink: dryRun ? null : h.undoLink,
      })
    )
    .join("");

  const correctionsHtml = (items.corrections ?? [])
    .map((c) => card({ title: c.title, lines: [esc(c.note)], undoLink: c.undoLink }))
    .join("");

  const anomaliesHtml = (items.anomalies ?? [])
    .map((a) => card({ title: a.title, lines: [esc(a.note)] }))
    .join("");

  const undoneHtml = (items.undone ?? [])
    .map((u) => card({ title: u.title, lines: [esc(u.note)] }))
    .join("");

  const count = (items.hidden?.length ?? 0) + (items.anomalies?.length ?? 0) +
    (items.corrections?.length ?? 0) + (items.undone?.length ?? 0);

  return sendMailSafe(transporter, {
    from: `"Proximity" <${process.env.EMAIL_USER}>`,
    to,
    replyTo: "info@useproximity.org",
    subject: dryRun
      ? `[DRY RUN] Auto-unavailable review: ${items.hidden?.length ?? 0} listing(s) would be hidden`
      : `Auto-unavailable review: ${count} update(s)`,
    html: `
      <div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;color:#111">
        <div style="color:#E82027;font-weight:800;letter-spacing:.08em;font-size:14px;margin:18px 0">PROXIMITY</div>
        ${dryRun ? `<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:10px 14px;font-size:13px;font-weight:600">DRY RUN — nothing was changed. This is what the system WOULD have done.</div>` : ""}
        ${section(dryRun ? "Would be hidden" : "Hidden from students", hiddenHtml)}
        ${section("Landlord corrections — review these", correctionsHtml, "#E82027")}
        ${section("Anomalies — needs your attention", anomaliesHtml, "#E82027")}
        ${section("Relisted via undo", undoneHtml)}
        <p style="color:#999;font-size:12px;margin-top:24px">
          Hides are reversible: use the Undo button here or the admin dashboard's Hide toggle.
          Listings are never deleted by this system.
        </p>
      </div>
    `,
  });
}

// Alert address override, else every super account with an email.
export async function resolveDigestRecipients(supabase) {
  if (process.env.AUTO_UNAVAILABLE_ALERT_EMAIL) return [process.env.AUTO_UNAVAILABLE_ALERT_EMAIL];
  const { data: supers } = await supabase
    .from("users")
    .select("email, roles!inner(name)")
    .eq("roles.name", "super")
    .not("email", "is", null);
  return (supers ?? []).map((u) => u.email);
}
