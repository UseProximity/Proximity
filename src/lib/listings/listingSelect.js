export const LISTING_SELECT = `
  id, title, address, longitude, latitude, description,
  lease_type, contact_email, contact_phone, contact_name,
  lease_structure, lease_availability, furnished, move_in_date, sublease_friendly,
  twenty_one_plus, unavailable, created_at,
  home_types!home_type_id(label),
  listing_leases!listing_id(bedrooms, bathrooms, area, rent, pricing_basis, is_active, sublease, lease_term_months, deleted_at),
  listing_landlords!listing_id(user_id, is_primary),
  listing_amenities!listing_id(
    air_conditioning, dishwasher, gym, laundry, mailroom, microwave,
    oven, parking, pets_allowed, pool, refrigerator, rooftop,
    storage, stove, study_room),
  listing_utilities!listing_id(
    electric, gas, heat, water, internet, trash, cable, sewer, cooling),
  listing_images(url, sort_order),
  listing_reviews!listing_id(rating, legitimacy, deleted_at)
`.trim();
