import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function AddSubleaseLayout({ children }) {
  const session = await auth();

  if (!session) {
    redirect("/login?callbackUrl=/add-sublease");
  }

  // Landlords post full listings, not subleases.
  if (session.user.role === "landlord") {
    redirect("/add-listing");
  }

  return children;
}
