import Link from "next/link";
import { ListingCard } from "@/components/listings/MapPopupCard";

/*
 * Server wrapper for the listing grid on /washu landing pages. ListingCard is
 * a client component but server-renders its markup, so the cards (and their
 * crawlable /listings/[id] anchors) land in the first HTML.
 */
export default function WashuListingGrid({ listings, emptyLabel }) {
  if (!listings.length) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-8 text-center">
        <p className="text-lg font-semibold text-gray-900 mb-2">
          {emptyLabel ?? "Inventory is tight right now."}
        </p>
        <p className="text-gray-600 mb-5">
          Listings change weekly. Tell matchmaking what you need and we will
          surface the fits as they open up.
        </p>
        <Link
          href="/matchmaking"
          className="inline-flex items-center justify-center rounded-xl bg-red-600 px-5 py-3 font-semibold text-white hover:bg-red-700 transition"
        >
          Get matched free
        </Link>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
      {listings.map((listing) => (
        <ListingCard key={listing._id} listing={listing} />
      ))}
    </div>
  );
}
