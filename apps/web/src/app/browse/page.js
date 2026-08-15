import { Suspense } from "react";
import BrowseContent from "@/components/listings/BrowseContent";
import { auth } from "@/auth";
import { getCachedListings } from "@/lib/listings/queryListings";

export const metadata = {
  title: "Browse WashU Student Apartments and Rentals | Proximity",
  description:
    "Browse every off-campus apartment and rental near WashU with rent, bedrooms, walk times to campus, and honest reviews from WashU students.",
  alternates: { canonical: "/browse" },
};

export default async function Browse() {
  const session = await auth();
  // Server-fetched so the first HTML contains real listing cards (and their
  // crawlable /listings/[id] anchors) instead of a loading state.
  const initialListings = await getCachedListings();
  return (
    <Suspense fallback={<div></div>}>
      <BrowseContent session={session} initialListings={initialListings} />
    </Suspense>
  );
}
