import { Suspense } from "react";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getListing } from "@/lib/listings/getListing";
import { serializeJsonLd } from "@/lib/jsonLd";
import ListingDetailClient from "./ListingDetailClient";

// Same display-name rule as ListingCard: explicit title, else street address.
function listingDisplayName(listing) {
  return listing.title || listing.address.split(",")[0].trim();
}

function formatRent(listing) {
  if (listing.minRent == null) return null;
  if (listing.maxRent != null && listing.maxRent !== listing.minRent) {
    return `$${listing.minRent.toLocaleString()}–$${listing.maxRent.toLocaleString()}/mo`;
  }
  return `$${listing.minRent.toLocaleString()}/mo`;
}

function formatRange(min, max, unit) {
  if (min == null) return null;
  const range = max != null && max !== min ? `${min}–${max}` : `${min}`;
  return `${range} ${unit}`;
}

function buildDescription(listing) {
  const parts = [
    formatRent(listing),
    formatRange(listing.minBedrooms, listing.maxBedrooms, "bed"),
    formatRange(listing.minBathrooms, listing.maxBathrooms, "bath"),
  ].filter(Boolean);
  const lead = parts.length
    ? `${parts.join(" · ")} at ${listing.address}.`
    : `${listing.address}.`;
  const text = `${lead} Off-campus WashU student housing with honest peer reviews on Proximity.`;
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

export async function generateMetadata({ params }) {
  const { id } = await params;
  const listing = await getListing(id).catch(() => null);
  if (!listing) {
    return { title: "Listing Not Found | Proximity", robots: { index: false } };
  }
  const name = listingDisplayName(listing);
  return {
    title: `${name} | WashU Off-Campus Housing | Proximity`,
    description: buildDescription(listing),
    alternates: { canonical: `/listings/${id}` },
    openGraph: {
      title: `${name} | Proximity`,
      description: buildDescription(listing),
      url: `/listings/${id}`,
      ...(listing.images.length ? { images: [listing.images[0]] } : {}),
    },
  };
}

function listingJsonLd(listing, id) {
  const legitReviews = (listing.reviews ?? []).filter(
    (r) => r.legitimacy && !r.deletedAt
  );
  return {
    "@context": "https://schema.org",
    "@type": "Apartment",
    "@id": `https://useproximity.org/listings/${id}`,
    name: listingDisplayName(listing),
    url: `https://useproximity.org/listings/${id}`,
    ...(listing.description ? { description: listing.description } : {}),
    address: {
      "@type": "PostalAddress",
      streetAddress: listing.address.split(",")[0].trim(),
      addressLocality: "St. Louis",
      addressRegion: "MO",
      addressCountry: "US",
    },
    ...(listing.latitude != null && listing.longitude != null
      ? {
          geo: {
            "@type": "GeoCoordinates",
            latitude: listing.latitude,
            longitude: listing.longitude,
          },
        }
      : {}),
    ...(listing.minBedrooms != null
      ? { numberOfBedrooms: listing.minBedrooms }
      : {}),
    ...(listing.minBathrooms != null
      ? { numberOfBathroomsTotal: listing.minBathrooms }
      : {}),
    ...(listing.images.length ? { image: listing.images.slice(0, 6) } : {}),
    ...(listing.minRent != null
      ? {
          offers: {
            "@type": "Offer",
            price: listing.minRent,
            priceCurrency: "USD",
            availability: listing.unavailable
              ? "https://schema.org/OutOfStock"
              : "https://schema.org/InStock",
          },
        }
      : {}),
    ...(legitReviews.length
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: listing.rating,
            reviewCount: legitReviews.length,
          },
        }
      : {}),
  };
}

export default async function ListingDetailPage({ params }) {
  const session = await auth();
  const { id } = await params;
  const listing = await getListing(id).catch(() => null);
  if (!listing) notFound();
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          // serializeJsonLd escapes "<" — listing fields are landlord-controlled
          __html: serializeJsonLd(listingJsonLd(listing, id)),
        }}
      />
      <Suspense
        fallback={
          <div className="flex items-center justify-center min-h-screen">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600" />
          </div>
        }
      >
        <ListingDetailClient listingId={id} session={session} />
      </Suspense>
    </>
  );
}
