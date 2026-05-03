import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function StudentDashboard({ children }) {
  const session = await auth();

  if (!session) {
    redirect("/");
  }

  const role = session.user.role;
  if (role === "landlord") redirect("/dashboard/landlord");
  if (role === "admin") redirect("/dashboard/admin");

  return children;
}
