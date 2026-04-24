import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const session = await auth();
  if (!session) redirect("/");
  redirect(session.user.role === "landlord" ? "/dashboard/landlord" : "/dashboard/student");
}
