import supabase from "@/libs/supabase";
import { auth } from "@/auth";
import Link from "next/link";
import { notFound } from "next/navigation";
import ReviewsSection from "@/components/ReviewsSection";
import {
  getAreaRangeLabel,
  getRentRangeLabel,
  getUnitValuesLabel,
  calcAge,
} from "@/utils/listingFormatters";

export default async function Landlord({ params }) {
  const { landlordId } = params;
  const session = await auth();

  // Fetch landlord user from Supabase
  const { data: landlordRow, error: userError } = await supabase
    .from("users")
    .select("id, name, email, image, description, phone, birthday, gender, rating, num_reviews")
    .eq("id", decodeURIComponent(landlordId))
    .single();

  if (userError || !landlordRow) notFound();

  // Fetch listings for this landlord
  const { data: listingRows } = await supabase
    .from("listings")
    .select("id, address, images, lease_type, created_at, listing_units(rent, area, bedrooms, bathrooms)")
    .contains("landlord_id", [landlordRow.id]);

  const listings = (listingRows ?? []).map((l) => ({
    _id: l.id,
    address: l.address,
    images: Array.isArray(l.images) ? l.images : [],
    leaseType: l.lease_type ?? null,
    createdAt: l.created_at ? new Date(l.created_at).toISOString() : null,
    unitTypes: (l.listing_units ?? []).map((u) => ({
      rent: u.rent != null ? Number(u.rent) : null,
      area: u.area != null ? Number(u.area) : null,
      bedrooms: u.bedrooms != null ? Number(u.bedrooms) : null,
      bathrooms: u.bathrooms != null ? Number(u.bathrooms) : null,
    })),
  }));

  // Fetch reviews for this landlord's listings
  const listingIds = listings.map((l) => l._id);
  let reviews = [];
  if (listingIds.length > 0) {
    const { data: reviewRows } = await supabase
      .from("reviews")
      .select("id, rating, comment, legitimacy, created_at, name, reviewer:users!reviews_user_id_fkey(name, image)")
      .in("listing_id", listingIds)
      .order("created_at", { ascending: false });

    reviews = (reviewRows ?? []).map((r) => ({
      _id: r.id,
      rating: r.rating,
      comment: r.comment,
      legitimacy: r.legitimacy ?? false,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
      reviewer: r.reviewer
        ? { name: r.reviewer.name, image: r.reviewer.image ?? null }
        : r.name ? { name: r.name, image: null } : null,
    }));
  }

  const landlord = {
    _id: landlordRow.id,
    name: landlordRow.name,
    email: landlordRow.email,
    image: landlordRow.image,
    description: landlordRow.description,
    phone: landlordRow.phone,
    birthday: landlordRow.birthday ?? null,
    gender: landlordRow.gender,
    rating: landlordRow.rating ?? 0,
    numReviews: landlordRow.num_reviews ?? 0,
    listings,
    reviews,
  };

  const leaseTypeMap = {
    sublease: "Sub-Lease",
    nine: "9 Month Lease",
    twelve: "12 Month Lease",
    academic: "Academic Year",
  };

  return (
    <>
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/*Landlord Recap */}
        <div className="bg-white p-6 rounded-lg shadow-md mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">{landlord.name}</h1>
            {landlord.numReviews === 0 ? (
              <p className="text-gray-500 text-sm italic">No ratings yet</p>
            ) : (
              <div className="text-yellow-500 text-lg">
                {"★".repeat(landlord.rating)}
                <span className="text-gray-300">
                  {"★".repeat(5 - landlord.rating)}
                </span>
              </div>
            )}
            <p className="text-gray-500">
              {landlord.listings.length} active listings
            </p>
            <p className="text-gray-600 text-sm mt-1">{landlord.description}</p>
            <p className="text-gray-400 text-sm">
              {landlord.birthday
                ? `${calcAge(landlord.birthday)} years old`
                : null}
              {landlord.gender ? ` • ${landlord.gender}` : ""}
            </p>
            <p className="text-gray-500 text-sm mt-1">
              📞 {landlord.phone} • ✉️ {landlord.email}
            </p>
          </div>
          <img
            src={landlord.image}
            alt={landlord.name}
            className="w-20 h-20 rounded-full object-cover"
          />
        </div>

        {/* Main Content: Reviews (Left) + Listings (Right) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Reviews */}
          <ReviewsSection
            reviews={landlord.reviews}
            session={session}
            landlordName={landlord.name}
            reviewedId={landlord._id}
          />

          {/* Listings */}
          <div className="md:col-span-2">
            <h2 className="text-xl font-semibold mb-4">Listings</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {landlord.listings.map((listing, index) => (
                <Link
                  key={index}
                  href={`/landlord/${landlord._id}?listing=${listing._id}`}
                >
                  <div className="bg-white rounded-lg shadow-md overflow-hidden">
                    <img
                      src={listing.images[0]}
                      alt={listing.address}
                      className="w-full h-40 object-cover"
                    />
                    <div className="p-4">
                      <h3 className="text-lg font-semibold">
                        {getRentRangeLabel(listing.unitTypes)}
                      </h3>
                      <p className="text-gray-500">{listing.address}</p>
                      <p className="text-sm text-gray-400">
                        {getUnitValuesLabel(listing.unitTypes, "bedrooms")} Beds
                        {" • "}
                        {getUnitValuesLabel(listing.unitTypes, "bathrooms")}{" "}
                        Baths • {getAreaRangeLabel(listing.unitTypes)} Sq Ft
                      </p>
                      <p className="text-xs text-gray-400">
                        {leaseTypeMap[listing.leaseType] || listing.leaseType}
                      </p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
