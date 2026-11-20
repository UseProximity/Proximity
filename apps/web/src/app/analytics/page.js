import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { analyticsRedirectTarget } from "@/lib/analytics/redirect";

/*
 * /analytics is retired (marketing attribution, PRD 7.6): analytics live on the admin
 * dashboard. Old bookmarks land on the matching admin Analytics tab; the admin layout
 * decides who may open it.
 */

export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics | Proximity", robots: { index: false, follow: false } };

export default async function AnalyticsIndex({ searchParams }) {
  const target = analyticsRedirectTarget(null, await searchParams);
  // Signed out: sign in first, as /analytics did, rather than bounce off the admin layout.
  const session = await auth();
  redirect(session?.user?.id ? target : `/login?callbackUrl=${encodeURIComponent(target)}`);
}
