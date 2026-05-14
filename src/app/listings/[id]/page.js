import { Suspense } from "react";
import { auth } from "@/auth";
import ListingDetailClient from "./ListingDetailClient";

export default async function ListingDetailPage({ params }) {
  const session = await auth();
  const { id } = await params;
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600" />
        </div>
      }
    >
      <ListingDetailClient listingId={id} session={session} />
    </Suspense>
  );
}
