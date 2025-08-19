import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function AddSubLeaseLayout({ children }) {
  const session = await auth();

  if (!session || session.user.role !== "student") {
    redirect("/");
  }

  return children;
}
