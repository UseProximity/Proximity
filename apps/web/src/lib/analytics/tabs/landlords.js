import { fetchAll, lookupIds } from "@/lib/analytics/db";
import { gaPathViews } from "@/lib/analytics/ga";
import { weeklyCounts, periodTotals } from "@/lib/analytics/periods";
import { DB, GA, DAY, block, safeBlock, gaBlock, pct, average, median, within, countValues } from "@/lib/analytics/blocks";

/*
 * Landlord flow: who signs up, whether they add listings, how complete and fresh those
 * listings are, and the student demand they receive. Shared with partners on the sandbox,
 * so totals and shares only: never a landlord, an address or a listing.
 */

const CREATOR_LABELS = {
  landlord: "Landlords themselves",
  student: "Students (subleases)",
  admin: "Proximity team",
  super: "Proximity team",
  system: "Automatic import",
};
// A check-in answer is a `choice` for single-unit listings; multi-unit and correction
// replies leave choice empty and are told apart by `mode`.
const CHECKIN_CHOICES = {
  available: "Still available",
  leased_via_proximity: "Leased to a student from Proximity",
  leased_elsewhere: "Leased elsewhere",
};
function checkinAnswer(c) {
  if (c.choice) return CHECKIN_CHOICES[c.choice] ?? c.choice;
  if (String(c.mode).includes("multi_unit")) return "Updated units one by one";
  if (String(c.mode).includes("correction")) return "Asked us to correct the listing";
  return "Other";
}
const per100 = (part, whole) => (whole ? (part / whole) * 100 : null);

const signupMethod = (u) => (u.google_account ? "Google" : u.apple_account ? "Apple" : "Email and password");

export default async function loadLandlords(period) {
  const [roles, metricTypes] = await Promise.all([lookupIds("roles"), lookupIds("metric_types")]);
  const roleName = Object.fromEntries(Object.entries(roles).map(([name, id]) => [id, name]));

  const [landlords, ownerships, listings, creations, units, leases, images, daily, waitlist, checkins] =
    await Promise.all([
      fetchAll("users", "id, created_at, google_account, apple_account", (q) => q.eq("role_id", roles.landlord)),
      fetchAll("listing_landlords", "id, user_id, listing_id, created_at"),
      fetchAll("listings", "id, created_at", (q) => q.gte("created_at", period.prevStart)),
      fetchAll(
        "action_log",
        "id, changed_by_id, changed_by_source, changed_at",
        (q) => q.eq("table_name", "listings").eq("event_type", "INSERT").gte("changed_at", period.prevStart)
      ),
      fetchAll("listing_units", "id, created_at", (q) => q.gte("created_at", period.prevStart)),
      fetchAll("unit_leases", "id, created_at", (q) => q.gte("created_at", period.prevStart)),
      fetchAll("listing_images", "id, created_at, source", (q) => q.gte("created_at", period.prevStart)),
      fetchAll("listing_metrics_daily", "id, recorded_date, count, metric_type_id", (q) =>
        q.gte("recorded_date", period.prevStart.slice(0, 10))
      ),
      fetchAll("waitlist_clicks", "id, created_at", (q) => q.gte("created_at", period.prevStart)),
      fetchAll("checkin_response_events", "id, choice, mode, created_at", (q) => q.gte("created_at", period.prevStart)),
    ]);

  // First listing per landlord account, for activation and time to first listing.
  const firstListing = new Map();
  for (const o of ownerships) {
    const prev = firstListing.get(o.user_id);
    if (!prev || new Date(o.created_at) < new Date(prev)) firstListing.set(o.user_id, o.created_at);
  }
  const landlordIds = new Set(landlords.map((l) => l.id));
  const firsts = [...firstListing].filter(([id]) => landlordIds.has(id)).map(([, created_at]) => ({ created_at }));
  const cohort = (from, to) => landlords.filter((l) => within(l.created_at, from, to));
  const activation = (group) => pct(group.filter((l) => firstListing.has(l.id)).length, group.length);
  const newLandlords = cohort(period.start);
  const prevLandlords = cohort(period.prevStart, period.start);
  const daysToFirst = newLandlords
    .filter((l) => firstListing.has(l.id))
    .map((l) => Math.max(0, (new Date(firstListing.get(l.id)) - new Date(l.created_at)) / DAY));

  const metric = (name) => daily.filter((d) => d.metric_type_id === metricTypes[name]);
  const byCount = (r) => r.count;
  const metricWeekly = (name) => weeklyCounts(period, metric(name), "recorded_date", byCount);
  const metricTotals = (name) => periodTotals(period, metric(name), "recorded_date", byCount);
  const uploadedPhotos = images.filter((i) => i.source !== "street_view");

  const blocks = await Promise.all([
    safeBlock("At a glance", () =>
      block("At a glance", {
        tiles: [
          { label: "New landlord accounts", current: newLandlords.length, previous: prevLandlords.length },
          {
            label: "Landlords who added a listing",
            current: activation(newLandlords),
            previous: activation(prevLandlords),
            format: "percent",
            hint: "Of the landlord accounts created in this period, the share that own at least one listing.",
          },
          {
            label: "Median days from sign-up to first listing",
            current: median(daysToFirst),
            format: "days",
            hint: "For landlords who signed up in this period and have added a listing.",
          },
          { label: "Listings added", ...periodTotals(period, listings) },
          { label: "Contacts sent to landlords", ...metricTotals("contacts") },
        ],
      })
    ),

    safeBlock("Sign-ups and activation", () =>
      block("Sign-ups and activation", {
        trends: [
          {
            title: "Landlord sign-ups per week",
            source: DB,
            series: [
              { label: "New landlord accounts", values: weeklyCounts(period, landlords) },
              { label: "Landlords adding their first listing", values: weeklyCounts(period, firsts) },
            ],
          },
        ],
        distributions: [
          { title: "How new landlords signed up", source: DB, rows: countValues(newLandlords, signupMethod) },
          {
            title: "New landlords by status",
            source: DB,
            rows: countValues(newLandlords, (l) => (firstListing.has(l.id) ? "Has a listing" : "No listing yet")),
          },
        ],
      })
    ),

    safeBlock("Supply added", async () => {
      // Who created each listing, from the change log: the creating account's current role.
      const creatorIds = [...new Set(creations.map((c) => c.changed_by_id).filter(Boolean))];
      const creators = creatorIds.length
        ? await fetchAll("users", "id, role_id", (q) => q.in("id", creatorIds))
        : [];
      const creatorRole = new Map(creators.map((u) => [u.id, roleName[u.role_id]]));
      const createdBy = (c) =>
        c.changed_by_source === "system" || !c.changed_by_id
          ? CREATOR_LABELS.system
          : CREATOR_LABELS[creatorRole.get(c.changed_by_id)] ?? "Other or deleted accounts";
      const currentCreations = creations.filter((c) => within(c.changed_at, period.start));
      return block("Supply added", {
        tiles: [
          { label: "Listings added", ...periodTotals(period, listings) },
          { label: "Unit types added", ...periodTotals(period, units) },
          { label: "Leases added", ...periodTotals(period, leases) },
          { label: "Photos uploaded", ...periodTotals(period, uploadedPhotos) },
        ],
        trends: [
          {
            title: "Supply added per week",
            source: DB,
            series: [
              { label: "Listings", values: weeklyCounts(period, listings) },
              { label: "Unit types", values: weeklyCounts(period, units) },
              { label: "Leases", values: weeklyCounts(period, leases) },
            ],
          },
          {
            title: "Photos uploaded per week",
            source: DB,
            series: [{ label: "Photos", values: weeklyCounts(period, uploadedPhotos) }],
          },
        ],
        distributions: [
          {
            title: "Who added listings",
            source: DB,
            rows: countValues(currentCreations, createdBy),
            note: "From the change log: the role of the account that created each listing.",
          },
        ],
      });
    }),

    safeBlock("Listing quality today", async () => {
      const [all, allImages, allUnits, allLeases] = await Promise.all([
        fetchAll("listings", "id, unavailable, paused_at, last_verified_at", (q) => q.is("deleted_at", null)),
        fetchAll("listing_images", "id, listing_id, source"),
        fetchAll("listing_units", "id, listing_id", (q) => q.is("deleted_at", null)),
        fetchAll("unit_leases", "id, unit_id, rent, lease_term_months, available_from", (q) =>
          q.is("deleted_at", null).eq("unavailable", false)
        ),
      ]);
      const live = all.filter((l) => !l.unavailable && !l.paused_at);
      const photosPer = new Map();
      for (const i of allImages) {
        if (i.source === "street_view") continue; // automatic, not a landlord photo
        photosPer.set(i.listing_id, (photosPer.get(i.listing_id) ?? 0) + 1);
      }
      const unitListing = new Map(allUnits.map((u) => [u.id, u.listing_id]));
      const listingsWhere = (test) => new Set(allLeases.filter(test).map((l) => unitListing.get(l.unit_id)));
      // rent 0 or null means "unknown" (see the legacy-lease cleanup), not free.
      const priced = listingsWhere((l) => Number(l.rent) > 0);
      const termed = listingsWhere((l) => (l.lease_term_months ?? []).length > 0);
      const dated = listingsWhere((l) => !!l.available_from);
      const owned = new Set(ownerships.map((o) => o.listing_id));
      const fresh = Date.now() - 60 * DAY;
      const share = (test) => ({ value: pct(live.filter(test).length, live.length), format: "percent" });
      return block("Listing quality today", {
        description: "A snapshot of every live listing right now, not limited to the selected period.",
        tables: [
          {
            title: "Listings right now",
            source: DB,
            columns: [{ label: "Status" }, { label: "Listings", format: "number" }],
            rows: [
              ["Live", live.length],
              ["Paused", all.filter((l) => l.paused_at).length],
              ["Marked unavailable", all.filter((l) => l.unavailable && !l.paused_at).length],
            ],
          },
          {
            title: "How complete live listings are",
            source: DB,
            columns: [{ label: "Measure" }, { label: "Value" }],
            rows: [
              ["Has a landlord account attached", share((l) => owned.has(l.id))],
              ["Has at least one photo", share((l) => photosPer.has(l.id))],
              [
                "Photos per listing (average)",
                { value: average(live.map((l) => photosPer.get(l.id) ?? 0)), format: "number" },
              ],
              ["Has a known rent", share((l) => priced.has(l.id))],
              ["Has a lease length", share((l) => termed.has(l.id))],
              ["Has an available-from date", share((l) => dated.has(l.id))],
              [
                "Availability confirmed in the last 60 days",
                share((l) => l.last_verified_at && new Date(l.last_verified_at).getTime() >= fresh),
              ],
            ],
          },
        ],
      });
    }),

    safeBlock("Keeping listings up to date", () =>
      block("Keeping listings up to date", {
        description: "Availability check-ins ask landlords whether a listing is still available.",
        tiles: [
          { label: "Check-in answers", ...periodTotals(period, checkins) },
          {
            label: "Leased to a student from Proximity",
            ...periodTotals(period, checkins.filter((c) => c.choice === "leased_via_proximity")),
            hint: "Landlords telling us a unit went to a student who found it here.",
          },
        ],
        trends: [
          {
            title: "Check-in answers per week",
            source: DB,
            series: [{ label: "Answers", values: weeklyCounts(period, checkins) }],
          },
        ],
        distributions: [
          {
            title: "What landlords answered",
            source: DB,
            rows: countValues(
              checkins.filter((c) => within(c.created_at, period.start)),
              checkinAnswer
            ),
          },
        ],
      })
    ),

    safeBlock("Student demand landlords receive", () =>
      block("Student demand landlords receive", {
        description: "The same counts landlords see on their own dashboard.",
        tiles: [
          { label: "Listing views", ...metricTotals("clicks") },
          { label: "Saves", ...metricTotals("saves") },
          { label: "Contacts", ...metricTotals("contacts") },
          { label: "Waitlist sign-ups", ...periodTotals(period, waitlist) },
          {
            label: "Contacts per 100 views",
            current: per100(metricTotals("contacts").current, metricTotals("clicks").current),
            previous: per100(metricTotals("contacts").previous, metricTotals("clicks").previous),
          },
        ],
        trends: [
          {
            title: "Demand per week",
            source: DB,
            series: [
              { label: "Views", values: metricWeekly("clicks") },
              { label: "Saves", values: metricWeekly("saves") },
              { label: "Contacts", values: metricWeekly("contacts") },
              { label: "Waitlist sign-ups", values: weeklyCounts(period, waitlist) },
            ],
          },
        ],
      })
    ),

    gaBlock("Landlord pages", async () => {
      const pages = await gaPathViews(period, ["/add-listing", "/dashboard/landlord"]);
      return block("Landlord pages", {
        description:
          "Visits to the add-listing form and the landlord dashboard. Set against listings added above, this is the closest view of the add-listing drop-off until the form tracks its own steps.",
        tiles: [
          { label: "Add-listing page visitors", current: pages["/add-listing"].visitors },
          { label: "Add-listing page views", ...pages["/add-listing"].views },
          { label: "Landlord dashboard visitors", current: pages["/dashboard/landlord"].visitors },
          { label: "Landlord dashboard views", ...pages["/dashboard/landlord"].views },
        ],
        trends: [
          {
            title: "Landlord page views per week",
            source: GA,
            series: [
              { label: "Add-listing form", values: pages["/add-listing"].weekly },
              { label: "Landlord dashboard", values: pages["/dashboard/landlord"].weekly },
            ],
          },
        ],
      });
    }),
  ]);

  return { blocks };
}
