import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function AddListingLayout({ children }) {
  const session = await auth();

  if (!session) {
    redirect("/login?callbackUrl=/add-listing");
  }

  // Students (and other non-landlord roles) post subleases, not full listings.
  const role = session.user.role;
  if (role !== "landlord" && role !== "super") {
    redirect("/add-sublease");
  }

  return children;
}
