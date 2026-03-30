import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function StudentDashboard({ children }) {
  const session = await auth();

  if (!session || (session.user.role !== "student" && session.user.role !== "super")) {
    redirect("/");
  }

  return children;
}
