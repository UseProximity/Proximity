import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

/*
 * Signed-out visitors are let in on purpose: they fill the whole form and are
 * asked for an account only when they press Publish, so the work they have
 * already done is what makes signing up feel cheap. The listing itself still
 * cannot be created without an account, /api/addListing and /api/leases refuse
 * a request with no session.
 */
export default async function AddListingLayout({ children }) {
  const session = await auth();

  if (session) {
    // Students (and other non-landlord roles) post subleases, not full listings.
    const role = session.user.role;
    if (role !== "landlord" && role !== "super") {
      /*
       * Except when coming back from the account step with a listing to finish.
       * A Google sign-up always starts as a student and is only corrected to a
       * landlord once this page has loaded, so bouncing them here would throw
       * away the listing they just spent the flow on.
       */
      const search = (await headers()).get("x-search") || "";
      if (!new URLSearchParams(search).has("resume")) redirect("/add-sublease");
    }
  }

  return children;
}
