import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { getAnalyticsViewer } from "@/lib/analytics/access";

/* /analytics: send each viewer to the first tab they may see. */

export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics | Proximity", robots: { index: false, follow: false } };

export default async function AnalyticsIndex({ searchParams }) {
  const session = await auth();
  if (!session?.user?.id) redirect(`/login?callbackUrl=${encodeURIComponent("/analytics")}`);
  const viewer = await getAnalyticsViewer(session);
  if (!viewer) notFound();
  const weeks = (await searchParams)?.weeks;
  redirect(`/analytics/${viewer.tabs[0].slug}${weeks ? `?weeks=${encodeURIComponent(weeks)}` : ""}`);
}
