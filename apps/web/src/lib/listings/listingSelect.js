/*
 * The listing shape every non-browse surface reads (matchmaking, saved/contacted
 * lists, admin). Units carry their own id and their leases carry `unavailable`
 * and `furnished` because a unit is only a real option when ONE of its offerings
 * satisfies the price, term and furnishing asked of it — see
 * lib/listings/filterListings.js for the same rule on browse.
 *
 * Contact and description are read at the LEASE level too. They used to be
 * property columns only, so the landlord dashboard opened an edit form with both
 * boxes blank however carefully the landlord had filled them in on the way in —
 * the values were saved, just never selected back out.
 */
export const LISTING_SELECT = `
  id, title, address, longitude, latitude, description,
  lease_type, contact_email, contact_phone, contact_name,
  lease_structure, lease_availability, furnished, move_in_date, sublease_friendly,
  twenty_one_plus, unavailable, created_at,
  home_types!home_type_id(label),
  listing_units!listing_id(id, bedrooms, bathrooms, area, available, deleted_at,
    unit_designator, unit_number, title, floor_plan_image_url,
    unit_leases!unit_id(id, rent, is_active, unavailable, sublease,
      available_from, lease_term_months, furnished, owner_id, rent_is_per_person,
      description, contact_email, contact_phone, contact_name)),
  listing_landlords!listing_id(user_id, is_primary),
  listing_amenities!listing_id(
    air_conditioning, dishwasher, gym, laundry, mailroom, microwave,
    oven, parking, pets_allowed, pool, refrigerator, rooftop,
    storage, stove, study_room),
  listing_utilities!listing_id(
    electric, gas, heat, water, internet, trash, cable, sewer, cooling),
  listing_images(id, url, sort_order, unit_id, owner_id),
  listing_reviews!listing_id(rating, legitimacy, deleted_at)
`.trim();
