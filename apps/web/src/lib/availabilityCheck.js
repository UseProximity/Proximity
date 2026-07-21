/*
 * One-click "still available?" landlord email.
 *
 * Works for EVERY landlord regardless of PMS: a signed link resolves the
 * question without a login. "Yes" restamps the listing verified; "No" marks it
 * unavailable. Either answer closes any open review-queue row for the listing.
 * Targeted (stale listings only, per-listing cool-down) — replaces blast email.
 *
 * Tokens are HMAC-signed (AVAILABILITY_LINK_SECRET, falls back to AUTH_SECRET):
 *   base64url({ l: listingId, exp }) + "." + base64url(hmac)
 * The answer travels as a query param — holding the token IS the authorization
 * (it was emailed to the landlord), same trust model as a password-reset link.
 */
import crypto from "crypto";
import nodemailer from "nodemailer";
import { sendMailSafe } from "./outreach.js";

const TOKEN_TTL_DAYS = 30;

function secret() {
  const s = process.env.AVAILABILITY_LINK_SECRET || process.env.AUTH_SECRET;
  if (!s) throw new Error("AVAILABILITY_LINK_SECRET / AUTH_SECRET is not set");
  return s;
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");

function hmac(payloadB64) {
  return crypto.createHmac("sha256", secret()).update(payloadB64).digest("base64url");
}

// Signed token for one listing, valid TOKEN_TTL_DAYS.
export function signAvailabilityToken(listingId, now = Date.now()) {
  const payload = b64url(
    JSON.stringify({ l: listingId, exp: Math.floor(now / 1000) + TOKEN_TTL_DAYS * 86400 })
  );
  return `${payload}.${hmac(payload)}`;
}

// Returns { listingId } or null (bad signature / malformed / expired).
export function verifyAvailabilityToken(token, now = Date.now()) {
  if (typeof token !== "string" || token.length > 500) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = hmac(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!data?.l || typeof data.exp !== "number" || data.exp * 1000 < now) return null;
    return { listingId: data.l };
  } catch {
    return null;
  }
}

export function availabilityLinks(listingId, baseUrl) {
  const token = encodeURIComponent(signAvailabilityToken(listingId));
  return {
    yes: `${baseUrl}/api/availability/confirm?token=${token}&answer=yes`,
    no: `${baseUrl}/api/availability/confirm?token=${token}&answer=no`,
  };
}

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT) || 587,
  secure: false,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

/*
 * One email per landlord covering all their stale listings — never one email
 * per listing. Each row gets its own Yes/No one-click buttons.
 * listings: [{ id, label }]
 */
export async function sendAvailabilityCheckEmail({ email, name, listings, baseUrl }) {
  const firstName = name ? name.split(" ")[0] : "";
  const single = listings.length === 1;
  const rows = listings
    .map((l) => {
      const links = availabilityLinks(l.id, baseUrl);
      return `
      <div style="border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin:12px 0">
        <div style="font-weight:600;margin-bottom:10px">${l.label}</div>
        <a href="${links.yes}"
           style="display:inline-block;padding:10px 18px;background:#16a34a;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;margin-right:8px">
          Yes, still available
        </a>
        <a href="${links.no}"
           style="display:inline-block;padding:10px 18px;background:#4b5563;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px">
          No, it's leased
        </a>
      </div>`;
    })
    .join("");

  return sendMailSafe(transporter, {
    from: `"Proximity" <${process.env.EMAIL_USER}>`,
    to: email,
    replyTo: "info@useproximity.org",
    subject: single
      ? `Is ${listings[0].label} still available?`
      : `Quick check: are your ${listings.length} listings still available?`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111">
        <h2 style="color:#111">One click${firstName ? `, ${firstName}` : ""} — no login needed</h2>
        <p>WashU students are looking at ${single ? "your listing" : "your listings"} right now.
           Tap a button so they see accurate availability:</p>
        ${rows}
        <p style="color:#666;font-size:14px">"No" just hides the listing from search — nothing is
           deleted, and you can relist anytime from your dashboard.</p>
        <p style="color:#999;font-size:12px">— The Proximity team ·
           <a href="${baseUrl}/dashboard/landlord" style="color:#999">dashboard</a></p>
      </div>
    `,
  });
}
