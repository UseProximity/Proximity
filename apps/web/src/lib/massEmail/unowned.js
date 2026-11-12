/*
 * Live listings with no landlord account, and getting them one before a mass
 * email goes out (Wyatt, 2026-11-07). A listing like that has a contact email but
 * nobody who can sign in, sign the marketing agreement or answer Proxy.
 *
 * findUnownedListings suggests what to do with each one, from its contact email
 * and its leases. Nothing changes until an admin approves a suggestion:
 *
 *   attach  the contact email belongs to an existing landlord account: link the
 *           listing to it.
 *   invite  nobody has that email yet: create a landlord account for it (no
 *           password; the mass email then carries a set-password link) and link
 *           the listing. Listings sharing one contact email are invited together.
 *   skip    a student's sublease (every live lease on it is a sublease, even when
 *           the contact signed up as a landlord, or the contact is a student
 *           account). Not a landlord, so not emailed.
 *   manual  something only a person can sort out: no contact email, or the email
 *           belongs to a deleted account that still holds the address.
 *
 * `db` is a service-role Supabase client.
 */

import { listingLabel, roleIds } from "./audience.js";

const EMAIL_RE = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class UnownedError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const normEmail = (v) => {
  const e = typeof v === "string" ? v.trim().toLowerCase() : "";
  return EMAIL_RE.test(e) ? e : null;
};

// ilike with the wildcards in an email escaped, so it matches only that address.
const exactIlike = (email) => email.replace(/[\\%_]/g, (c) => `\\${c}`);

async function usersByEmail(db, emails) {
  const out = new Map();
  for (const email of emails) {
    const { data, error } = await db
      .from("users")
      .select("id, name, email, deleted_at, review_sandbox, roles!role_id(name)")
      .ilike("email", exactIlike(email));
    if (error) throw error;
    out.set(email, data ?? []);
  }
  return out;
}

/*
 * Pure: the suggestion for one listing.
 *   email       its normalised contact email or null
 *   matches     users rows with that email (any case)
 *   leases      [{ sublease, ownerRole }] its live leases
 */
export function suggestFor({ email, matches = [], leases = [] }) {
  const live = matches.filter((u) => !u.deleted_at && !u.review_sandbox);
  const landlord = live.find((u) => u.roles?.name === "landlord");
  const student = live.find((u) => u.roles?.name === "student");
  const allSublease = leases.length > 0 && leases.every((l) => l.sublease);

  // Subleases first: a student subletting often signed up as a landlord, and is
  // still not who a landlord email is for (Wyatt, 2026-11-07).
  if (allSublease) return { action: "skip", reason: "Every live lease on it is a sublease" };
  if (landlord) return { action: "attach", userId: landlord.id, userName: landlord.name, reason: `Contact email is ${landlord.name || "an existing landlord"}'s account` };
  if (student) return { action: "skip", reason: "Posted by a student account (sublease)" };
  if (!email) return { action: "manual", reason: "No contact email" };
  if (matches.some((u) => u.deleted_at)) return { action: "manual", reason: "A deleted account still holds this email" };
  if (matches.length) return { action: "manual", reason: "This email belongs to an account that is not a landlord or student" };
  return { action: "invite", reason: "No account has this email yet" };
}

export async function findUnownedListings(db) {
  const { landlord } = await roleIds(db);
  const { data: listings, error } = await db
    .from("listings")
    .select("id, title, address, contact_name, contact_email, contact_phone, review_sandbox, listing_landlords(user_id, users!user_id(role_id, deleted_at, review_sandbox))")
    .not("published_at", "is", null)
    .is("deleted_at", null);
  if (error) throw error;

  const unowned = (listings ?? []).filter(
    (l) =>
      !l.review_sandbox &&
      !(l.listing_landlords ?? []).some((x) => x.users && x.users.role_id === landlord && !x.users.deleted_at && !x.users.review_sandbox)
  );
  if (!unowned.length) return [];

  const { data: leaseRows, error: leaseErr } = await db
    .from("unit_leases")
    .select("sublease, listing_units!inner(listing_id)")
    .in("listing_units.listing_id", unowned.map((l) => l.id))
    .is("deleted_at", null)
    .not("published_at", "is", null)
    .eq("is_active", true);
  if (leaseErr) throw leaseErr;
  const leasesBy = new Map();
  for (const r of leaseRows ?? []) {
    const id = r.listing_units.listing_id;
    leasesBy.set(id, [...(leasesBy.get(id) ?? []), { sublease: !!r.sublease }]);
  }

  const emails = [...new Set(unowned.map((l) => normEmail(l.contact_email)).filter(Boolean))];
  const matchesBy = await usersByEmail(db, emails);

  return unowned
    .map((l) => {
      const email = normEmail(l.contact_email);
      return {
        id: l.id,
        label: listingLabel(l),
        address: l.address ?? null,
        contactName: l.contact_name ?? null,
        contactEmail: email,
        contactPhone: l.contact_phone ?? null,
        leaseCount: (leasesBy.get(l.id) ?? []).length,
        suggestion: suggestFor({ email, matches: email ? matchesBy.get(email) ?? [] : [], leases: leasesBy.get(l.id) ?? [] }),
      };
    })
    .sort((a, b) => (a.contactEmail ?? "~").localeCompare(b.contactEmail ?? "~") || a.label.localeCompare(b.label));
}

// The listings still have no landlord account (re-checked right before linking).
async function stillUnowned(db, listingIds) {
  const ids = [...new Set(listingIds)].filter((id) => UUID.test(String(id)));
  if (!ids.length) throw new UnownedError("no_listings", "Choose at least one listing.");
  const current = new Map((await findUnownedListings(db)).map((l) => [l.id, l]));
  const missing = ids.filter((id) => !current.has(id));
  if (missing.length) throw new UnownedError("already_owned", "One of these listings already has a landlord account, or is no longer live. Refresh the list.", 409);
  return ids.map((id) => current.get(id));
}

async function link(db, userId, listingIds, now) {
  const rows = listingIds.map((listingId) => ({ listing_id: listingId, user_id: userId, is_primary: true, claimed_at: now }));
  const { error } = await db.from("listing_landlords").upsert(rows, { onConflict: "listing_id,user_id" });
  if (error) throw error;
}

// Links the listings to an existing, live landlord account.
export async function attachListings(db, { userId, listingIds, now = new Date().toISOString() }) {
  if (!UUID.test(String(userId))) throw new UnownedError("bad_user", "Choose a landlord.");
  const { data: user, error } = await db
    .from("users")
    .select("id, deleted_at, review_sandbox, roles!role_id(name)")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!user || user.deleted_at || user.review_sandbox || user.roles?.name !== "landlord") {
    throw new UnownedError("bad_user", "That account is not a live landlord account.");
  }
  const listings = await stillUnowned(db, listingIds);
  await link(db, userId, listings.map((l) => l.id), now);
  return { userId, linked: listings.length };
}

/*
 * Creates a landlord account for a contact email nobody has yet, then links the
 * listings. The account has no password: the next mass email gives it a
 * set-password link. The name comes from the listing's contact name.
 */
export async function inviteContact(db, { email, name, listingIds, now = new Date().toISOString() }) {
  const clean = normEmail(email);
  if (!clean) throw new UnownedError("bad_email", "That is not a usable email address.");
  const listings = await stillUnowned(db, listingIds);
  if (listings.some((l) => l.contactEmail !== clean)) {
    throw new UnownedError("email_mismatch", "Every listing invited together must have this contact email.");
  }
  const existing = (await usersByEmail(db, [clean])).get(clean) ?? [];
  if (existing.length) throw new UnownedError("email_taken", "An account already has this email. Use Attach, or sort it out by hand.", 409);

  const { landlord } = await roleIds(db);
  if (!landlord) throw new Error("landlord role missing");
  const contactName = typeof name === "string" && name.trim() ? name.trim().slice(0, 120) : null;
  const fallback = clean.split("@")[0].replace(/[._+-]+/g, " ").trim().replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 60);
  const { data: user, error } = await db
    .from("users")
    .insert({
      email: clean,
      name: contactName || fallback || "Proximity landlord",
      role_id: landlord,
      email_verified: false,
      profile_complete: false,
      gender: "unspecified",
      phone: "N/A",
      description: "",
      referral_source: "admin_invite",
    })
    .select("id, name, email")
    .single();
  if (error) {
    if (error.code === "23505") throw new UnownedError("email_taken", "An account already has this email. Use Attach, or sort it out by hand.", 409);
    throw error;
  }
  await link(db, user.id, listings.map((l) => l.id), now);
  return { userId: user.id, name: user.name, linked: listings.length };
}
