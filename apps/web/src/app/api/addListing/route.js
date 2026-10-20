import { NextResponse, after } from "next/server";
import supabase from "@/lib/supabase";
import { getRequestUser } from "@/lib/getRequestUser";
import { fetchAllWalkTimes } from "@/utils/walkTimes";
import { fetchAllDriveTimes } from "@/utils/driveTimes";
import { fetchAndStoreStreetView } from "@/lib/streetview";
import { deriveLeaseAvailability } from "@/utils/listingFormatters";
import { shortDescription } from "@/lib/listings/leaseDescription";
import { isValidCount, isWholeCount } from "@/utils/unitCounts";
import { sendNewListingEmail } from "@/lib/email/newListingEmail";
import { getBaseUrl } from "@/lib/email";
import { requestContactVerification } from "@/lib/chat/contactVerification";
import {
  findPropertyNameConflict,
  listingsAtAddress,
  propertyNameTakenResponse,
} from "@/lib/listings/propertyName";
import { claimUnclaimedProperty } from "@/lib/listings/ownership";
import { checkListingDescription } from "@/lib/contentRules";
import { attachSourceUrl } from "@/lib/sourceSync/attach";
import { apartmentsLabel, cleanUnitName } from "@/utils/unitName";
import { findUnitNamed, nextUnitSortOrder } from "@/lib/listings/unitNames";

async function geocodeAddress(address) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const encoded = encodeURIComponent(address);
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${token}&limit=1&country=US`;
  const res = await fetch(url);
  const data = await res.json();
  const feature = data.features?.[0];
  if (!feature) return null;
  const [lng, lat] = feature.center;
  return { latitude: lat, longitude: lng };
}

// Valid boolean column names on listing_amenities / listing_utilities.
// Clients send these names directly; unknown values are ignored.
const AMENITY_COLS = new Set([
  "air_conditioning", "dishwasher", "gym", "laundry", "mailroom",
  "microwave", "oven", "parking", "pets_allowed", "pool",
  "refrigerator", "rooftop", "storage", "stove", "study_room",
]);

const UTILITY_COLS = new Set([
  "electric", "gas", "heat", "water", "internet",
  "trash", "cable", "sewer", "cooling",
]);

// A revenue-managed building quotes nine or ten lease lengths; past that it is
// almost certainly a parsing accident rather than a real price list.
const MAX_LEASES_PER_UNIT = 40;

export async function POST(req) {
  /*
   * The property row this request created, if it created one. Held at function
   * scope so every failure path below, including the catch, can undo it.
   */
  let createdListingId = null;

  /*
   * Undo the property we made in this request, then report the failure.
   *
   * rpc_create_listing commits the property on its own; its units and leases are
   * written afterwards in separate statements. A failure in between used to
   * leave a property row carrying nothing, invisible on the landlord's dashboard
   * but live on browse. Three of those appeared at 7244 Forsyth in 62 seconds
   * when one submission failed three times over a fractional bedroom count.
   *
   * Every child of listings is ON DELETE CASCADE or SET NULL, so the row takes
   * its amenities, utilities and walk times with it. A property we merely
   * attached to is never touched: we did not create it.
   */
  const fail = async (status, error) => {
    if (createdListingId) {
      const { error: rollbackError } = await supabase
        .from("listings")
        .delete()
        .eq("id", createdListingId);
      if (rollbackError) {
        console.error("[addListing] Rollback of orphaned property failed:", rollbackError.message);
      } else {
        createdListingId = null;
      }
    }
    return NextResponse.json({ error }, { status });
  };

  try {
    const body = await req.json();

    const {
      address,
      longitude,
      latitude,
      description,
      unitTypes,
      leaseType,
      // Extra fields
      leaseAvailability,
      lease_availability,
      leaseStructure,
      amenities,
      furnished,
      title,
      customAmenities,
      custom_amenities,
      attachStreetView,
      // Set when the address matched an existing property and the user chose to
      // add a new unit to it rather than create a second property row.
      attachToListingId,
    } = body;

    /*
     * Save as a draft instead of publishing (see 202610100002). A new property
     * is born a draft, which hides everything under it. Attached to a property
     * that is already live, the new units are the drafts instead, so the
     * building students can see is left exactly as it was.
     */
    const draft = body.draft === true;

    // The add forms hold their state in snake_case and spread it straight into
    // the body, so any field this route read only in camelCase never arrived:
    // home type silently fell back to "Other", utilities came out empty and
    // sublease_friendly stayed false on every listing created through the app.
    // Accept either spelling (as `lease_type` already does below).
    // `||` for the text fields so a blank one falls through to null rather than
    // reaching Postgres as "" (an empty move_in_date would fail the date cast);
    // `??` for booleans and arrays so a deliberate false or [] is preserved.
    const homeType = body.homeType || body.home_type || null;
    const utilitiesIncluded = body.utilitiesIncluded ?? body.utilities_included;
    const subleaseFriendly = body.subleaseFriendly ?? body.sublease_friendly;
    const twenty_one_plus = body.twenty_one_plus ?? body.twentyOnePlus;
    const moveInDate = body.moveInDate || body.move_in_date || null;
    /*
     * Where this listing was read from. `sourceUrl` is the property's own page,
     * `indexUrl` the company page the landlord pasted when that page listed
     * several properties. Both are what the weekly source check re-reads later,
     * so a listing that came in from a website is never left without a way back
     * to it.
     */
    const sourceUrl = body.sourceUrl || body.source_url || null;
    const indexUrl = body.indexUrl || body.index_url || null;
    const contactEmail = body.contactEmail || body.contact_email || null;
    const contactPhone = body.contactPhone || body.contact_phone || null;
    const contactName = body.contactName || body.contact_name || null;

    /*
     * Validate required fields.
     *
     * A description is NOT one of them. It used to be, which forced every
     * landlord to write a paragraph before they could publish — and what they
     * wrote then went to listings.description, a property-level column that the
     * offering-level UI never shows. It is now the lease's own short blurb,
     * optional, and read back behind the chevron on the offering it describes.
     */
    if (
      !address?.trim() ||
      !Array.isArray(unitTypes) ||
      unitTypes.length === 0
    ) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const invalidUnit = unitTypes.some(
      (unit) => unit.bedrooms === undefined || unit.bathrooms === undefined
    );

    if (invalidUnit) {
      return NextResponse.json({ error: "Invalid unit type" }, { status: 400 });
    }

    // Room counts are physical, so a negative is always a slip rather than a
    // claim — four listings went live with -2 bed / -1 bath before this check
    // existed. See @/utils/unitCounts.
    if (
      unitTypes.some(
        (unit) => !isValidCount(unit.bedrooms) || !isValidCount(unit.bathrooms)
      )
    ) {
      return NextResponse.json(
        { error: "Bedrooms and bathrooms cannot be negative." },
        { status: 400 }
      );
    }

    /*
     * Bedrooms land in an integer column, so a 2.5 used to travel all the way to
     * the insert and come back as "invalid input syntax for type integer", which
     * the landlord saw only as "Could not save a unit." Reject it here, by name,
     * before a property row exists to be orphaned. Bathrooms are numeric and
     * half baths are real, so they are deliberately not checked.
     */
    if (unitTypes.some((unit) => !isWholeCount(unit.bedrooms))) {
      return NextResponse.json(
        /*
         * Deliberately NOT tagged with `field`: the wizard renders a field
         * rejection only for `title` and swallows any other, so naming the field
         * here would show the landlord nothing. The message carries the field.
         */
        {
          error:
            "Bedrooms must be a whole number. If you mean a half bath, put it in the bathrooms field.",
        },
        { status: 400 }
      );
    }

    // Allow import script to bypass auth using a shared secret
    const importSecret = process.env.IMPORT_SECRET;
    const providedSecret = req.headers.get("x-import-secret");
    const isImportRequest = importSecret && providedSecret === importSecret;

    let ownerId = null;

    if (!isImportRequest) {
      // Web cookie or mobile Bearer token.
      const requestUser = await getRequestUser(req);
      if (!requestUser) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const userRole = requestUser.role;
      if (!["student", "landlord", "super"].includes(userRole)) {
        return NextResponse.json(
          { error: "Only students, landlords, and super admins can create listings." },
          { status: 403 }
        );
      }
      ownerId = requestUser.id;
      if (!ownerId) {
        return NextResponse.json({ error: "Owner not found" }, { status: 404 });
      }
      /*
       * Someone has to be reachable about the offering. Not asked of the
       * importer, which creates unclaimed listings whose contact is whatever the
       * source site published — sometimes nothing.
       */
      if (!contactEmail?.trim()) {
        return NextResponse.json(
          { error: "A contact email is required so students can reach you." },
          { status: 400 }
        );
      }

      /*
       * No names, links or self-promotion in what a person writes. Deliberately
       * NOT applied to the importer above: that path is a trusted seeding script
       * copying whatever a source site published, with no author on the other
       * end to rewrite it, so enforcing here would only fail the import.
       */
      for (const text of [description, body.leaseDescription]) {
        const problem = checkListingDescription(text);
        if (problem) return NextResponse.json({ error: problem }, { status: 400 });
      }

      /*
       * Terms Section 5: posting a sublease means the poster confirms their own
       * lease lets them sublet. The form asks with an unticked checkbox; this is
       * the same check for anyone calling the route without it.
       */
      const postsSublease =
        String(leaseType ?? body.lease_type ?? "").toLowerCase() === "sublease";
      if (postsSublease && body.subleaseRightsConfirmed !== true) {
        return NextResponse.json(
          { error: "Please confirm you have the right to sublet this place." },
          { status: 400 }
        );
      }
    }

    // Geocode address if lat/lng not provided
    let resolvedLat = latitude;
    let resolvedLng = longitude;
    if (resolvedLat === undefined || resolvedLng === undefined) {
      const coords = await geocodeAddress(address);
      if (!coords) {
        return NextResponse.json(
          { error: "Could not geocode address" },
          { status: 400 }
        );
      }
      resolvedLat = coords.latitude;
      resolvedLng = coords.longitude;
    }

    // Calculate real walking times to campus + all WashU places + shuttle stops via Mapbox
    let placeWalkMinutes = {};
    let shuttleWalkMinutes = null;
    try {
      ({ placeWalkMinutes, shuttleWalkMinutes } = await fetchAllWalkTimes(resolvedLat, resolvedLng));
    } catch (err) {
      console.error("[walkTimes] Failed to fetch walk times:", err?.message);
    }

    // Calculate real driving times to fixed destinations + nearest grocery/gas/pharmacy via Mapbox
    let placeDriveMinutes = {};
    try {
      ({ placeDriveMinutes } = await fetchAllDriveTimes(resolvedLat, resolvedLng));
    } catch (err) {
      console.error("[driveTimes] Failed to fetch drive times:", err?.message);
    }

    // Look up home_type_id from home_types table
    let homeTypeId = null;
    if (homeType) {
      const { data: homeTypeRow } = await supabase
        .from("home_types")
        .select("id")
        .ilike("label", homeType)
        .maybeSingle();
      homeTypeId = homeTypeRow?.id ?? null;
    }
    // Fall back to 'Other' if not found
    if (!homeTypeId) {
      const { data: otherRow } = await supabase
        .from("home_types")
        .select("id")
        .eq("label", "Other")
        .maybeSingle();
      homeTypeId = otherRow?.id ?? null;
    }

    // Normalize lease_availability — only pass through if it looks like a real date (YYYY-MM-DD).
    // The form also sends category labels like "semester" which cannot be cast to date.
    const leaseAvailabilityVal = (() => {
      const val = leaseAvailability ?? lease_availability ?? null;
      const raw = Array.isArray(val) ? (val[0] ?? null) : val;
      return typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
    })();

    // Free-text "other" amenities (array of strings)
    const customAmenityArr = (() => {
      const val = customAmenities ?? custom_amenities ?? [];
      return Array.isArray(val)
        ? val.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean)
        : [];
    })();

    // Build amenity and utility boolean maps
    const amenityObj = Object.fromEntries([...AMENITY_COLS].map((c) => [c, false]));
    for (const name of (amenities ?? [])) {
      if (typeof name === "string" && AMENITY_COLS.has(name)) amenityObj[name] = true;
    }

    const utilityObj = Object.fromEntries([...UTILITY_COLS].map((c) => [c, false]));
    for (const name of (utilitiesIncluded ?? [])) {
      if (typeof name === "string" && UTILITY_COLS.has(name)) utilityObj[name] = true;
    }

    // Resolve walk/drive-time location IDs by name (single locations read).
    // Walk times are inserted inside rpc_create_listing (p_walk_times); drive
    // times are upserted separately after the listing is created (see below).
    const walkTimeRows = [];
    const driveTimeRows = [];
    try {
      const { data: locations } = await supabase.from("locations").select("id, name");
      if (locations?.length) {
        for (const [key, minutes] of Object.entries(placeWalkMinutes ?? {})) {
          const loc = locations.find((l) => l.name.toLowerCase() === key.toLowerCase());
          if (loc && minutes != null) walkTimeRows.push({ location_id: loc.id, minutes });
        }
        if (shuttleWalkMinutes != null) {
          const shuttleLoc = locations.find((l) => l.name.toLowerCase() === "shuttle_nearest");
          if (shuttleLoc) walkTimeRows.push({ location_id: shuttleLoc.id, minutes: shuttleWalkMinutes });
        }
        // Drive times mirror the walk-time name match. placeDriveMinutes is keyed
        // by locations-table names, including synthetic *_nearest rows.
        for (const [key, minutes] of Object.entries(placeDriveMinutes ?? {})) {
          const loc = locations.find((l) => l.name.toLowerCase() === key.toLowerCase());
          if (loc && minutes != null) driveTimeRows.push({ location_id: loc.id, minutes });
        }
      }
    } catch (wtErr) {
      console.error("[addListing] Failed to resolve walk/drive times:", wtErr?.message);
    }

    // A listing is a sublease when its lease type is "sublease". The dashboard
    // "Add Sublease" modal sends snake_case lease_type; the public form sends
    // camelCase leaseType — accept either. unit_leases.sublease is the canonical
    // per-lease flag the app reads.
    const resolvedLeaseType = leaseType ?? body.lease_type ?? "standard";
    const isSublease = String(resolvedLeaseType).toLowerCase() === "sublease";

    /*
     * The blurb that goes on the OFFERING. The add flow sends one short line;
     * the importer sends whatever the source site published, which can run to
     * several paragraphs and predates the cap, so it is copied across whole.
     */
    const leaseBlurb = isImportRequest
      ? description?.trim() || null
      : shortDescription(body.leaseDescription ?? description);

    /*
     * Rent specials. listing_concessions has existed unused since the schema
     * was written, and a special is the single biggest thing a student cannot
     * see when comparing two rents: "1 month free on a 10+ month lease, sign by
     * September 30" is worth more than the gap between most listings.
     *
     * Attached to the listing rather than to a lease: the table's lease foreign
     * key points at listing_leases, which is the retired table, and a banner
     * special is property-wide anyway.
     */
    const concessionRows = (Array.isArray(body.concessions) ? body.concessions : [])
      .map((c) => (typeof c === "string" ? c : c?.description))
      .filter((c) => typeof c === "string" && c.trim())
      .slice(0, 6)
      .map((text) => {
        /*
         * The deadline, pulled out of the sentence here rather than asked of
         * the model, so the extraction schema stays flat. "on or before
         * September 30th, 2026" and "9/30/2026" both land as a date; anything
         * we cannot read stays in the sentence, which is the part a renter
         * reads anyway.
         */
        const t = text.trim().slice(0, 300);
        const iso = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
        const slash = t.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
        const written = t.match(
          /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})/i
        );
        let validUntil = null;
        if (iso) validUntil = iso[0];
        else if (slash) {
          validUntil = `${slash[3]}-${String(slash[1]).padStart(2, "0")}-${String(slash[2]).padStart(2, "0")}`;
        } else if (written) {
          const month =
            [
              "january", "february", "march", "april", "may", "june",
              "july", "august", "september", "october", "november", "december",
            ].indexOf(written[1].toLowerCase()) + 1;
          validUntil = `${written[3]}-${String(month).padStart(2, "0")}-${String(written[2]).padStart(2, "0")}`;
        }
        /*
         * amount_type is constrained to flat | percentage | months_free, so it
         * is only set when the sentence actually says which kind of offer this
         * is, with the number alongside it. Left null otherwise: the sentence
         * already says what the renter gets, and inventing a category to
         * satisfy a column would put a wrong number on a listing.
         */
        const monthsFree = t.match(/(\d+(?:\.\d+)?)\s*(?:month|mo)s?\s+free/i);
        const percentOff = t.match(/(\d+(?:\.\d+)?)\s*%\s*(?:off|discount)/i);
        const flatOff = t.match(/\$\s*([\d,]+(?:\.\d{2})?)\s*(?:off|credit|discount)/i);
        let amount = null;
        let amountType = null;
        if (monthsFree) {
          amount = Number(monthsFree[1]);
          amountType = "months_free";
        } else if (percentOff) {
          amount = Number(percentOff[1]);
          amountType = "percentage";
        } else if (flatOff) {
          amount = Number(flatOff[1].replace(/,/g, ""));
          amountType = "flat";
        }
        return {
          description: t,
          amount,
          amount_type: amountType,
          conditions: null,
          valid_until: validUntil,
          active: true,
          last_verified_source: "import",
          last_verified_at: new Date().toISOString(),
        };
      });

    const unitData = unitTypes.map((unit) => ({
      bedrooms: unit.bedrooms,
      bathrooms: unit.bathrooms,
      area: unit.area ?? null,
      rent: unit.rent ?? null,
      // The mobile app sends `title` for a unit's name.
      name: cleanUnitName(unit.name ?? unit.title),
      floorPlanImageUrl: unit.floorPlanImageUrl ?? null,
      /*
       * Several priced offerings on one unit, cheapest-first on the listing
       * page. Each entry is { rent, leaseTermMonths, availableFrom?,
       * rentIsPerPerson? }; the last two fall back to the unit's own when absent.
       */
      leases: Array.isArray(unit.leases)
        ? unit.leases
            .filter((l) => l && (l.rent != null || Array.isArray(l.leaseTermMonths)))
            .map((l) => ({
              rent: l.rent != null && l.rent !== "" ? Number(l.rent) : null,
              leaseTermMonths: Array.isArray(l.leaseTermMonths)
                ? l.leaseTermMonths.map(Number).filter((m) => Number.isFinite(m) && m > 0)
                : [],
              availableFrom:
                typeof l.availableFrom === "string" && /^\d{4}-\d{2}-\d{2}$/.test(l.availableFrom)
                  ? l.availableFrom
                  : null,
              rentIsPerPerson: l.rentIsPerPerson == null ? null : !!l.rentIsPerPerson,
              // Apartment numbers behind a floor plan's price, written to the
              // lease's description. Short strings only, and not many of them.
              apartments: Array.isArray(l.apartments)
                ? l.apartments
                    .filter((a) => typeof a === "string" && a.trim())
                    .map((a) => a.trim().slice(0, 20))
                    .slice(0, 40)
                : [],
            }))
        : null,
      // A unit can be offered for several lease durations (months).
      leaseTermMonths: Array.isArray(unit.leaseTermMonths)
        ? unit.leaseTermMonths
            .map((m) => Number(m))
            .filter((m) => Number.isFinite(m) && m > 0)
        : [],
      leaseAvailability: unit.leaseAvailability ?? null,
      rentIsPerPerson:
        unit.rentIsPerPerson == null ? null : !!unit.rentIsPerPerson,
      // Availability of the OFFERING, not of the unit — it lands on
      // unit_leases.unavailable below. Units no longer carry a flag of their
      // own; whether one is available is read back off its offerings.
      available: unit.available !== false,
      sublease: isSublease,
    }));

    // listings.lease_availability is derived from the union of the units' lease terms.
    const leaseAvailabilityArr = deriveLeaseAvailability(unitData);

    // Units and leases are written directly rather than through the create RPC's
    // p_units, because the RPC gives no way to tie each inserted unit back to the
    // payload row it came from — every row in one transaction shares a created_at,
    // so identity and lease ownership could not be attributed afterwards.
    let listingId = attachToListingId ?? null;
    let createdListingHere = false;

    if (listingId) {
      // Attaching to an existing property: the property row, its amenities and
      // its walk times already exist and belong to whoever created them. Only
      // the new units and their leases are written.
      const { data: target, error: targetError } = await supabase
        .from("listings")
        .select("id, address, deleted_at")
        .eq("id", listingId)
        .maybeSingle();

      if (targetError) {
        console.error("[addListing] Target listing lookup failed:", targetError.message);
        return NextResponse.json({ error: "Could not verify that property." }, { status: 500 });
      }
      if (!target || target.deleted_at) {
        return NextResponse.json({ error: "That property no longer exists." }, { status: 404 });
      }

      /*
       * The client picks the property from an address lookup, so the id and the
       * submitted address must describe the same place. Checking only that the
       * id exists let a crafted request graft units onto an unrelated
       * landlord's property — changing their unit set, their aggregates, and
       * what browse shows for them.
       */
      const [{ data: targetKey }, { data: submittedKey }] = await Promise.all([
        supabase.rpc("normalize_property_key", { p_address: target.address }),
        supabase.rpc("normalize_property_key", { p_address: address }),
      ]);
      if (!targetKey || !submittedKey || targetKey !== submittedKey) {
        return NextResponse.json(
          { error: "That property doesn't match the address you entered." },
          { status: 400 }
        );
      }
    } else {
      /*
       * A new property claims its display name. Only this branch checks: the
       * attach branch above adds units to a property that already exists and
       * never writes listings.title, so a name it does not touch cannot be one
       * it takes.
       *
       * school_id is not set on create yet, so the lookup runs against the
       * unschooled bucket — the same one the unique index folds NULLs into.
       */
      /*
       * One building, one listing. A second listing at an address that is
       * already on Proximity is refused, whatever it is called: a batch import
       * posted "5047 Waterman Blvd." beside "5047 Waterman Boulevard" because
       * only the name was checked, and the two differ by an abbreviation. The
       * address key is the one the database already stores on every row.
       *
       * The existing listing comes back so the caller can add to it or edit
       * what the landlord already has there, which is what they meant to do.
       */
      const atAddress = await listingsAtAddress(address, ownerId);
      if (atAddress.match) {
        return NextResponse.json(
          {
            error: "This address is already on Proximity.",
            code: "address_taken",
            existing: atAddress.match,
          },
          { status: 409 }
        );
      }

      const nameConflict = await findPropertyNameConflict(title, { schoolId: null });
      if (nameConflict) {
        return NextResponse.json(propertyNameTakenResponse(nameConflict), { status: 409 });
      }

      // All property-level writes in one transaction — sets app.current_user_id
      // for action_log attribution.
      const { data: newListingId, error: listingError } = await supabase.rpc("rpc_create_listing", {
        p_user_id: ownerId,
        p_listing_data: {
          title: title?.trim() || null,
          address,
          longitude: resolvedLng,
          latitude: resolvedLat,
          // NOT NULL in the schema, and now optional in the form: a property
          // created without one starts blank rather than refusing to save.
          description: description?.trim() || "",
          lease_type: resolvedLeaseType,
          home_type_id: homeTypeId,
          lease_structure: leaseStructure ?? null,
          sublease_friendly: subleaseFriendly ?? false,
          twenty_one_plus: twenty_one_plus ?? false,
          furnished: furnished ?? false,
          move_in_date: moveInDate ?? null,
          contact_email: contactEmail ?? null,
          contact_phone: contactPhone ?? null,
          contact_name: contactName ?? null,
          lease_availability: leaseAvailabilityArr,
          unavailable: false,
          deleted_at: null,
          draft,
        },
        p_amenities: amenityObj,
        p_utilities: utilityObj,
        p_walk_times: walkTimeRows,
        p_units: [],
        p_lease_availability: leaseAvailabilityVal,
        p_custom_amenities: customAmenityArr,
        /*
         * Creating the property record does not always mean owning it.
         *
         * A sublease means the poster is handing over part of a lease someone
         * else holds — so the building is not theirs, even when they are the
         * first person to put its address on the site. Claiming it would write
         * them a listing_landlords row, which is what isPropertyOwner reads, and
         * hand them the right to rewrite and delete a property they only rent a
         * room in. Prod carries exactly that shape at 5803 Waterman and 729
         * Westgate, both created this way.
         *
         * Their stake is the lease below (owner_id), which is the thing they
         * actually hold. The property stays unclaimed until a landlord claims
         * it — the same state every imported listing starts in.
         */
        p_claim_property: !isSublease,
      });

      if (listingError) {
        console.error("Error creating listing:", listingError.message);
        return NextResponse.json({ error: listingError.message }, { status: 500 });
      }
      listingId = newListingId;
      createdListingHere = true;
      createdListingId = newListingId;
    }

    /*
     * ── Units + leases ──────────────────────────────────────────────────────
     *
     * The ids are collected because the caller needs them to file its photos.
     * A poster who does not own the property may only upload against a unit
     * they are letting (/api/upload), and after the sublease change above that
     * now includes the person who just created the property. Returning the ids
     * is what lets the client scope the upload instead of guessing.
     */
    // In the order the landlord entered them, after any units already there.
    const firstSortOrder = await nextUnitSortOrder(listingId);
    /*
     * Units already on the property are reused; the rest go in with one insert.
     *
     * One apartment, one row. Adding "Apt 2E" to a building that already has
     * an Apt 2E, which happens when a second landlord describes a unit the
     * first one put there as a draft they cannot see (202610100002), puts this
     * offering on the existing unit rather than making a twin. The offering is
     * still this landlord's own; the unit is shared, as it would be had they
     * picked it from the list.
     *
     * New units are one multi-row insert rather than a round trip each. A house
     * is two round trips and nobody notices; One Hundred Above the Park is
     * forty-seven units, so a loop was ninety-four trips to the database in
     * series and the landlord watched a spinner for most of a minute. Postgres
     * returns the rows of a multi-row insert in the order they were sent, which
     * is what lets each id be matched back to its unit by position. The count
     * is checked rather than assumed.
     */
    const createdUnitIds = new Array(unitData.length).fill(null);
    if (attachToListingId) {
      for (const [i, unit] of unitData.entries()) {
        createdUnitIds[i] = await findUnitNamed(listingId, unit.name);
      }
    }
    const toInsert = unitData
      .map((unit, i) => ({ unit, i }))
      .filter(({ i }) => !createdUnitIds[i]);
    if (toInsert.length) {
      const { data: insertedUnits, error: unitError } = await supabase
        .from("listing_units")
        .insert(
          toInsert.map(({ unit }, n) => ({
            listing_id: listingId,
            bedrooms: unit.bedrooms,
            bathrooms: unit.bathrooms,
            area: unit.area,
            name: unit.name,
            sort_order: firstSortOrder + n,
            floor_plan_image_url: unit.floorPlanImageUrl,
            // A draft property already hides its units; on a live one the unit
            // itself is the draft.
            ...(draft && attachToListingId ? { published_at: null } : {}),
          }))
        )
        .select("id");

      if (unitError || !insertedUnits || insertedUnits.length !== toInsert.length) {
        console.error(
          "[addListing] Unit insert failed:",
          unitError?.message ??
            `expected ${toInsert.length} units back, got ${insertedUnits?.length ?? 0}`
        );
        return fail(500, "Could not save a unit.");
      }
      toInsert.forEach(({ i }, n) => {
        createdUnitIds[i] = insertedUnits[n].id;
      });
    }

    const allLeaseRows = [];
    for (const [i, unit] of unitData.entries()) {
      const unitId = createdUnitIds[i];

      /*
       * One row per price, not one row per unit.
       *
       * A unit can be offered at more than one price: a revenue-managed
       * building quotes a different rent for each lease length (Metropolitan
       * Flats asks $1,915 for seven months and $1,725 for fifteen on the same
       * apartment). unit_leases has always allowed several rows per unit, each
       * with its own rent and its own set of durations, and the listing page
       * already renders one panel per offering. Nothing but this insert was
       * stopping it, so a caller can now send `leases: [...]` and an importer
       * can reproduce a whole price curve. Callers that send a single rent are
       * unchanged: they become an array of one.
       */
      const leaseRows = (
        Array.isArray(unit.leases) && unit.leases.length
          ? unit.leases
          : [{ rent: unit.rent, leaseTermMonths: unit.leaseTermMonths }]
      )
        .slice(0, MAX_LEASES_PER_UNIT)
        .map((lease) => ({
          unit_id: unitId,
          owner_id: ownerId,
          rent: lease.rent ?? null,
          // Which number `rent` is. Dropped here until now, so an offering
          // published as per-person came back out as whole-unit rent and was
          // divided by the bedroom count a second time.
          rent_is_per_person: lease.rentIsPerPerson ?? unit.rentIsPerPerson,
          lease_term_months: Array.isArray(lease.leaseTermMonths)
            ? lease.leaseTermMonths
            : unit.leaseTermMonths,
          available_from:
            lease.availableFrom ?? unit.leaseAvailability ?? leaseAvailabilityVal ?? null,
          sublease: unit.sublease,
          is_active: true,
          unavailable: !unit.available,
          // The apartments a floor plan's price is for, when the site said:
          // "Apts 07C, 11C". Otherwise the listing's own words, as before.
          description: apartmentsLabel(lease.apartments) ?? leaseBlurb,
          furnished: furnished ?? null,
          contact_email: contactEmail ?? null,
          contact_phone: contactPhone ?? null,
          contact_name: contactName ?? null,
          // A draft offering on a live building. Inside a draft property the
          // row is published and the property hides it, so publishing the
          // property alone puts everything up.
          ...(draft && attachToListingId ? { published_at: null } : {}),
        }));

      allLeaseRows.push(...leaseRows);
    }

    if (allLeaseRows.length) {
      const { error: leaseError } = await supabase.from("unit_leases").insert(allLeaseRows);

      if (leaseError) {
        // Raised by unit_leases_sublease_guard when a sublease is posted onto a
        // unit that is already being offered.
        if (leaseError.code === "23514" || /sublease/i.test(leaseError.message)) {
          return fail(
            409,
            "This unit already has a live lease, so it can't be subleased. Pick a different unit, or add a new one."
          );
        }
        console.error("[addListing] Lease insert failed:", leaseError.message);
        return fail(500, "Could not save a lease.");
      }
    }

    /*
     * The property now has its units and their leases, so it is a real listing.
     * Everything below is best-effort decoration and must never be able to take
     * it back out, so release the rollback handle before running any of it.
     */
    createdListingId = null;

    /*
     * Attaching to a property nobody owns — a review stub carrying the Proximity
     * placeholder, or an import with no landlord row — hands it to the landlord
     * who just put real units on it. A no-op on a property that already has an
     * owner, which includes the one this request may have created a moment ago.
     */
    const claimedProperty = await claimUnclaimedProperty({
      userId: ownerId,
      listingId,
      sublease: isSublease,
    });

    if (concessionRows.length && listingId) {
      const { error: concessionError } = await supabase
        .from("listing_concessions")
        .insert(concessionRows.map((c) => ({ ...c, listing_id: listingId })));
      if (concessionError) {
        // A special is worth having but never worth failing a publish over.
        console.error("[addListing] Concession insert failed:", concessionError.message);
      }
    }


    /*
     * Remember the page this came from, so it can be re-read later.
     *
     * Best-effort in the strongest sense: a listing must never fail to publish
     * because we could not record where it was read from. Only for a property
     * this request actually created — attaching an offering to someone else's
     * building must not re-point their monitor at the page this landlord
     * happened to paste.
     */
    if (sourceUrl && createdListingHere) {
      try {
        const attached = await attachSourceUrl({
          listingId,
          rawUrl: sourceUrl,
          indexUrl,
          userId: ownerId,
        });
        if (!attached.ok) {
          console.error(`[addListing] Failed to record source URL: ${attached.reason}`);
        } else {
          console.log(
            `[addListing] source recorded: ${attached.kind} ${attached.url}` +
              (attached.indexUrl ? ` (listed on ${attached.indexUrl})` : "")
          );
        }
      } catch (srcErr) {
        console.error("[addListing] Failed to record source URL:", srcErr?.message);
      }
    }

    // Persist driving times (best-effort; never blocks listing creation). Written
    // after the create RPC rather than inside it — the service-role client bypasses
    // RLS, and the UNIQUE (listing_id, location_id) constraint makes this idempotent.
    if (driveTimeRows.length && !attachToListingId) {
      try {
        const { error: driveErr } = await supabase
          .from("listing_drive_times")
          .upsert(
            driveTimeRows.map((r) => ({ ...r, listing_id: listingId })),
            { onConflict: "listing_id,location_id" }
          );
        if (driveErr) {
          console.error("[addListing] Failed to insert drive times:", driveErr.message);
        }
      } catch (dtErr) {
        console.error("[addListing] Failed to insert drive times:", dtErr?.message);
      }
    }

    // Best-effort default photo from Google Street View. Stored at sort_order 0 (cover);
    // any user uploads land after it via /api/upload. Never blocks listing creation.
    if (attachStreetView && !attachToListingId) {
      try {
        await fetchAndStoreStreetView({
          supabase,
          listingId,
          address,
          lat: resolvedLat,
          lng: resolvedLng,
        });
      } catch (svErr) {
        console.error("[addListing] Street View attach failed:", svErr?.message);
      }
    }

    // Notify landlord of their new listing. A draft is not one yet.
    if (ownerId && !draft) {
      try {
        const { data: landlordUsers } = await supabase
          .from("users")
          .select("email, name")
          .eq("id", ownerId);
        for (const landlordUser of (landlordUsers ?? [])) {
          if (landlordUser?.email) {
            await sendNewListingEmail(landlordUser.email, landlordUser.name, address, listingId);
          }
        }
      } catch (emailErr) {
        console.error("[addListing] Failed to send landlord notification:", emailErr?.message);
      }
    }

    // A contact address typed into the add form only receives message alerts
    // once someone at it confirms, the same as one set later in the editor.
    // The importer is left alone: its addresses come from the source site and
    // have no landlord on our side to confirm them for.
    if (!isImportRequest && ownerId && contactEmail) {
      const baseUrl = getBaseUrl(req);
      after(() => requestContactVerification({ landlordId: ownerId, email: contactEmail, baseUrl }));
    }

    return NextResponse.json(
      {
        message: draft ? "Draft saved" : "Listing created successfully",
        listing: { id: listingId, address, unitIds: createdUnitIds, claimedProperty, draft },
      },
      { status: 201 }
    );
  } catch (e) {
    console.error("Error:", e?.message);
    return fail(500, e?.message);
  }
}
