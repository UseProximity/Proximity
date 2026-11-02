/*
 * Launch enrollment: telling existing landlords that fees are now collected in the
 * app and asking them to add a payment method (and, once it is ready, sign the
 * commission agreement) within a window. The deadline is a date in the email and a
 * banner on the Payments tab. When it arrives the listing requirements switch on
 * by themselves (enforceEnrollmentDeadline, Wyatt 2026-11-02): from then on a
 * landlord needs them to publish. Live listings stay up either way.
 *
 * Who is asked: landlords (not deleted, with an email) who have something live on
 * the site, a published lease or listing, and who still need to set up. A landlord
 * row the importer created with nothing live has nothing to be blocked from, so
 * is left alone. Someone already emailed is skipped, so pressing Send twice never
 * emails anyone twice, unless the admin asks to include them.
 *
 * The window (deadline, and whether the agreement is part of the ask) is stored in
 * billing_settings. `db` is a service-role Supabase client.
 */
import { BillingError } from "./errors.js";
import { getBillingSetting, setBillingSetting } from "./settings.js";
import { hasActivePaymentMethod } from "./paymentMethodState.js";
import { resignCutoff, signatureStillValid } from "./agreementVersions.js";
import { AGREEMENT_REQUIRED, PAYMENT_METHOD_REQUIRED } from "./listingGate.js";

export const ENROLLMENT_WINDOW = "enrollment_window";
export const ENROLLMENT_EMAIL_KIND = "billing_enrollment";

const PAGE = 1000;
const CHUNK = 150; // ids per .in() filter, to keep request URLs short
const NOT_DELIVERED = "(failed,rejected,bounced,complained)";

async function pageAll(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await buildQuery().range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

async function inChunks(ids, fetchChunk) {
  const out = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...(await fetchChunk(ids.slice(i, i + CHUNK))));
  return out;
}

// "2026-12-15" -> "December 15, 2026"
export function formatDeadline(deadline) {
  if (!deadline) return null;
  return new Date(`${deadline}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export async function getEnrollmentWindow(db) {
  const value = await getBillingSetting(db, ENROLLMENT_WINDOW, null);
  return {
    deadline: typeof value?.deadline === "string" ? value.deadline : null,
    includeAgreement: value?.includeAgreement === true,
    // When the deadline switched the requirements on (enforceEnrollmentDeadline).
    enforcedAt: typeof value?.enforcedAt === "string" ? value.enforcedAt : null,
  };
}

export async function setEnrollmentWindow(db, { deadline, includeAgreement }, adminId, now = new Date()) {
  let clean = null;
  if (deadline) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline) || Number.isNaN(new Date(`${deadline}T12:00:00Z`).getTime())) {
      throw new BillingError("bad_deadline", "Enter the deadline as a date.");
    }
    if (deadline < now.toISOString().slice(0, 10)) {
      throw new BillingError("bad_deadline", "The deadline cannot be in the past.");
    }
    clean = deadline;
  }
  // A new deadline is a new window: it switches the requirements on again when it
  // arrives. Saving the same deadline keeps the record that it already did.
  const current = await getEnrollmentWindow(db);
  const enforcedAt = clean && clean === current.deadline ? current.enforcedAt : null;
  await setBillingSetting(db, ENROLLMENT_WINDOW, { deadline: clean, includeAgreement: includeAgreement === true, enforcedAt }, adminId);
  return { deadline: clean, includeAgreement: includeAgreement === true, enforcedAt };
}

// Today's date in Chicago (the billing time zone), as YYYY-MM-DD.
export function chicagoDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/*
 * On the enrollment deadline (Chicago time) the listing requirements switch on by
 * themselves: an active payment method, and a signed agreement when the window
 * asked for one. Run daily by the billing cron. It acts once per deadline: an
 * admin who switches a requirement back off afterwards is not overruled the next day.
 * Returns what it switched on, or null.
 */
export async function enforceEnrollmentDeadline(db, { now = new Date(), adminId = null } = {}) {
  const window = await getEnrollmentWindow(db);
  if (!window.deadline || window.enforcedAt) return null;
  if (chicagoDate(now) < window.deadline) return null;

  const switched = [PAYMENT_METHOD_REQUIRED];
  if (window.includeAgreement) switched.push(AGREEMENT_REQUIRED);
  for (const key of switched) await setBillingSetting(db, key, true, adminId);
  await setBillingSetting(db, ENROLLMENT_WINDOW, { ...window, enforcedAt: now.toISOString() }, adminId);
  return { deadline: window.deadline, switchedOn: switched };
}

/*
 * Which of these landlords have something live on the site: a published,
 * available lease they own, or a live listing they are linked to.
 */
export async function liveListingOwners(db, ids) {
  const liveOwners = new Set();
  for (const row of await inChunks(ids, async (chunk) => {
    const { data, error } = await db
      .from("unit_leases")
      .select("owner_id")
      .in("owner_id", chunk)
      .eq("is_active", true)
      .eq("unavailable", false)
      .is("deleted_at", null)
      .not("published_at", "is", null);
    if (error) throw error;
    return data;
  })) liveOwners.add(row.owner_id);
  for (const row of await inChunks(ids, async (chunk) => {
    const { data, error } = await db
      .from("listing_landlords")
      .select("user_id, listings!inner(published_at, deleted_at, unavailable)")
      .in("user_id", chunk)
      .not("listings.published_at", "is", null)
      .is("listings.deleted_at", null)
      .eq("listings.unavailable", false);
    if (error) throw error;
    return data;
  })) liveOwners.add(row.user_id);

  return liveOwners;
}

/*
 * Which of these landlords hold a signature that still counts (see
 * agreementVersions.resignCutoff).
 */
export async function validSignerIds(db, ids) {
  const cutoff = await resignCutoff(db);
  const rows = await inChunks(ids, async (chunk) => {
    const withVersion = await db
      .from("landlord_agreements")
      .select("user_id, agreement_version:agreement_versions!version_id(published_at)")
      .in("user_id", chunk)
      .eq("status", "signed");
    if (!withVersion.error) return withVersion.data;
    // Before the agreement_versions migration: every signature counts.
    const { data, error } = await db.from("landlord_agreements").select("user_id").in("user_id", chunk).eq("status", "signed");
    if (error) throw error;
    return data;
  });
  return new Set(rows.filter((r) => signatureStillValid(r.agreement_version?.published_at ?? null, cutoff)).map((r) => r.user_id));
}

/*
 * Who would be emailed, and why everyone else would not. Counts explain the gap
 * between "all landlords" and "emails to send".
 */
export async function findEnrollmentAudience(db, { includeAgreement = false, includeAlreadyEmailed = false, now = new Date() } = {}) {
  const landlords = await pageAll(() =>
    db
      .from("users")
      .select("id, name, email, roles!role_id!inner(name)")
      .eq("roles.name", "landlord")
      .is("deleted_at", null)
      .not("email", "is", null)
      .order("id")
  );
  const ids = landlords.map((l) => l.id);
  const liveOwners = await liveListingOwners(db, ids);

  const methods = new Map();
  for (const row of await inChunks(ids, async (chunk) => {
    const { data, error } = await db
      .from("payment_methods")
      .select("user_id, status, type, exp_month, exp_year, deleted_at")
      .in("user_id", chunk)
      .is("deleted_at", null);
    if (error) throw error;
    return data;
  })) {
    if (!methods.has(row.user_id)) methods.set(row.user_id, []);
    methods.get(row.user_id).push(row);
  }

  const signed = await validSignerIds(db, ids);

  const emailed = new Set(
    (
      await inChunks(ids, async (chunk) => {
        const { data, error } = await db
          .from("sent_emails")
          .select("user_id")
          .eq("kind", ENROLLMENT_EMAIL_KIND)
          .in("user_id", chunk)
          .not("status", "in", NOT_DELIVERED);
        if (error) throw error;
        return data;
      })
    ).map((r) => r.user_id)
  );

  const counts = { landlords: landlords.length, withLiveListing: 0, alreadySetUp: 0, alreadyEmailed: 0, toSend: 0 };
  const toSend = [];
  for (const l of landlords) {
    if (!liveOwners.has(l.id)) continue;
    counts.withLiveListing += 1;
    const setUp = hasActivePaymentMethod(methods.get(l.id) ?? [], now) && (!includeAgreement || signed.has(l.id));
    if (setUp) {
      counts.alreadySetUp += 1;
      continue;
    }
    if (emailed.has(l.id)) {
      counts.alreadyEmailed += 1;
      if (!includeAlreadyEmailed) continue;
    }
    toSend.push({ id: l.id, name: l.name, email: l.email });
  }
  counts.toSend = toSend.length;
  return { counts, toSend };
}

// Whether the enrollment email to this landlord was written to sent_emails.
export async function enrollmentEmailLogged(db, userId) {
  const { data, error } = await db
    .from("sent_emails")
    .select("id")
    .eq("kind", ENROLLMENT_EMAIL_KIND)
    .eq("user_id", userId)
    .limit(1);
  if (error) return false;
  return data.length > 0;
}

/*
 * Send to the audience one at a time. `send(landlord)` resolves true when the
 * email went out. Capped per call so one click cannot run past the function's
 * time limit; send again to continue (already emailed landlords are skipped).
 *
 * "Already emailed" is read from sent_emails, so if sends are not being logged
 * (the billing category migration, 202610310002, is missing) every Send would
 * email the same landlords again. `isLogged(landlord)` is checked after the first
 * email that goes out; if it was not logged, sending stops there.
 */
export async function sendEnrollmentEmails({ toSend, send, isLogged = null, limit = 300 }) {
  const batch = toSend.slice(0, limit);
  let sent = 0;
  let failed = 0;
  for (const landlord of batch) {
    if (await send(landlord)) {
      sent += 1;
      if (sent === 1 && isLogged && !(await isLogged(landlord))) {
        throw new BillingError(
          "not_logged",
          "Stopped after one email: sent emails are not being recorded, so sending again would email the same landlords twice. Ask a developer to check the sent_emails log, then try again.",
          500
        );
      }
    } else failed += 1;
  }
  return { attempted: batch.length, sent, failed, remaining: toSend.length - batch.length };
}
