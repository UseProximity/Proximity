import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function LandlordDashboard({ children }) {
  const session = await auth();

  if (!session || session.user.role !== "landlord") {
    redirect("/");
  }

  return children;
}
