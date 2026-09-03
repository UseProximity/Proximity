import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { auth } from "@/auth";
import { fetchAllWalkTimes } from "@/utils/walkTimes";
import { fetchAllDriveTimes } from "@/utils/driveTimes";
import { fetchAndStoreStreetView } from "@/lib/streetview";
import { deriveLeaseAvailability } from "@/utils/listingFormatters";
import { shortDescription } from "@/lib/listings/leaseDescription";
import { isValidCount } from "@/utils/unitCounts";
import nodemailer from "nodemailer";
import { sendMailSafe } from "@/lib/outreach";
import {
  findPropertyNameConflict,
  propertyNameTakenResponse,
} from "@/lib/listings/propertyName";

const _emailTransporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT) || 587,
  secure: false,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

async function sendNewListingEmail(toEmail, toName, address, listingId) {
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn("[sendNewListingEmail] Email env vars not set — skipping in dev mode.");
    return;
  }
  const listingUrl = `https://useproximity.org/browse?listing=${listingId}`;
  await sendMailSafe(_emailTransporter, {
    from: `"Proximity" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: "You have a new listing on Proximity!",
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #111827;">
        <p>Hi ${toName || "there"},</p>
        <p>Congratulations! A new listing has been added to your Proximity account.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
        <p><strong>Address:</strong> ${address}</p>
        <p style="margin-top: 16px;">
          <a href="${listingUrl}" style="display: inline-block; background: #dc2626; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 600;">View Your Listing</a>
        </p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
        <p>Best,<br/>The Proximity Team<br/><a href="https://useproximity.org" style="color: #dc2626;">useproximity.org</a></p>
        <p style="color: #9ca3af; font-size: 12px;">You're receiving this because a listing was assigned to your account on Proximity.</p>
      </div>
    `,
  });
}

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

export async function POST(req) {
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

    // Allow import script to bypass auth using a shared secret
    const importSecret = process.env.IMPORT_SECRET;
    const providedSecret = req.headers.get("x-import-secret");
    const isImportRequest = importSecret && providedSecret === importSecret;

    let ownerId = null;

    if (!isImportRequest) {
      const session = await auth();
      if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const userRole = session?.user?.role;
      if (!["student", "landlord", "super"].includes(userRole)) {
        return NextResponse.json(
          { error: "Only students, landlords, and super admins can create listings." },
          { status: 403 }
        );
      }
      ownerId = session?.user?.id;
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

    const unitData = unitTypes.map((unit) => ({
      bedrooms: unit.bedrooms,
      bathrooms: unit.bathrooms,
      area: unit.area ?? null,
      rent: unit.rent ?? null,
      title: unit.title ?? null,
      floorPlanImageUrl: unit.floorPlanImageUrl ?? null,
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
      // Unit identity. 'Whole' covers the entire property and carries no number
      // (enforced by listing_units_number_check).
      designator: unit.designator ?? null,
      number: unit.designator === "Whole" ? null : unit.number ?? null,
    }));

    // listings.lease_availability is derived from the union of the units' lease terms.
    const leaseAvailabilityArr = deriveLeaseAvailability(unitData);

    // Units and leases are written directly rather than through the create RPC's
    // p_units, because the RPC gives no way to tie each inserted unit back to the
    // payload row it came from — every row in one transaction shares a created_at,
    // so identity and lease ownership could not be attributed afterwards.
    let listingId = attachToListingId ?? null;

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
    const createdUnitIds = [];
    for (const unit of unitData) {
      const { data: insertedUnit, error: unitError } = await supabase
        .from("listing_units")
        .insert({
          listing_id: listingId,
          bedrooms: unit.bedrooms,
          bathrooms: unit.bathrooms,
          area: unit.area,
          title: unit.title,
          floor_plan_image_url: unit.floorPlanImageUrl,
          unit_designator: unit.designator,
          unit_number: unit.number,
        })
        .select("id")
        .single();

      if (unitError) {
        console.error("[addListing] Unit insert failed:", unitError.message);
        return NextResponse.json({ error: "Could not save a unit." }, { status: 500 });
      }

      createdUnitIds.push(insertedUnit.id);

      const { error: leaseError } = await supabase.from("unit_leases").insert({
        unit_id: insertedUnit.id,
        owner_id: ownerId,
        rent: unit.rent,
        // Which number `rent` is. Dropped here until now, so an offering
        // published as per-person came back out as whole-unit rent and was
        // divided by the bedroom count a second time.
        rent_is_per_person: unit.rentIsPerPerson,
        lease_term_months: unit.leaseTermMonths,
        available_from: unit.leaseAvailability ?? leaseAvailabilityVal ?? null,
        sublease: unit.sublease,
        is_active: true,
        unavailable: !unit.available,
        description: leaseBlurb,
        furnished: furnished ?? null,
        contact_email: contactEmail ?? null,
        contact_phone: contactPhone ?? null,
        contact_name: contactName ?? null,
      });

      if (leaseError) {
        // Raised by unit_leases_sublease_guard when a sublease is posted onto a
        // unit that is already being offered.
        if (leaseError.code === "23514" || /sublease/i.test(leaseError.message)) {
          return NextResponse.json(
            {
              error:
                "This unit already has a live lease, so it can't be subleased. Pick a different unit, or add a new one.",
            },
            { status: 409 }
          );
        }
        console.error("[addListing] Lease insert failed:", leaseError.message);
        return NextResponse.json({ error: "Could not save a lease." }, { status: 500 });
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

    // Notify landlord of their new listing
    if (ownerId) {
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

    return NextResponse.json(
      {
        message: "Listing created successfully",
        listing: { id: listingId, address, unitIds: createdUnitIds },
      },
      { status: 201 }
    );
  } catch (e) {
    console.error("Error:", e?.message);
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
