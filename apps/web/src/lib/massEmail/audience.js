/*
 * Who a mass email can go to, with what the admin needs to pick them (Wyatt,
 * 2026-11-07): every account of the chosen role that is not deleted, not a
 * review sandbox account and has an email address, each with
 *
 *   listings      the live listings they are linked to (published, not deleted,
 *                 not marked unavailable)
 *   leaseCount    live leases they own (published, active, available)
 *   subleaseOnly  every live lease they own is a sublease and they have no live
 *                 listing: usually a student subletting under a landlord account
 *   live          something of theirs is live on the site (the enrollment rule)
 *   canLogin      they have a password, Google or Apple sign-in. Without one the
 *                 email's button becomes a set-password link.
 *   lastSent      when this template last went to them, and which version
 *   suppressed    their address bounced or marked us as spam: never emailed
 *
 * `db` is a service-role Supabase client. Nothing here returns a password hash.
 */

const PAGE = 1000;
const CHUNK = 150; // ids per .in() filter, to keep request URLs short
export const DELIVERED = ["sent", "redirected"];

/*
 * Why a picked person is not emailed in this send, or null to send (review of
 * 2026-11-07): already reached by this template (unless sending again), already
 * reached by this batch or lately by this version, or their address bounced or
 * marked us as spam.
 */
export function skipReason(u, { reached, sentInBatch, suppressed, batchId, repeatGuardHours }) {
  if (reached.has(u.id)) return "already sent this email";
  if (sentInBatch.has(u.id)) return batchId ? "already sent in this batch" : `sent this version in the last ${repeatGuardHours} hours`;
  if (suppressed.has(String(u.email ?? "").trim().toLowerCase())) return "their address bounced or marked our email as spam";
  return null;
}

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

export function listingLabel(l) {
  const title = typeof l?.title === "string" ? l.title.trim() : "";
  const street = typeof l?.address === "string" ? l.address.split(",")[0].trim() : "";
  return title || street || "Untitled listing";
}

export async function roleIds(db) {
  const { data, error } = await db.from("roles").select("id, name");
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((r) => [r.name, r.id]));
}

export const ROLES = ["landlord", "student", "all"];

export async function findAudience(db, { role = "landlord", templateId = null } = {}) {
  const roles = await roleIds(db);
  const roleName = Object.fromEntries(Object.entries(roles).map(([name, id]) => [id, name]));
  const wanted = role === "all" ? ["landlord", "student"] : [role];
  const wantedIds = wanted.map((r) => roles[r]).filter(Boolean);
  if (!wantedIds.length) return [];

  const users = await pageAll(() =>
    db
      .from("users")
      .select("id, name, email, company_name, role_id, password_hash, google_account, apple_account, review_sandbox, is_system, created_at")
      .in("role_id", wantedIds)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
  );
  const people = users.filter(
    (u) => !u.review_sandbox && !u.is_system && typeof u.email === "string" && u.email.includes("@")
  );
  const ids = people.map((u) => u.id);

  // Paged within each chunk too: a chunk of landlords can own more than 1,000
  // live leases, and a query stops at 1,000 rows (review of 2026-11-07).
  const listingRows = await inChunks(ids, (chunk) =>
    pageAll(() =>
      db
        .from("listing_landlords")
        .select("user_id, listing_id, listings!inner(id, title, address, published_at, deleted_at, unavailable)")
        .in("user_id", chunk)
        .not("listings.published_at", "is", null)
        .is("listings.deleted_at", null)
        .eq("listings.unavailable", false)
        .order("user_id")
        .order("listing_id")
    )
  );
  const leaseRows = await inChunks(ids, (chunk) =>
    pageAll(() =>
      db
        .from("unit_leases")
        .select("id, owner_id, sublease")
        .in("owner_id", chunk)
        .eq("is_active", true)
        .eq("unavailable", false)
        .is("deleted_at", null)
        .not("published_at", "is", null)
        .order("id")
    )
  );
  const suppressedRows = await pageAll(() => db.from("email_suppressions").select("email").order("email"));
  const suppressed = new Set(suppressedRows.map((r) => r.email));
  const sentRows = templateId
    ? await pageAll(() =>
        db
          .from("mass_email_recipients")
          .select("user_id, created_at, status, mass_email_versions!version_id(version)")
          .eq("template_id", templateId)
          .in("status", DELIVERED)
          .order("created_at", { ascending: true })
      )
    : [];

  const listingsBy = new Map();
  for (const r of listingRows) {
    const list = listingsBy.get(r.user_id) ?? [];
    if (!list.some((l) => l.id === r.listings.id)) list.push({ id: r.listings.id, label: listingLabel(r.listings) });
    listingsBy.set(r.user_id, list);
  }
  const leasesBy = new Map();
  for (const r of leaseRows) {
    const s = leasesBy.get(r.owner_id) ?? { count: 0, sublease: 0 };
    s.count += 1;
    if (r.sublease) s.sublease += 1;
    leasesBy.set(r.owner_id, s);
  }
  const lastSentBy = new Map();
  for (const r of sentRows) {
    lastSentBy.set(r.user_id, { at: r.created_at, version: r.mass_email_versions?.version ?? null });
  }

  return people.map((u) => {
    const listings = listingsBy.get(u.id) ?? [];
    const leases = leasesBy.get(u.id) ?? { count: 0, sublease: 0 };
    return {
      id: u.id,
      name: u.name ?? null,
      email: u.email,
      company: u.company_name ?? null,
      role: roleName[u.role_id] ?? null,
      canLogin: !!(u.password_hash || u.google_account || u.apple_account),
      listings,
      leaseCount: leases.count,
      subleaseOnly: listings.length === 0 && leases.count > 0 && leases.sublease === leases.count,
      live: listings.length > 0 || leases.count > 0,
      lastSent: lastSentBy.get(u.id) ?? null,
      suppressed: suppressed.has(String(u.email).trim().toLowerCase()),
      createdAt: u.created_at,
    };
  });
}
