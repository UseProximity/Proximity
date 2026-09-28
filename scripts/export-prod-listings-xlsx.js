/*
 * One-off export: dumps all production listing data (and joined tables) to an .xlsx.
 *
 * Usage:
 *   node scripts/export-prod-listings-xlsx.js
 *
 * Output:
 *   data/proximity-listings-<YYYY-MM-DD>.xlsx
 *
 * Sheets:
 *   - listings          (one row per listing, includes home_type label + landlord summary)
 *   - listing_leases    (one row per lease)
 *   - listing_amenities (one row per listing — boolean columns)
 *   - listing_utilities (one row per listing — boolean columns)
 *   - listing_reviews   (one row per review, includes reviewer name from users)
 *   - listing_images    (one row per image url)
 *   - listing_landlords (one row per landlord link, includes landlord email/name)
 *   - home_types        (reference)
 *   - listings_flat     (denormalized: one row per (listing, lease) with rolled-up amenities/utilities/avg rating)
 */

require("dotenv").config({ path: ".env.local" });

const path = require("path");
const fs = require("fs");
const ExcelJS = require("exceljs");
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.PROD_SUPABASE_URL;
const SUPABASE_KEY = process.env.PROD_SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing PROD_SUPABASE_URL or PROD_SUPABASE_SERVICE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Pull all rows of a table; Supabase caps at 1000 per request, so page if needed.
async function fetchAll(table, select = "*", { filterDeleted = true } = {}) {
  const pageSize = 1000;
  let from = 0;
  const all = [];
  while (true) {
    let q = supabase.from(table).select(select).range(from, from + pageSize - 1);
    if (filterDeleted) q = q.is("deleted_at", null);
    const { data, error } = await q;
    if (error) throw new Error(`fetch ${table}: ${error.message}`);
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

function addSheet(workbook, name, rows) {
  const sheet = workbook.addWorksheet(name);
  if (rows.length === 0) {
    sheet.addRow(["(no rows)"]);
    return;
  }
  const columns = Object.keys(rows[0]);
  sheet.columns = columns.map((key) => ({
    header: key,
    key,
    width: Math.min(Math.max(key.length + 2, 14), 60),
  }));
  for (const row of rows) {
    const flat = {};
    for (const k of columns) {
      const v = row[k];
      flat[k] =
        v == null
          ? ""
          : typeof v === "object"
          ? JSON.stringify(v)
          : v;
    }
    sheet.addRow(flat);
  }
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length },
  };
}

async function main() {
  console.log("Fetching production data…");

  const [
    listings,
    leases,
    amenities,
    utilities,
    reviews,
    images,
    landlordLinks,
    homeTypes,
    users,
  ] = await Promise.all([
    fetchAll("listings"),
    fetchAll("listing_leases"),
    fetchAll("listing_amenities", "*", { filterDeleted: false }),
    fetchAll("listing_utilities", "*", { filterDeleted: false }),
    fetchAll("listing_reviews"),
    fetchAll("listing_images", "*", { filterDeleted: false }),
    fetchAll("listing_landlords", "*", { filterDeleted: false }),
    fetchAll("home_types", "*", { filterDeleted: false }),
    fetchAll(
      "users",
      "id, name, email, phone, role_id, school_id, created_at",
    ),
  ]);

  console.log(`  listings: ${listings.length}`);
  console.log(`  leases: ${leases.length}`);
  console.log(`  amenities rows: ${amenities.length}`);
  console.log(`  utilities rows: ${utilities.length}`);
  console.log(`  reviews: ${reviews.length}`);
  console.log(`  images: ${images.length}`);
  console.log(`  landlord links: ${landlordLinks.length}`);
  console.log(`  home_types: ${homeTypes.length}`);
  console.log(`  users (for joins): ${users.length}`);

  // Build lookup maps
  const homeTypeById = new Map(homeTypes.map((h) => [h.id, h.label]));
  const userById = new Map(users.map((u) => [u.id, u]));
  const amenitiesByListing = new Map(amenities.map((a) => [a.listing_id, a]));
  const utilitiesByListing = new Map(utilities.map((u) => [u.listing_id, u]));
  const leasesByListing = new Map();
  for (const l of leases) {
    if (!leasesByListing.has(l.listing_id)) leasesByListing.set(l.listing_id, []);
    leasesByListing.get(l.listing_id).push(l);
  }
  const reviewsByListing = new Map();
  for (const r of reviews) {
    if (!reviewsByListing.has(r.listing_id)) reviewsByListing.set(r.listing_id, []);
    reviewsByListing.get(r.listing_id).push(r);
  }
  const landlordsByListing = new Map();
  for (const ll of landlordLinks) {
    if (!landlordsByListing.has(ll.listing_id)) landlordsByListing.set(ll.listing_id, []);
    landlordsByListing.get(ll.listing_id).push(ll);
  }

  // Decorate listings with joined labels
  const listingsDecorated = listings.map((l) => {
    const landlordSummary = (landlordsByListing.get(l.id) || [])
      .map((link) => {
        const u = userById.get(link.user_id);
        return u ? `${u.name || ""} <${u.email || ""}>${link.is_primary ? " [primary]" : ""}` : link.user_id;
      })
      .join("; ");
    return {
      ...l,
      home_type_label: homeTypeById.get(l.home_type_id) || "",
      landlords: landlordSummary,
    };
  });

  // Decorate reviews with reviewer name
  const reviewsDecorated = reviews.map((r) => {
    const u = userById.get(r.user_id);
    return {
      ...r,
      reviewer_name: u?.name || r.name || "",
      reviewer_email: u?.email || "",
    };
  });

  // Decorate landlord links with landlord profile fields
  const landlordsDecorated = landlordLinks.map((ll) => {
    const u = userById.get(ll.user_id);
    return {
      ...ll,
      landlord_name: u?.name || "",
      landlord_email: u?.email || "",
      landlord_phone: u?.phone || "",
    };
  });

  // listings_flat: one row per (listing × lease), rolled-up amenities/utilities/review summary
  const listingsFlat = [];
  for (const l of listingsDecorated) {
    const am = amenitiesByListing.get(l.id) || {};
    const ut = utilitiesByListing.get(l.id) || {};
    const amenityList = Object.entries(am)
      .filter(([k, v]) => v === true && !["listing_id", "created_at", "updated_at"].includes(k))
      .map(([k]) => k)
      .join(", ");
    const utilityList = Object.entries(ut)
      .filter(([k, v]) => v === true && !["listing_id", "created_at", "updated_at"].includes(k))
      .map(([k]) => k)
      .join(", ");
    const lReviews = reviewsByListing.get(l.id) || [];
    const legitReviews = lReviews.filter((r) => r.legitimacy !== false);
    const avgRating =
      legitReviews.length > 0
        ? legitReviews.reduce((s, r) => s + Number(r.rating || 0), 0) / legitReviews.length
        : null;
    const listingLeases = leasesByListing.get(l.id) || [];

    if (listingLeases.length === 0) {
      listingsFlat.push({
        listing_id: l.id,
        title: l.title,
        address: l.address,
        city: l.city,
        state: l.state,
        zipcode: l.zipcode,
        latitude: l.latitude,
        longitude: l.longitude,
        home_type: l.home_type_label,
        furnished: l.furnished,
        unavailable: l.unavailable,
        sublease_friendly: l.sublease_friendly,
        twenty_one_plus: l.twenty_one_plus,
        lease_availability: Array.isArray(l.lease_availability) ? l.lease_availability.join(", ") : l.lease_availability,
        lease_id: "",
        bedrooms: "",
        bathrooms: "",
        area: "",
        rent: "",
        pricing_basis: "",
        lease_term_months: "",
        available_from: "",
        is_active_lease: "",
        sublease: "",
        amenities: amenityList,
        utilities_included: utilityList,
        review_count: lReviews.length,
        avg_rating: avgRating,
        landlords: l.landlords,
        contact_email: l.contact_email,
        contact_phone: l.contact_phone,
        contact_name: l.contact_name,
        description: l.description,
        created_at: l.created_at,
        updated_at: l.updated_at,
      });
    } else {
      for (const lease of listingLeases) {
        listingsFlat.push({
          listing_id: l.id,
          title: l.title,
          address: l.address,
          city: l.city,
          state: l.state,
          zipcode: l.zipcode,
          latitude: l.latitude,
          longitude: l.longitude,
          home_type: l.home_type_label,
          furnished: l.furnished,
          unavailable: l.unavailable,
          sublease_friendly: l.sublease_friendly,
          twenty_one_plus: l.twenty_one_plus,
          lease_availability: Array.isArray(l.lease_availability) ? l.lease_availability.join(", ") : l.lease_availability,
          lease_id: lease.id,
          bedrooms: lease.bedrooms,
          bathrooms: lease.bathrooms,
          area: lease.area,
          rent: lease.rent,
          pricing_basis: lease.pricing_basis,
          lease_term_months: lease.lease_term_months,
          available_from: lease.available_from,
          is_active_lease: lease.is_active,
          sublease: lease.sublease,
          amenities: amenityList,
          utilities_included: utilityList,
          review_count: lReviews.length,
          avg_rating: avgRating,
          landlords: l.landlords,
          contact_email: l.contact_email,
          contact_phone: l.contact_phone,
          contact_name: l.contact_name,
          description: l.description,
          created_at: l.created_at,
          updated_at: l.updated_at,
        });
      }
    }
  }

  console.log("Building workbook…");
  const wb = new ExcelJS.Workbook();
  wb.creator = "Proximity export script";
  wb.created = new Date();

  addSheet(wb, "listings_flat", listingsFlat);
  addSheet(wb, "listings", listingsDecorated);
  addSheet(wb, "listing_leases", leases);
  addSheet(wb, "listing_amenities", amenities);
  addSheet(wb, "listing_utilities", utilities);
  addSheet(wb, "listing_reviews", reviewsDecorated);
  addSheet(wb, "listing_images", images);
  addSheet(wb, "listing_landlords", landlordsDecorated);
  addSheet(wb, "home_types", homeTypes);

  const today = new Date().toISOString().slice(0, 10);
  const outDir = path.join(process.cwd(), "data");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `proximity-listings-${today}.xlsx`);
  await wb.xlsx.writeFile(outPath);
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
