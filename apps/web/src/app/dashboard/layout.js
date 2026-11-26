import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

// robots.txt disallows crawling /dashboard/, but externally-linked URLs can still
// be indexed without being crawled — this keeps them out of search results entirely.
export const metadata = { robots: { index: false, follow: false } };

export default async function DashboardLayout({ children }) {
  const session = await auth();

  // A deleted account keeps a truthy session object (see auth.js's session
  // callback) but with no id — treat that the same as no session at all,
  // rather than letting the shell mount with nothing to render.
  if (!session?.user?.id) {
    const headersList = await headers();
    const pathname = headersList.get("x-pathname") || "/dashboard";
    const search = headersList.get("x-search") || "";
    // Root /dashboard is a routing hub — send unauthenticated visitors home
    if (pathname === "/dashboard") redirect("/");
    redirect(`/login?callbackUrl=${encodeURIComponent(pathname + search)}`);
  }

  return children;
}
