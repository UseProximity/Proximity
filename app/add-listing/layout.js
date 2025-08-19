import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function AddListingLayout({ children }) {
  const session = await auth();

  if (!session || session.user.role !== "lanlord") {
    redirect("/");
  }

  return children;
}
