import HomeClient from "./HomeClient";
import {
  getCachedListings,
  getCachedPopularListings,
} from "@/lib/listings/queryListings";

export const metadata = {
  title: "WashU Off-Campus Housing & Honest Peer Reviews | Proximity",
  description:
    "Find your off-campus apartment near WashU with honest peer reviews, verified listings, walk times to campus, and free personalized matchmaking. Built by students, for students.",
  alternates: { canonical: "/" },
};

// Server shell for the homepage: owns the page metadata and seeds the client
// experience with listings so the hero map cards (and their crawlable
// /listings/[id] anchors) are present in the first HTML response.
export default async function HomePage() {
  const [initialListings, initialPopular] = await Promise.all([
    getCachedListings(),
    getCachedPopularListings(),
  ]);
  return (
    <HomeClient
      initialListings={initialListings}
      initialPopular={initialPopular}
    />
  );
}
