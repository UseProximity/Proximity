import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

export default async function DashboardLayout({ children }) {
  const session = await auth();

  if (!session) {
    const headersList = await headers();
    const pathname = headersList.get("x-pathname") || "/dashboard";
    const search = headersList.get("x-search") || "";
    // Root /dashboard is a routing hub — send unauthenticated visitors home
    if (pathname === "/dashboard") redirect("/");
    redirect(`/login?callbackUrl=${encodeURIComponent(pathname + search)}`);
  }

  return children;
}
