import { Suspense } from "react";
import BrowseContent from "@/components/show-listings/BrowseContent";
import { auth } from "@/auth";

export default async function Browse() {
  //const session = await auth();
  const session = null; //TODO: Remove this line and uncomment the above line to enable authentication
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <BrowseContent session={session} />
    </Suspense>
  );
}
