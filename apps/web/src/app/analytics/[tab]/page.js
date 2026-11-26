import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { analyticsRedirectTarget } from "@/lib/analytics/redirect";

/*
 * /analytics/<tab> is retired (marketing attribution, PRD 7.6): it redirects to the same
 * tab on the admin Analytics page, keeping the period, so bookmarks keep working.
 */

export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics | Proximity", robots: { index: false, follow: false } };

export default async function AnalyticsTabRedirect({ params, searchParams }) {
  const { tab } = await params;
  const target = analyticsRedirectTarget(tab, await searchParams);
  // Signed out: sign in first, as /analytics did, rather than bounce off the admin layout.
  const session = await auth();
  redirect(session?.user?.id ? target : `/login?callbackUrl=${encodeURIComponent(target)}`);
}
