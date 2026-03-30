import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function AdminLayout({ children }) {
  const session = await auth();

  if (!session || session.user.role !== "super") {
    redirect("/");
  }

  return children;
}
